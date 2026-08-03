/*
 * wol.js — Paquete mágico de Wake-on-LAN y lista de equipos.
 *
 * El paquete mágico son 102 bytes: seis 0xFF seguidos de la MAC repetida
 * dieciséis veces. Se manda por UDP a la dirección de difusión de la red donde
 * vive el equipo; la tarjeta lo reconoce con el ordenador apagado y lo enciende.
 */

import Gio from 'gi://Gio';

// Puerto habitual del paquete mágico. El 7 (echo) también se usa.
export const PUERTO_POR_DEFECTO = 9;

/**
 * Convierte una MAC escrita de cualquiera de las formas habituales
 * (aa:bb:cc:dd:ee:ff, aa-bb-..., aabbccddeeff) en sus seis bytes.
 *
 * @param {string} texto MAC tal cual la escribió el usuario
 * @returns {number[]|null} seis bytes, o null si no es una MAC válida
 */
export function parsearMac(texto) {
    const limpio = (texto ?? '').replace(/[^0-9a-fA-F]/g, '');
    if (limpio.length !== 12)
        return null;

    const bytes = [];
    for (let i = 0; i < 12; i += 2)
        bytes.push(parseInt(limpio.slice(i, i + 2), 16));
    return bytes;
}

/**
 * Da forma canónica a una MAC para mostrarla.
 *
 * @param {string} texto MAC en cualquier formato
 * @returns {string|null} «aa:bb:cc:dd:ee:ff», o null si no es válida
 */
export function formatearMac(texto) {
    const bytes = parsearMac(texto);
    if (!bytes)
        return null;
    return bytes.map(b => b.toString(16).padStart(2, '0')).join(':');
}

/**
 * Monta los 102 bytes del paquete mágico.
 *
 * @param {number[]} bytesMac los seis bytes de la MAC
 * @returns {Uint8Array} paquete listo para enviar
 */
function construirPaquete(bytesMac) {
    const paquete = new Uint8Array(102);
    paquete.fill(0xff, 0, 6);
    for (let repeticion = 0; repeticion < 16; repeticion++)
        paquete.set(bytesMac, 6 + repeticion * 6);
    return paquete;
}

/**
 * Resuelve un nombre de host a una dirección IP.
 *
 * @param {string} nombre nombre a resolver
 * @param {Gio.Cancellable} cancellable cancelable compartido
 * @returns {Promise<Gio.InetAddress>} primera dirección encontrada
 */
function resolverNombre(nombre, cancellable) {
    return new Promise((resolve, reject) => {
        Gio.Resolver.get_default().lookup_by_name_async(
            nombre, cancellable, (fuente, resultado) => {
                try {
                    const direcciones = fuente.lookup_by_name_finish(resultado);
                    if (!direcciones || direcciones.length === 0)
                        reject(new Error(`Sin respuesta de DNS para «${nombre}»`));
                    else
                        resolve(direcciones[0]);
                } catch (e) {
                    reject(e);
                }
            });
    });
}

/**
 * Envía el paquete mágico a un equipo.
 *
 * @param {object} equipo equipo a despertar
 * @param {string} equipo.mac MAC de la tarjeta de red
 * @param {string} equipo.destino dirección de difusión o host (vacío = 255.255.255.255)
 * @param {number} equipo.puerto puerto UDP
 * @param {Gio.Cancellable} cancellable cancelable para abortar en disable()
 * @returns {Promise<string|null>} null si se envió, o el motivo del fallo
 */
export async function despertar({mac, destino, puerto}, cancellable = null) {
    const bytes = parsearMac(mac);
    if (!bytes)
        return `MAC no válida: «${mac}»`;

    const texto = (destino ?? '').trim() || '255.255.255.255';
    const numero = Number.isFinite(puerto) && puerto > 0 ? puerto : PUERTO_POR_DEFECTO;

    let socket = null;
    try {
        // Si no es una IP literal, se resuelve como nombre de host.
        const inet = Gio.InetAddress.new_from_string(texto) ??
                     await resolverNombre(texto, cancellable);

        socket = Gio.Socket.new(
            inet.get_family(), Gio.SocketType.DATAGRAM, Gio.SocketProtocol.UDP);
        // Sin esto el núcleo rechaza el envío a una dirección de difusión.
        socket.set_broadcast(true);

        socket.send_to(
            Gio.InetSocketAddress.new(inet, numero), construirPaquete(bytes), cancellable);
        return null;
    } catch (e) {
        return e.message;
    } finally {
        try {
            socket?.close();
        } catch {
            // Cerrar el socket es best-effort; un fallo aquí no cambia nada.
        }
    }
}

/**
 * Lee la lista de equipos de los ajustes. Cada entrada es un JSON.
 *
 * @param {Gio.Settings} settings ajustes de la extensión
 * @returns {object[]} equipos con nombre, mac, destino y puerto
 */
export function leerEquipos(settings) {
    const equipos = [];

    for (const linea of settings.get_strv('equipos')) {
        let crudo;
        try {
            crudo = JSON.parse(linea);
        } catch (e) {
            console.warn(`[wol-menu] Entrada ilegible en los ajustes: ${linea}`);
            continue;
        }

        if (!crudo || typeof crudo !== 'object' || !crudo.mac)
            continue;

        equipos.push({
            nombre: crudo.nombre || formatearMac(crudo.mac) || 'Equipo',
            mac: crudo.mac,
            destino: crudo.destino ?? '',
            puerto: Number.isFinite(crudo.puerto) ? crudo.puerto : PUERTO_POR_DEFECTO,
        });
    }

    return equipos;
}

/**
 * Guarda la lista de equipos en los ajustes.
 *
 * @param {Gio.Settings} settings ajustes de la extensión
 * @param {object[]} equipos equipos a guardar
 */
export function guardarEquipos(settings, equipos) {
    settings.set_strv('equipos', equipos.map(e => JSON.stringify({
        nombre: e.nombre ?? '',
        mac: e.mac ?? '',
        destino: e.destino ?? '',
        puerto: Number.isFinite(e.puerto) ? e.puerto : PUERTO_POR_DEFECTO,
    })));
}

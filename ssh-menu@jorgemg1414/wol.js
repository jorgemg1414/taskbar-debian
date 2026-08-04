/*
 * wol.js — Encender un equipo caído sin salir del menú.
 *
 * El paquete mágico son 102 bytes: seis 0xFF seguidos de la MAC repetida
 * dieciséis veces, mandados por UDP a la dirección de difusión de la red donde
 * vive el equipo. Es el mismo que manda la extensión «Wake on LAN» de este
 * repositorio, y está repetido a propósito: así el menú SSH funciona aunque no
 * la tengas instalada, igual que checker.js está repetido en el menú de VNC.
 *
 * La MAC sale de uno de estos dos sitios, en este orden:
 *
 *   1. Un comentario «# MAC: aa:bb:cc:dd:ee:ff» en el bloque del ~/.ssh/config.
 *   2. Los equipos que ya tengas dados de alta en la extensión Wake on LAN,
 *      emparejando por nombre con el alias del bloque.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Puerto habitual del paquete mágico. El 7 (echo) también se usa.
export const PUERTO_POR_DEFECTO = 9;

// De dónde se leen los equipos ya configurados para Wake on LAN.
const UUID_WOL = 'wol-menu@jorgemg1414';
const ID_ESQUEMA_WOL = 'org.gnome.shell.extensions.wol-menu';

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
 * @param {string} equipo.destino dirección de difusión (vacío = 255.255.255.255)
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
 * Abre los ajustes de la extensión Wake on LAN, que vive en una carpeta
 * hermana de esta. Su esquema no está instalado en el sistema, así que se
 * carga desde su propia carpeta.
 *
 * @param {string} rutaPropia carpeta de esta extensión (extension.path)
 * @returns {Gio.Settings|null} ajustes de Wake on LAN, o null si no está
 */
export function ajustesWol(rutaPropia) {
    const carpeta = GLib.build_filenamev([
        GLib.path_get_dirname(rutaPropia), UUID_WOL, 'schemas',
    ]);

    // Sin gschemas.compiled no hay nada que leer: la extensión no está
    // instalada, o lo está a medias.
    if (!GLib.file_test(GLib.build_filenamev([carpeta, 'gschemas.compiled']), GLib.FileTest.EXISTS))
        return null;

    try {
        const fuente = Gio.SettingsSchemaSource.new_from_directory(
            carpeta, Gio.SettingsSchemaSource.get_default(), false);
        const esquema = fuente.lookup(ID_ESQUEMA_WOL, true);
        if (!esquema)
            return null;
        return new Gio.Settings({settings_schema: esquema});
    } catch (e) {
        console.warn(`[ssh-menu] No se pudieron leer los equipos de Wake on LAN: ${e.message}`);
        return null;
    }
}

/**
 * Lee la lista de equipos de los ajustes de Wake on LAN. Cada entrada es un
 * JSON, tal como los guarda esa extensión.
 *
 * @param {Gio.Settings|null} settings ajustes de Wake on LAN
 * @returns {object[]} equipos con nombre, mac, destino y puerto
 */
export function leerEquiposWol(settings) {
    if (!settings)
        return [];

    const equipos = [];
    for (const linea of settings.get_strv('equipos')) {
        let crudo;
        try {
            crudo = JSON.parse(linea);
        } catch {
            continue;
        }

        if (!crudo || typeof crudo !== 'object' || !crudo.mac)
            continue;

        equipos.push({
            nombre: crudo.nombre ?? '',
            mac: crudo.mac,
            destino: crudo.destino ?? '',
            puerto: Number.isFinite(crudo.puerto) ? crudo.puerto : PUERTO_POR_DEFECTO,
        });
    }

    return equipos;
}

/**
 * Con qué datos se enciende un equipo del menú, si es que se puede.
 *
 * @param {object} host equipo del menú
 * @param {object[]} [equipos] equipos dados de alta en Wake on LAN
 * @returns {{mac: string, destino: string, puerto: number}|null} datos del envío
 */
export function datosWolDe(host, equipos = []) {
    // El comentario del propio bloque manda: es lo más cercano al equipo.
    if (host.mac && parsearMac(host.mac)) {
        return {
            mac: host.mac,
            destino: host.difusion ?? '',
            puerto: PUERTO_POR_DEFECTO,
        };
    }

    const normalizar = t => (t ?? '').trim().toLowerCase();
    const alias = normalizar(host.nombre);
    const anfitrion = normalizar(host.host);

    const equipo = equipos.find(e => {
        const nombre = normalizar(e.nombre);
        return nombre !== '' && (nombre === alias || nombre === anfitrion);
    });

    if (!equipo || !parsearMac(equipo.mac))
        return null;

    return {mac: equipo.mac, destino: equipo.destino, puerto: equipo.puerto};
}

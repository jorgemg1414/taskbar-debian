/*
 * wol.js — Wake-on-LAN: paquete mágico, lista de equipos y MAC aprendidas.
 *
 * Módulo compartido: lo usan la extensión «Wake on LAN», que es la dueña de la
 * lista de equipos, y los menús de SSH y de VNC, que ofrecen encender el equipo
 * que no responde sin salir de su propio menú.
 *
 * El paquete mágico son 102 bytes: seis 0xFF seguidos de la MAC repetida
 * dieciséis veces, mandados por UDP a la dirección de difusión de la red donde
 * vive el equipo. La tarjeta lo reconoce con el ordenador apagado —sigue
 * alimentada— y lo enciende.
 *
 * Cuando quien pregunta es un menú que no lleva MAC escrita (SSH, VNC), sale de
 * uno de estos tres sitios, en este orden:
 *
 *   1. Un comentario «# MAC: aa:bb:cc:dd:ee:ff» en el bloque del ~/.ssh/config.
 *   2. Los equipos que ya tengas dados de alta en la extensión Wake on LAN,
 *      emparejando por nombre con el alias del bloque.
 *   3. La que se haya aprendido sola de la tabla ARP del sistema.
 *
 * Lo tercero es lo que evita tener que apuntar nada: para pintar el punto verde
 * el menú abre un socket contra cada equipo, y esa conversación deja la MAC del
 * equipo en la tabla ARP del núcleo. Basta con leerla de ahí mientras responde,
 * y queda guardada para el día que aparezca en rojo.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {loadContents} from './asyncgio.js';

// Tabla ARP del núcleo. Solo tiene IPv4, y solo los equipos del mismo segmento
// de red: para el resto, lo que hay ahí es la MAC del router, no la suya.
const RUTA_ARP = '/proc/net/arp';

// Puerto habitual del paquete mágico. El 7 (echo) también se usa.
export const PUERTO_POR_DEFECTO = 9;

// Puerto TCP que se sondea para saber si un equipo está encendido, cuando la
// sonda no lleva ninguno. El 22 es el de SSH: si el equipo también sale en el
// menú de SSH, ya lo tiene abierto.
export const PUERTO_SONDA = 22;

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
        console.warn(`[wol] No se pudieron leer los equipos de Wake on LAN: ${e.message}`);
        return null;
    }
}

/**
 * Interpreta la dirección con la que se comprueba si un equipo está encendido.
 *
 * Se admite «host», «host:puerto» y «[IPv6]:puerto». Sin puerto se usa el de
 * SSH, que es el que suelen tener abierto los equipos que están en el menú.
 *
 * @param {string} texto dirección tal cual la escribió el usuario
 * @returns {{host: string, port: number}|null} destino del sondeo, o null
 */
export function parsearSonda(texto) {
    const limpio = (texto ?? '').trim();
    if (limpio === '')
        return null;

    const puertoDe = numero => {
        const n = parseInt(numero, 10);
        return Number.isFinite(n) && n > 0 && n <= 65535 ? n : PUERTO_SONDA;
    };

    // «[2001:db8::1]:445»: IPv6 literal con puerto.
    const corchetes = limpio.match(/^\[(.+)\]:(\d+)$/);
    if (corchetes)
        return {host: corchetes[1], port: puertoDe(corchetes[2])};

    // Un solo ':' con cifras detrás es «host:puerto»; varios son un IPv6 suelto,
    // que no puede llevar puerto sin corchetes.
    const trozos = limpio.split(':');
    if (trozos.length === 2 && /^\d+$/.test(trozos[1]) && trozos[0] !== '')
        return {host: trozos[0], port: puertoDe(trozos[1])};

    return {host: limpio.replace(/^\[|\]$/g, ''), port: PUERTO_SONDA};
}

/**
 * Lee la lista de equipos de los ajustes de Wake on LAN. Cada entrada es un
 * JSON, tal como los guarda esa extensión.
 *
 * Admite un settings nulo —la extensión puede no estar instalada— y devuelve
 * entonces una lista vacía.
 *
 * @param {Gio.Settings|null} settings ajustes de Wake on LAN
 * @returns {object[]} equipos con nombre, mac, destino y puerto
 */
export function leerEquipos(settings) {
    if (!settings)
        return [];

    const equipos = [];
    for (const linea of settings.get_strv('equipos')) {
        let crudo;
        try {
            crudo = JSON.parse(linea);
        } catch {
            console.warn(`[wol] Entrada ilegible en los ajustes: ${linea}`);
            continue;
        }

        if (!crudo || typeof crudo !== 'object' || !crudo.mac)
            continue;

        equipos.push({
            // Sin nombre, la MAC es lo único que identifica al equipo, y es
            // mejor eso que una fila en blanco en el menú.
            nombre: crudo.nombre || formatearMac(crudo.mac) || 'Equipo',
            mac: crudo.mac,
            destino: crudo.destino ?? '',
            puerto: Number.isFinite(crudo.puerto) ? crudo.puerto : PUERTO_POR_DEFECTO,
            // Dirección con la que se comprueba si ya está encendido. Es
            // opcional: sin ella, del equipo solo se sabe que se le mandó el
            // paquete.
            sonda: crudo.sonda ?? '',
        });
    }

    return equipos;
}

/**
 * Guarda la lista de equipos en los ajustes de Wake on LAN.
 *
 * @param {Gio.Settings} settings ajustes de Wake on LAN
 * @param {object[]} equipos equipos a guardar
 */
export function guardarEquipos(settings, equipos) {
    settings.set_strv('equipos', equipos.map(e => JSON.stringify({
        nombre: e.nombre ?? '',
        mac: e.mac ?? '',
        destino: e.destino ?? '',
        puerto: Number.isFinite(e.puerto) ? e.puerto : PUERTO_POR_DEFECTO,
        sonda: e.sonda ?? '',
    })));
}

/**
 * ¿Es una dirección IPv4 literal? Solo de esas se puede aprender la MAC, que es
 * como están indexadas en la tabla ARP.
 *
 * @param {string} texto host tal cual sale del archivo de configuración
 * @returns {boolean} true si es una IPv4
 */
export function esIPv4(texto) {
    const inet = Gio.InetAddress.new_from_string((texto ?? '').trim());
    return inet !== null && inet.get_family() === Gio.SocketFamily.IPV4;
}

/**
 * Interpreta el contenido de /proc/net/arp.
 *
 * Cada línea trae «IP, tipo, banderas, MAC, máscara, interfaz». Las entradas
 * incompletas —una IP a la que se preguntó y no contestó— llevan las banderas
 * a 0x0 y la MAC a ceros: esas no dicen nada y se descartan.
 *
 * @param {string} texto contenido del archivo
 * @returns {Map<string, string>} IP -> MAC en forma canónica
 */
export function parsearTablaArp(texto) {
    const tabla = new Map();

    // La primera línea es la cabecera de columnas.
    for (const linea of texto.split('\n').slice(1)) {
        const campos = linea.trim().split(/\s+/);
        if (campos.length < 4)
            continue;

        const [ip, , banderas, mac] = campos;
        if (banderas === '0x0')
            continue;

        const canonica = formatearMac(mac);
        if (!canonica || canonica === '00:00:00:00:00:00')
            continue;

        tabla.set(ip, canonica);
    }

    return tabla;
}

/**
 * Lee la tabla ARP del sistema sin bloquear el hilo principal.
 *
 * Es un archivo de /proc: dice medir cero bytes, pero se lee entero igual.
 *
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<Map<string, string>>} IP -> MAC (vacía si no se pudo leer)
 */
export async function leerTablaArp(cancellable = null) {
    try {
        const bytes = await loadContents(Gio.File.new_for_path(RUTA_ARP), cancellable);
        return parsearTablaArp(new TextDecoder('utf-8', {fatal: false}).decode(bytes));
    } catch (e) {
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            console.warn(`[wol] No se pudo leer ${RUTA_ARP}: ${e.message}`);
        return new Map();
    }
}

/**
 * Con qué datos se enciende un equipo del menú, si es que se puede.
 *
 * @param {object} host equipo del menú
 * @param {object[]} [equipos] equipos dados de alta en Wake on LAN
 * @param {string} [macAprendida] MAC que se aprendió de la tabla ARP
 * @returns {{mac: string, destino: string, puerto: number}|null} datos del envío
 */
export function datosWolDe(host, equipos = [], macAprendida = '') {
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

    if (equipo && parsearMac(equipo.mac))
        return {mac: equipo.mac, destino: equipo.destino, puerto: equipo.puerto};

    // Lo aprendido va el último: si has escrito una MAC a mano, manda la tuya.
    //
    // Una MAC solo se aprende de un equipo del mismo segmento de red, así que
    // la difusión limitada (255.255.255.255) le llega: no hay que atravesar
    // ningún router.
    if (macAprendida && parsearMac(macAprendida))
        return {mac: macAprendida, destino: '', puerto: PUERTO_POR_DEFECTO};

    return null;
}

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

// Milisegundos que se espera antes de mirar la tabla ARP. Al abrir un menú
// responden varios equipos casi a la vez: así se lee el archivo una sola vez.
const RETARDO_ARP_MS = 800;

// Segundos que se da por buena una MAC ya aprendida sin volver a guardarla, para
// no escribir en los ajustes cada vez que se comprueba un equipo.
const FRESCURA_MAC_S = 3600;

// Cuántas MAC aprendidas se recuerdan. Al pasarse, se olvidan las más viejas.
const MAX_MACS = 200;

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

        // Sin MAC solo vale la pena guardar el equipo si se le puede aprender:
        // hace falta su dirección para encontrarlo en la tabla ARP.
        if (!crudo || typeof crudo !== 'object' || (!crudo.mac && !crudo.sonda))
            continue;

        equipos.push({
            // Sin nombre, la MAC es lo único que identifica al equipo, y es
            // mejor eso que una fila en blanco en el menú.
            nombre: crudo.nombre || formatearMac(crudo.mac) || crudo.sonda || 'Equipo',
            mac: crudo.mac ?? '',
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

/* -------------------------------------------------------------------------
 * MAC aprendidas de la tabla ARP
 * ------------------------------------------------------------------------- */

/**
 * Las MAC que se han visto en la tabla ARP, guardadas en los ajustes de la
 * extensión que la use.
 *
 * Es lo que evita tener que apuntar ninguna MAC a mano: para pintar el punto
 * verde, los menús abren un socket contra cada equipo, y esa conversación deja
 * su MAC en la tabla ARP del núcleo. Basta con leerla de ahí mientras el equipo
 * responde, y queda guardada para el día que aparezca en rojo.
 *
 * La extensión que la use tiene que declarar en su esquema las claves
 * «learn-macs» (booleana) y «macs-aprendidas» (lista de cadenas).
 */
export class CacheMacs {
    /**
     * @param {Gio.Settings} settings ajustes de la extensión
     * @param {string} etiqueta nombre para los avisos del registro
     */
    constructor(settings, etiqueta = 'wol') {
        this._settings = settings;
        this._etiqueta = etiqueta;
        // IP -> {mac, visto}
        this._macs = new Map();
        this._idRetardo = 0;
        this._cancellable = new Gio.Cancellable();
        this._destruido = false;

        this._cargar();
    }

    /**
     * MAC aprendida de una IP, si se sabe.
     *
     * @param {string} ip dirección del equipo
     * @returns {string} MAC canónica, o cadena vacía
     */
    macDe(ip) {
        return this._macs.get(ip)?.mac ?? '';
    }

    /**
     * Programa una lectura de la tabla ARP, agrupando las de varios equipos.
     *
     * @param {Function} obtenerIps devuelve las IP de los equipos que responden
     *   ahora mismo; se llama al vencer el retardo, no al programar
     */
    programar(obtenerIps) {
        if (this._destruido || this._idRetardo)
            return;
        if (!this._settings.get_boolean('learn-macs'))
            return;

        this._idRetardo = GLib.timeout_add(GLib.PRIORITY_LOW, RETARDO_ARP_MS, () => {
            this._idRetardo = 0;
            this._aprender(obtenerIps());
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Apunta la MAC de los equipos indicados.
     *
     * Solo se aceptan las entradas cuya IP es exactamente la del equipo: eso es
     * lo que garantiza que la MAC es suya y no la del router por el que se
     * llega a él. Por lo mismo, un nombre de host no vale: hay que dar la IP.
     *
     * @param {string[]} ips direcciones de equipos que están respondiendo
     */
    _aprender(ips) {
        const candidatas = [...new Set(ips)].filter(ip => esIPv4(ip));
        if (candidatas.length === 0)
            return;

        leerTablaArp(this._cancellable)
            .then(tabla => {
                if (this._destruido || tabla.size === 0)
                    return;

                const ahora = Math.floor(Date.now() / 1000);
                let cambios = false;

                for (const ip of candidatas) {
                    const mac = tabla.get(ip);
                    if (!mac)
                        continue;

                    // Si ya la teníamos y es reciente, no se reescribe: esto
                    // pasa por cada comprobación de cada equipo.
                    const previa = this._macs.get(ip);
                    if (previa?.mac === mac && ahora - previa.visto < FRESCURA_MAC_S)
                        continue;

                    this._macs.set(ip, {mac, visto: ahora});
                    cambios = true;
                }

                if (cambios)
                    this._guardar();
            })
            .catch(e => {
                if (!this._destruido)
                    console.warn(`[${this._etiqueta}] No se pudieron aprender las MAC: ${e.message}`);
            });
    }

    /**
     * Recupera de los ajustes las MAC aprendidas en sesiones anteriores.
     */
    _cargar() {
        this._macs.clear();

        for (const linea of this._settings.get_strv('macs-aprendidas')) {
            try {
                const {ip, mac, visto} = JSON.parse(linea);
                if (ip && mac)
                    this._macs.set(ip, {mac, visto: Number(visto) || 0});
            } catch {
                // Una entrada ilegible se descarta: es una caché, no hay nada
                // que salvar.
            }
        }
    }

    /**
     * Guarda las MAC aprendidas, quedándose con las vistas más recientemente.
     */
    _guardar() {
        const entradas = [...this._macs.entries()]
            .sort((a, b) => b[1].visto - a[1].visto)
            .slice(0, MAX_MACS);

        // El recorte también se aplica en memoria, para que ambas cosas digan
        // lo mismo.
        this._macs = new Map(entradas);

        this._settings.set_strv('macs-aprendidas', entradas.map(
            ([ip, {mac, visto}]) => JSON.stringify({ip, mac, visto})));
    }

    /**
     * Suelta el temporizador y la lectura en vuelo. Se llama desde disable().
     */
    destruir() {
        this._destruido = true;

        if (this._idRetardo) {
            GLib.source_remove(this._idRetardo);
            this._idRetardo = 0;
        }

        this._cancellable.cancel();
        this._macs.clear();
        this._settings = null;
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

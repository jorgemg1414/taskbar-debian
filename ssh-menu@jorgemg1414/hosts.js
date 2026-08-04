/*
 * hosts.js — Lectura y parseo asíncrono de ~/.ssh/config.
 *
 * El archivo de configuración de OpenSSH es texto plano por bloques:
 *
 *     # Grupo: SUCURSALES
 *     Host oficina-norte
 *         HostName 10.20.0.5
 *         User jorge
 *         Port 2222
 *
 * De cada bloque «Host» sale una entrada del menú. Los patrones con comodines
 * (`Host *`, `Host *.ejemplo.net`) no son equipos concretos: el bloque `Host *`
 * se guarda como valores por omisión y el resto se descarta.
 *
 * También se siguen las directivas `Include`, que es como se suele partir la
 * configuración en varios archivos.
 *
 * Nada de esto toca las claves ni el agente: solo se leen los datos que hacen
 * falta para pintar el menú (alias, host, puerto, usuario y salto).
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {queryInfo, enumerateChildren, nextFiles, closeEnumerator, loadContents} from './asyncgio.js';

// Etiqueta usada cuando un host no pertenece a ningún grupo.
export const GRUPO_SIN_NOMBRE = 'Sin grupo';

// Puerto de SSH por omisión.
export const PUERTO_SSH = 22;

// Profundidad máxima de `Include` anidados (evita bucles y árboles enormes).
const PROFUNDIDAD_MAX = 4;

// Contenido del archivo que se crea cuando todavía no hay ninguno, para que
// «Editar config» sirva de punto de partida en vez de abrir un archivo vacío.
export const PLANTILLA_CONFIG = `# Configuración de SSH — la lee tanto el comando ssh como el menú de la barra.
#
# Cada bloque «Host» es una entrada del menú. El alias es lo que escribes
# después de ssh, y lo que se ve en la lista.
#
# Las líneas «# Grupo: NOMBRE» agrupan los bloques que vienen a continuación,
# hasta la siguiente línea de grupo.

# Grupo: EJEMPLOS

Host servidor-ejemplo
    HostName 192.168.1.10
    User jorge
    Port 22

# Un equipo al que solo se llega saltando por otro:
#
# Host interno
#     HostName 10.0.0.5
#     User jorge
#     ProxyJump servidor-ejemplo

# Valores por omisión para todos los equipos:
Host *
    ServerAliveInterval 60
    ServerAliveCountMax 3
`;

/**
 * Expande '~' al directorio personal y normaliza la ruta.
 *
 * @param {string} ruta ruta tal cual viene de GSettings
 * @returns {string} ruta absoluta
 */
export function expandirRuta(ruta) {
    if (!ruta)
        return '';

    let r = ruta.trim();
    if (r === '~')
        r = GLib.get_home_dir();
    else if (r.startsWith('~/'))
        r = GLib.build_filenamev([GLib.get_home_dir(), r.slice(2)]);

    // Permite rutas relativas al home por comodidad (p. ej. ".ssh/config").
    if (!GLib.path_is_absolute(r))
        r = GLib.build_filenamev([GLib.get_home_dir(), r]);

    return r;
}

/**
 * Quita las comillas que OpenSSH admite alrededor de un valor.
 *
 * @param {string} valor valor bruto
 * @returns {string} valor limpio
 */
function limpiarValor(valor) {
    const v = valor.trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"'))
        return v.slice(1, -1);
    return v;
}

/**
 * Separa una línea en clave y valor. OpenSSH acepta tanto «Clave valor» como
 * «Clave=valor», y la clave no distingue mayúsculas.
 *
 * @param {string} linea línea ya recortada
 * @returns {[string, string]|null} par clave/valor, o null si no es una directiva
 */
function partirLinea(linea) {
    const corte = linea.search(/[\s=]/);
    if (corte <= 0)
        return null;

    const clave = linea.slice(0, corte).toLowerCase();
    // Si el separador era '=' (con o sin espacios), sobra al principio del valor.
    const valor = limpiarValor(linea.slice(corte).replace(/^\s*=?\s*/, ''));
    return [clave, valor];
}

/**
 * Un patrón con comodines o negado no es un equipo concreto.
 *
 * @param {string} alias alias declarado en el bloque Host
 * @returns {boolean} si es un patrón y no un nombre
 */
function esPatron(alias) {
    return /[*?!]/.test(alias);
}

/**
 * Convierte un patrón de nombre de archivo (`*.conf`) en expresión regular.
 *
 * @param {string} patron patrón con '*' y '?'
 * @returns {RegExp} expresión equivalente, anclada
 */
function patronARegExp(patron) {
    const escapado = patron.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escapado.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}

/**
 * Grupo que se asigna por omisión a los hosts de un archivo incluido: el
 * nombre del archivo sin extensión, que suele ser justo cómo lo tienes
 * partido (trabajo.conf, clientes.conf…).
 *
 * @param {string} ruta ruta del archivo incluido
 * @returns {string} nombre del grupo
 */
function grupoDeArchivo(ruta) {
    const base = GLib.path_get_basename(ruta);
    const punto = base.lastIndexOf('.');
    return punto > 0 ? base.slice(0, punto) : base;
}

/**
 * Lista los nombres de los archivos de un directorio.
 *
 * @param {string} ruta directorio a listar
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<string[]>} nombres ordenados alfabéticamente
 */
async function listarArchivos(ruta, cancellable) {
    const nombres = [];
    let enumerador;

    try {
        enumerador = await enumerateChildren(
            Gio.File.new_for_path(ruta),
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE,
            cancellable);
    } catch (e) {
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            console.warn(`[ssh-menu] No se pudo leer ${ruta}: ${e.message}`);
        return nombres;
    }

    for (;;) {
        let lote;
        try {
            lote = await nextFiles(enumerador, 50, cancellable);
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`[ssh-menu] Error enumerando ${ruta}: ${e.message}`);
            break;
        }

        if (!lote || lote.length === 0)
            break;

        for (const info of lote) {
            if (info.get_file_type() === Gio.FileType.REGULAR)
                nombres.push(info.get_name());
        }
    }

    try {
        await closeEnumerator(enumerador);
    } catch {
        // Cerrar el enumerador es best-effort.
    }

    nombres.sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
    return nombres;
}

/**
 * Guarda un bloque Host terminado en el acumulador, una entrada por alias.
 *
 * @param {object} bloque bloque recién cerrado
 * @param {string} ruta archivo del que salió
 * @param {object} acc acumulador del escaneo
 */
function emitirBloque(bloque, ruta, acc) {
    for (const alias of bloque.alias) {
        // `Host *` son los valores por omisión de todos los equipos.
        if (alias === '*') {
            for (const [clave, valor] of bloque.claves) {
                if (!acc.globales.has(clave))
                    acc.globales.set(clave, valor);
            }
            continue;
        }

        if (esPatron(alias))
            continue;

        acc.brutos.push({
            alias,
            claves: bloque.claves,
            grupo: bloque.grupo,
            ruta,
            linea: bloque.linea,
        });
    }
}

/**
 * Resuelve una directiva `Include` y lee los archivos que apunta.
 *
 * Las rutas relativas van contra la carpeta del archivo que incluye (que es lo
 * que hace OpenSSH con la configuración del usuario), y se admiten comodines
 * en el último tramo de la ruta.
 *
 * @param {string} patrones valor de la directiva (puede llevar varios patrones)
 * @param {string} rutaPadre archivo que contiene el Include
 * @param {number} profundidad nivel actual de anidamiento
 * @param {Gio.Cancellable} cancellable cancelable
 * @param {object} acc acumulador del escaneo
 * @returns {Promise<void>} promesa resuelta al terminar
 */
async function resolverInclude(patrones, rutaPadre, profundidad, cancellable, acc) {
    for (const trozo of patrones.split(/\s+/)) {
        if (!trozo)
            continue;

        let ruta = trozo;
        if (ruta.startsWith('~'))
            ruta = expandirRuta(ruta);
        else if (!GLib.path_is_absolute(ruta))
            ruta = GLib.build_filenamev([GLib.path_get_dirname(rutaPadre), ruta]);

        if (!/[*?]/.test(ruta)) {
            await leerConfig(ruta, grupoDeArchivo(ruta), profundidad + 1, cancellable, acc);
            continue;
        }

        const carpeta = GLib.path_get_dirname(ruta);
        const patron = patronARegExp(GLib.path_get_basename(ruta));
        for (const nombre of await listarArchivos(carpeta, cancellable)) {
            if (!patron.test(nombre))
                continue;
            const hijo = GLib.build_filenamev([carpeta, nombre]);
            await leerConfig(hijo, grupoDeArchivo(hijo), profundidad + 1, cancellable, acc);
        }
    }
}

/**
 * Lee un archivo de configuración y acumula sus bloques Host.
 *
 * @param {string} ruta archivo a leer
 * @param {string} grupoBase grupo por omisión de los hosts de este archivo
 * @param {number} profundidad nivel de anidamiento de Include
 * @param {Gio.Cancellable} cancellable cancelable
 * @param {object} acc acumulador del escaneo
 * @returns {Promise<void>} promesa resuelta al terminar el archivo
 */
async function leerConfig(ruta, grupoBase, profundidad, cancellable, acc) {
    if (profundidad > PROFUNDIDAD_MAX)
        return;

    // Se normaliza la ruta para que un Include circular no se lea dos veces.
    const canonica = GLib.canonicalize_filename(ruta, null);
    if (acc.vistos.has(canonica))
        return;
    acc.vistos.add(canonica);

    let texto;
    try {
        const bytes = await loadContents(Gio.File.new_for_path(canonica), cancellable);
        texto = new TextDecoder('utf-8', {fatal: false}).decode(bytes);
    } catch (e) {
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            console.warn(`[ssh-menu] No se pudo leer ${canonica}: ${e.message}`);
        return;
    }

    acc.archivos.push(canonica);

    let grupo = grupoBase;
    let bloque = null;

    const cerrarBloque = () => {
        if (bloque)
            emitirBloque(bloque, canonica, acc);
        bloque = null;
    };

    const lineas = texto.split(/\r?\n/);
    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i].trim();
        if (!linea)
            continue;

        if (linea.startsWith('#')) {
            // Comentario de agrupación: «# Grupo: SUCURSALES».
            const etiqueta = linea.match(/^#+\s*(?:grupo|group)\s*[:=]\s*(.+)$/i);
            if (etiqueta)
                grupo = etiqueta[1].trim();
            continue;
        }

        const par = partirLinea(linea);
        if (!par)
            continue;
        const [clave, valor] = par;

        if (clave === 'host') {
            cerrarBloque();
            const alias = valor.split(/\s+/).filter(a => a !== '');
            if (alias.length > 0)
                bloque = {alias, claves: new Map(), grupo, linea: i + 1};
        } else if (clave === 'match') {
            // Los bloques Match son condicionales: no describen un equipo.
            cerrarBloque();
        } else if (clave === 'include') {
            cerrarBloque();
            await resolverInclude(valor, canonica, profundidad, cancellable, acc);
        } else if (bloque && !bloque.claves.has(clave)) {
            // ssh se queda con el primer valor de cada clave, no con el último.
            bloque.claves.set(clave, valor);
        }
    }

    cerrarBloque();
}

/**
 * Convierte un bloque en el objeto que consume el menú.
 *
 * @param {object} bruto bloque acumulado durante el escaneo
 * @param {Map<string, string>} globales claves del bloque `Host *`
 * @returns {object} host listo para pintar
 */
function construirHost(bruto, globales) {
    // Los valores propios del bloque mandan; los de `Host *` son el respaldo.
    const conRespaldo = clave => bruto.claves.get(clave) ?? globales.get(clave) ?? '';

    // HostName admite %h, que es el alias tal cual se escribió.
    const nombreReal = (bruto.claves.get('hostname') || bruto.alias).replace(/%h/g, bruto.alias);

    let port = parseInt(conRespaldo('port'), 10);
    if (!Number.isFinite(port) || port <= 0 || port > 65535)
        port = PUERTO_SSH;

    return {
        // Identificador estable para asociar el estado con el elemento de menú.
        id: `${bruto.ruta}#${bruto.alias}`,
        nombre: bruto.alias,
        alias: bruto.alias,
        host: nombreReal.trim(),
        port,
        usuario: conRespaldo('user'),
        // Si hay salto, la conexión no es directa: el punto de estado no vale.
        salto: bruto.claves.get('proxyjump') ?? '',
        ruta: bruto.ruta,
        linea: bruto.linea,
        grupo: bruto.grupo || GRUPO_SIN_NOMBRE,
    };
}

/**
 * Lee la configuración de SSH sin bloquear el hilo principal.
 *
 * @param {string} rutaConfig archivo principal (admite '~')
 * @param {Gio.Cancellable} cancellable cancelable para abortar en disable()
 * @returns {Promise<{ok: boolean, motivo: string, hosts: object[], archivos: string[]}>} resultado
 */
export async function escanearHosts(rutaConfig, cancellable) {
    const ruta = expandirRuta(rutaConfig);
    const file = Gio.File.new_for_path(ruta);

    try {
        const info = await queryInfo(file, 'standard::type', Gio.FileQueryInfoFlags.NONE, cancellable);
        if (info.get_file_type() !== Gio.FileType.REGULAR)
            return {ok: false, motivo: 'inexistente', hosts: [], archivos: []};
    } catch (e) {
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            return {ok: false, motivo: 'cancelado', hosts: [], archivos: []};
        return {ok: false, motivo: 'inexistente', hosts: [], archivos: []};
    }

    const acc = {brutos: [], archivos: [], globales: new Map(), vistos: new Set()};
    await leerConfig(ruta, '', 0, cancellable, acc);

    if (cancellable?.is_cancelled())
        return {ok: false, motivo: 'cancelado', hosts: [], archivos: []};

    // Si un alias aparece dos veces, manda el primero: es lo que hace ssh.
    const vistos = new Set();
    const hosts = [];
    for (const bruto of acc.brutos) {
        if (vistos.has(bruto.alias))
            continue;
        vistos.add(bruto.alias);
        hosts.push(construirHost(bruto, acc.globales));
    }

    // Orden alfabético por grupo y, dentro del grupo, por alias.
    const comparar = (a, b) => a.localeCompare(b, undefined, {sensitivity: 'base', numeric: true});
    hosts.sort((a, b) => comparar(a.grupo, b.grupo) || comparar(a.nombre, b.nombre));

    return {
        ok: true,
        motivo: hosts.length === 0 ? 'vacia' : 'ok',
        hosts,
        archivos: acc.archivos,
    };
}

/**
 * Agrupa una lista de hosts en un array de grupos ordenados.
 *
 * @param {object[]} hosts hosts ya ordenados
 * @returns {{nombre: string, hosts: object[]}[]} grupos listos para pintar
 */
export function agruparHosts(hosts) {
    const grupos = new Map();
    for (const h of hosts) {
        if (!grupos.has(h.grupo))
            grupos.set(h.grupo, []);
        grupos.get(h.grupo).push(h);
    }
    return [...grupos.entries()].map(([nombre, lista]) => ({nombre, hosts: lista}));
}

/**
 * Destino tal como se escribiría en la terminal: «usuario@host».
 *
 * @param {object} host host del menú
 * @returns {string} destino legible
 */
export function destinoSsh(host) {
    return host.usuario ? `${host.usuario}@${host.host}` : host.host;
}

/**
 * URL de SFTP de un host, la que entiende el gestor de archivos.
 *
 * @param {object} host host del menú
 * @param {string} [subruta] carpeta remota de inicio; vacío deja que el
 *   servidor te sitúe en tu carpeta personal
 * @returns {string} URL sftp://
 */
export function uriSftp(host, subruta = '') {
    const usuario = host.usuario ? `${encodeURIComponent(host.usuario)}@` : '';
    // IPv6 literal necesita corchetes dentro de la URL.
    const anfitrion = host.host.includes(':') ? `[${host.host}]` : host.host;
    const puerto = host.port && host.port !== PUERTO_SSH ? `:${host.port}` : '';

    const limpia = subruta.trim();
    const camino = limpia === '' ? '' : (limpia.startsWith('/') ? limpia : `/${limpia}`);

    return `sftp://${usuario}${anfitrion}${puerto}${camino}`;
}

/**
 * Crea el archivo de configuración con un ejemplo comentado si no existe.
 *
 * La escritura es síncrona a propósito: son dos kilobytes en local, en
 * respuesta a una pulsación, y así se puede abrir el editor justo después
 * sabiendo que el archivo ya está ahí. Se crea con permisos 600, como espera
 * OpenSSH.
 *
 * @param {string} rutaConfig ruta del archivo (admite '~')
 * @returns {boolean} true si lo ha creado ahora, false si ya existía
 */
export function crearConfigSiFalta(rutaConfig) {
    const ruta = expandirRuta(rutaConfig);
    const file = Gio.File.new_for_path(ruta);

    if (file.query_exists(null))
        return false;

    const carpeta = file.get_parent();
    if (carpeta && !carpeta.query_exists(null))
        carpeta.make_directory_with_parents(null);

    file.replace_contents(
        new TextEncoder().encode(PLANTILLA_CONFIG),
        null,
        false,
        Gio.FileCreateFlags.PRIVATE,
        null);

    return true;
}

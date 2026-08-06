/*
 * tareas.js — Las casillas de tus archivos Markdown, leídas y marcadas.
 *
 * Una tarea es una línea de lista con una casilla, que es como se escriben en
 * Markdown desde siempre:
 *
 *     ## Sucursales
 *     - [ ] Cambiar el disco de Bodega
 *     - [x] Autorizar la clave en Mapelo
 *
 * El archivo es tuyo y sigue siéndolo: aquí no hay base de datos ni servicio,
 * solo se leen esas líneas y se cambia el hueco de la casilla cuando marcas una
 * desde el menú. Todo lo demás del archivo se queda exactamente como estaba.
 *
 * Marcar una tarea es lo único que escribe en tus archivos en todo el
 * repositorio, así que se hace con dos seguros encima:
 *
 *   1. Se relee el archivo justo antes de escribir y se comprueba que en esa
 *      línea sigue estando esa misma tarea, con el estado que se esperaba. Si
 *      no, no se toca nada y se avisa.
 *   2. Se escribe pasándole a GIO el etag de lo que se acaba de leer, así que
 *      si el archivo cambió entre medias —lo estabas editando— la escritura se
 *      rechaza en vez de pisar tu edición.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    queryInfo, enumerateChildren, nextFiles, closeEnumerator,
    loadContentsWithEtag, replaceContents,
} from './asyncgio.js';

// Grupo de las tareas que no tienen ningún encabezado por encima.
export const SIN_ENCABEZADO = 'Sin encabezado';

// Extensiones que se miran al escanear una carpeta.
const EXTENSIONES = ['.md', '.markdown', '.txt'];

// Una línea de lista con casilla, partida en cinco trozos: la sangría, lo que
// va hasta el corchete, el hueco de la casilla, el cierre con sus espacios y el
// texto. Se parte así para poder rehacerla cambiando solo el hueco: al marcar
// una tarea, el archivo cambia en un carácter y en ninguno más.
const TAREA = /^(\s*)([-*+]\s+\[)([ xX])(\]\s*)(.*)$/;

// Un encabezado de Markdown: «## Sucursales».
const ENCABEZADO = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

// Apertura o cierre de un bloque de código, donde lo que parece una tarea no lo
// es: son ejemplos, como los de los README de este mismo repositorio.
const CERCA = /^\s*(```|~~~)/;

// Contenido del archivo que se crea cuando todavía no hay ninguno, para que
// «Editar» sirva de punto de partida en vez de abrir un archivo vacío.
export const PLANTILLA = `# Pendientes

Este archivo es tuyo: el menú solo lee las líneas con casilla y marca la que
pulses. Todo lo demás —texto, listas, notas— se queda como esté.

## Ejemplos

- [ ] Una tarea pendiente
- [ ] Otra que también sale en el menú
- [x] Una hecha, que por omisión no se muestra

Los encabezados agrupan lo que viene debajo, así que las tres de arriba salen
bajo «Ejemplos».
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

    if (!GLib.path_is_absolute(r))
        r = GLib.build_filenamev([GLib.get_home_dir(), r]);

    return r;
}

/**
 * Nombre del archivo sin extensión, que es como se le llama en el menú.
 *
 * @param {string} ruta ruta del archivo
 * @returns {string} nombre legible
 */
function nombreDe(ruta) {
    const base = GLib.path_get_basename(ruta);
    const punto = base.lastIndexOf('.');
    return punto > 0 ? base.slice(0, punto) : base;
}

/**
 * Saca las tareas de un texto en Markdown.
 *
 * @param {string} texto contenido del archivo
 * @param {string} ruta ruta del archivo, para poder volver a él
 * @returns {object[]} tareas en el orden en que están escritas
 */
export function parsearTareas(texto, ruta) {
    const tareas = [];
    const archivo = nombreDe(ruta);

    let encabezado = '';
    let enCodigo = false;

    const lineas = texto.split(/\r?\n/);
    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i];

        if (CERCA.test(linea)) {
            enCodigo = !enCodigo;
            continue;
        }
        if (enCodigo)
            continue;

        const titulo = linea.match(ENCABEZADO);
        if (titulo) {
            encabezado = titulo[2].trim();
            continue;
        }

        const tarea = linea.match(TAREA);
        if (!tarea)
            continue;

        const texto_ = tarea[5].trim();
        if (texto_ === '')
            continue;

        tareas.push({
            // La línea forma parte del identificador porque es lo que se
            // reescribe; si el archivo cambia, se rehace la lista entera.
            id: `${ruta}#${i + 1}`,
            ruta,
            archivo,
            linea: i + 1,
            sangria: tarea[1].length,
            hecha: tarea[3] !== ' ',
            texto: texto_,
            encabezado,
            grupo: encabezado || SIN_ENCABEZADO,
        });
    }

    return tareas;
}

/**
 * Lista los archivos de texto de una carpeta, sin entrar en subcarpetas.
 *
 * @param {string} ruta carpeta a listar
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<string[]>} rutas completas, ordenadas por nombre
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
            console.warn(`[pendientes] No se pudo leer ${ruta}: ${e.message}`);
        return nombres;
    }

    for (;;) {
        let lote;
        try {
            lote = await nextFiles(enumerador, 50, cancellable);
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`[pendientes] Error enumerando ${ruta}: ${e.message}`);
            break;
        }

        if (!lote || lote.length === 0)
            break;

        for (const info of lote) {
            if (info.get_file_type() !== Gio.FileType.REGULAR)
                continue;
            const nombre = info.get_name();
            if (EXTENSIONES.some(ext => nombre.toLowerCase().endsWith(ext)))
                nombres.push(GLib.build_filenamev([ruta, nombre]));
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
 * Lee las tareas de un archivo o de todos los de una carpeta.
 *
 * @param {string} rutaConfigurada archivo o carpeta (admite '~')
 * @param {Gio.Cancellable} cancellable cancelable para abortar en disable()
 * @returns {Promise<{ok: boolean, motivo: string, tareas: object[], archivos: string[], carpeta: boolean}>} resultado
 */
export async function escanearTareas(rutaConfigurada, cancellable) {
    const ruta = expandirRuta(rutaConfigurada);
    const vacio = {tareas: [], archivos: [], carpeta: false};

    let esCarpeta;
    try {
        const info = await queryInfo(
            Gio.File.new_for_path(ruta), 'standard::type',
            Gio.FileQueryInfoFlags.NONE, cancellable);
        esCarpeta = info.get_file_type() === Gio.FileType.DIRECTORY;
    } catch (e) {
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            return {ok: false, motivo: 'cancelado', ...vacio};
        return {ok: false, motivo: 'inexistente', ...vacio};
    }

    const archivos = esCarpeta ? await listarArchivos(ruta, cancellable) : [ruta];
    const tareas = [];

    for (const archivo of archivos) {
        try {
            const {contenido} = await loadContentsWithEtag(
                Gio.File.new_for_path(archivo), cancellable);
            const texto = new TextDecoder('utf-8', {fatal: false}).decode(contenido);
            tareas.push(...parsearTareas(texto, archivo));
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return {ok: false, motivo: 'cancelado', ...vacio};
            console.warn(`[pendientes] No se pudo leer ${archivo}: ${e.message}`);
        }
    }

    return {
        ok: true,
        motivo: tareas.length === 0 ? 'vacio' : 'ok',
        tareas,
        archivos,
        carpeta: esCarpeta,
    };
}

/**
 * Agrupa las tareas para pintarlas, conservando el orden del archivo.
 *
 * Con varios archivos, el grupo lleva delante el nombre del archivo: dos
 * archivos pueden tener encabezados que se llamen igual.
 *
 * @param {object[]} tareas tareas ya leídas
 * @param {boolean} conArchivo si el nombre del archivo va en el grupo
 * @returns {{nombre: string, tareas: object[]}[]} grupos en orden de aparición
 */
export function agruparTareas(tareas, conArchivo = false) {
    const grupos = new Map();

    for (const tarea of tareas) {
        const nombre = conArchivo
            ? `${tarea.archivo} · ${tarea.grupo}`
            : tarea.grupo;
        if (!grupos.has(nombre))
            grupos.set(nombre, []);
        grupos.get(nombre).push(tarea);
    }

    return [...grupos.entries()].map(([nombre, lista]) => ({nombre, tareas: lista}));
}

/**
 * Reescribe un archivo cambiando solo lo que diga la función que se le pase.
 *
 * Es el camino por el que pasan las cuatro operaciones que tocan un archivo
 * —marcar, editar, añadir y borrar—, para que las tres garantías estén escritas
 * una sola vez: se relee justo antes, se comprueba que lo que hay es lo que se
 * esperaba, y se escribe con el etag de esa lectura.
 *
 * @param {string} ruta archivo a reescribir
 * @param {Function} cambiar recibe las líneas y devuelve las nuevas, o una
 *   cadena con el motivo por el que no se puede seguir
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<string|null>} null si se guardó, o el motivo por el que no
 */
async function reescribir(ruta, cambiar, cancellable) {
    const file = Gio.File.new_for_path(ruta);

    let contenido, etag;
    try {
        ({contenido, etag} = await loadContentsWithEtag(file, cancellable));
    } catch (e) {
        return `no se pudo leer el archivo: ${e.message}`;
    }

    const texto = new TextDecoder('utf-8', {fatal: false}).decode(contenido);
    // Se conserva el final de línea que tuviera el archivo.
    const salto = texto.includes('\r\n') ? '\r\n' : '\n';

    const resultado = cambiar(texto.split(/\r?\n/));
    if (typeof resultado === 'string')
        return resultado;

    try {
        await replaceContents(
            file, new TextEncoder().encode(resultado.join(salto)), etag, cancellable);
    } catch (e) {
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.WRONG_ETAG))
            return 'el archivo cambió mientras tanto: no se ha tocado nada';
        return `no se pudo guardar: ${e.message}`;
    }

    return null;
}

/**
 * Localiza la línea de una tarea y la parte en sus cinco trozos.
 *
 * @param {string[]} lineas líneas del archivo tal como está ahora
 * @param {object} tarea tarea tal como la leyó el escaneo
 * @returns {string[]|string} las partes, o el motivo por el que no cuadra
 */
function partesDe(lineas, tarea) {
    const indice = tarea.linea - 1;
    if (indice < 0 || indice >= lineas.length)
        return 'la tarea ya no está donde estaba: el archivo ha cambiado';

    const partes = lineas[indice].match(TAREA);
    if (!partes || partes[5].trim() !== tarea.texto)
        return 'la tarea ya no está donde estaba: el archivo ha cambiado';

    return partes;
}

/**
 * Marca o desmarca una tarea en su archivo.
 *
 * Solo cambia el hueco de la casilla: la sangría, la viñeta y el texto se
 * copian tal cual, y el resto del archivo ni se toca.
 *
 * @param {object} tarea tarea tal como la leyó el escaneo
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<string|null>} null si se marcó, o el motivo por el que no
 */
export async function alternarTarea(tarea, cancellable = null) {
    return reescribir(tarea.ruta, lineas => {
        const partes = partesDe(lineas, tarea);
        if (typeof partes === 'string')
            return partes;

        // Si alguien la marcó por otro lado, no se le da la vuelta a su cambio.
        const hechaAhora = partes[3] !== ' ';
        if (hechaAhora !== tarea.hecha)
            return 'esa tarea ya la habías marcado en el archivo';

        lineas[tarea.linea - 1] =
            `${partes[1]}${partes[2]}${tarea.hecha ? ' ' : 'x'}${partes[4]}${partes[5]}`;
        return lineas;
    }, cancellable);
}

/**
 * Cambia el texto de una tarea, dejando el resto de la línea como estaba.
 *
 * La casilla, la sangría y la viñeta no se tocan: solo se sustituye lo que hay
 * detrás del corchete. Así se puede corregir una tarea sin abrir el editor.
 *
 * @param {object} tarea tarea tal como la leyó el escaneo
 * @param {string} nuevoTexto texto nuevo, sin la casilla
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<string|null>} null si se guardó, o el motivo por el que no
 */
export async function editarTexto(tarea, nuevoTexto, cancellable = null) {
    const limpio = (nuevoTexto ?? '').replace(/[\r\n]+/g, ' ').trim();
    if (limpio === '')
        return 'una tarea sin texto no es una tarea';

    return reescribir(tarea.ruta, lineas => {
        const partes = partesDe(lineas, tarea);
        if (typeof partes === 'string')
            return partes;

        lineas[tarea.linea - 1] = `${partes[1]}${partes[2]}${partes[3]}${partes[4]}${limpio}`;
        return lineas;
    }, cancellable);
}

/**
 * Borra la línea de una tarea.
 *
 * Se lleva la línea entera, que es lo que se espera de borrar una tarea; lo
 * demás del archivo se queda igual.
 *
 * @param {object} tarea tarea tal como la leyó el escaneo
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<string|null>} null si se borró, o el motivo por el que no
 */
export async function borrarTarea(tarea, cancellable = null) {
    return reescribir(tarea.ruta, lineas => {
        const partes = partesDe(lineas, tarea);
        if (typeof partes === 'string')
            return partes;

        lineas.splice(tarea.linea - 1, 1);
        return lineas;
    }, cancellable);
}

/**
 * Añade una tarea nueva al archivo.
 *
 * Con «despuesDe» se pone justo debajo de esa tarea, con su misma sangría, que
 * es lo que se espera al añadir desde una fila concreta. Sin ella se pone al
 * final del archivo, saltándose las líneas en blanco del final para no dejar un
 * hueco en medio.
 *
 * @param {object} donde dónde va la tarea nueva
 * @param {string} donde.ruta archivo al que se añade
 * @param {object} [donde.despuesDe] tarea debajo de la cual ponerla
 * @param {string} texto texto de la tarea
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<string|null>} null si se añadió, o el motivo por el que no
 */
export async function anadirTarea({ruta, despuesDe = null}, texto, cancellable = null) {
    const limpio = (texto ?? '').replace(/[\r\n]+/g, ' ').trim();
    if (limpio === '')
        return 'una tarea sin texto no es una tarea';

    return reescribir(ruta, lineas => {
        let sangria = '';
        let indice;

        if (despuesDe) {
            const partes = partesDe(lineas, despuesDe);
            if (typeof partes === 'string')
                return partes;
            sangria = partes[1];
            indice = despuesDe.linea;          // justo debajo de ella
        } else {
            // Al final, pero antes de las líneas en blanco que cierran el
            // archivo: si no, la tarea nueva quedaría separada de la lista.
            indice = lineas.length;
            while (indice > 0 && lineas[indice - 1].trim() === '')
                indice--;
        }

        lineas.splice(indice, 0, `${sangria}- [ ] ${limpio}`);
        return lineas;
    }, cancellable);
}

/**
 * Crea el archivo con un ejemplo si todavía no existe.
 *
 * La escritura es síncrona a propósito: es un archivo de dos párrafos en local,
 * en respuesta a una pulsación, y así se puede abrir el editor justo después
 * sabiendo que ya está ahí.
 *
 * @param {string} rutaConfigurada ruta del archivo (admite '~')
 * @returns {boolean} true si lo ha creado ahora, false si ya existía
 */
export function crearArchivoSiFalta(rutaConfigurada) {
    const ruta = expandirRuta(rutaConfigurada);
    const file = Gio.File.new_for_path(ruta);

    if (file.query_exists(null))
        return false;

    const carpeta = file.get_parent();
    if (carpeta && !carpeta.query_exists(null))
        carpeta.make_directory_with_parents(null);

    file.replace_contents(
        new TextEncoder().encode(PLANTILLA), null, false, Gio.FileCreateFlags.NONE, null);

    return true;
}

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

// Lo que devuelven mover y sangrar cuando la tarea ya no puede ir más allá:
// es la primera de su grupo, la última, o está en el margen. No es un error
// —el archivo está bien y no se ha tocado—, así que quien llama no avisa de
// nada: llegar al final de una lista no es una avería.
export const SIN_SITIO = 'sin sitio';

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
            // La sangría tal cual está escrita, con sus tabuladores si los
            // tiene: es lo que se copia al añadir una tarea al lado.
            sangriaTexto: tarea[1],
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
 * La sangría de una línea, tal cual está escrita.
 *
 * @param {string} linea línea del archivo
 * @returns {string} los espacios o tabuladores de delante
 */
function sangriaDe(linea) {
    return linea.match(/^[ \t]*/)[0];
}

/**
 * Dónde acaba una tarea contando lo que cuelga de ella.
 *
 * Una tarea es su línea y todo lo que venga debajo más sangrado: sus subtareas
 * y las notas que le hayas puesto. Se trata como un bloque para que al moverla
 * o al sangrarla se lleve lo suyo consigo, que es lo que uno espera.
 *
 * @param {string[]} lineas líneas del archivo
 * @param {number} inicio índice de la línea de la tarea
 * @returns {number} índice de la primera línea que ya no es suya
 */
function finDelBloque(lineas, inicio) {
    const sangria = sangriaDe(lineas[inicio]).length;

    let fin = inicio + 1;
    while (fin < lineas.length) {
        const linea = lineas[fin];
        if (linea.trim() === '' || ENCABEZADO.test(linea))
            break;
        if (sangriaDe(linea).length <= sangria)
            break;
        fin++;
    }

    return fin;
}

/**
 * Busca la tarea de al lado a la misma altura, saltando lo que cuelgue de ella.
 *
 * Es lo que hace que subir una tarea la ponga encima de su hermana y no en
 * medio de las subtareas de su hermana. No se cruza ningún encabezado: mover
 * una tarea no la cambia de grupo.
 *
 * @param {string[]} lineas líneas del archivo
 * @param {number} inicio primera línea del bloque propio
 * @param {number} fin línea siguiente al bloque propio
 * @param {number} sangria sangría de la tarea, en caracteres
 * @param {number} delta -1 para la de encima, +1 para la de debajo
 * @returns {number} índice de la hermana, o -1 si no la hay
 */
function hermana(lineas, inicio, fin, sangria, delta) {
    if (delta > 0) {
        let p = fin;
        while (p < lineas.length && lineas[p].trim() === '')
            p++;
        if (p >= lineas.length || ENCABEZADO.test(lineas[p]))
            return -1;
        return sangriaDe(lineas[p]).length === sangria && TAREA.test(lineas[p]) ? p : -1;
    }

    let p = inicio - 1;
    while (p >= 0 && lineas[p].trim() === '')
        p--;
    if (p < 0 || ENCABEZADO.test(lineas[p]))
        return -1;

    // La línea de encima puede ser una subtarea de la hermana: se sigue
    // subiendo hasta dar con la altura propia.
    while (p >= 0) {
        const linea = lineas[p];
        if (linea.trim() === '' || ENCABEZADO.test(linea))
            return -1;
        const altura = sangriaDe(linea).length;
        if (altura < sangria)
            return -1;                      // es la de arriba, no una hermana
        if (altura === sangria)
            return TAREA.test(linea) ? p : -1;
        p--;
    }

    return -1;
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
 * Sube o baja una tarea dentro de su grupo.
 *
 * Se mueve el bloque entero —la tarea y lo que cuelgue de ella— y se
 * intercambia con la tarea hermana de al lado, la que está a su misma altura.
 * No se cruza ningún encabezado: subir la primera de un grupo no la pasa al
 * grupo de arriba, que sería mover una tarea a un sitio que no estás mirando.
 *
 * @param {object} tarea tarea tal como la leyó el escaneo
 * @param {number} delta -1 para subirla, +1 para bajarla
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<string|null>} null si se movió, o el motivo por el que no
 */
export async function moverTarea(tarea, delta, cancellable = null) {
    return reescribir(tarea.ruta, lineas => {
        const partes = partesDe(lineas, tarea);
        if (typeof partes === 'string')
            return partes;

        const inicio = tarea.linea - 1;
        const fin = finDelBloque(lineas, inicio);
        const propio = lineas.slice(inicio, fin);

        const vecina = hermana(lineas, inicio, fin, partes[1].length, delta);
        if (vecina < 0)
            return SIN_SITIO;

        const finVecina = finDelBloque(lineas, vecina);

        if (delta < 0) {
            // Las líneas en blanco que había entre las dos se quedan entre las
            // dos: se cambian de sitio los bloques, no el hueco.
            const bloque = lineas.slice(vecina, finVecina);
            const enmedio = lineas.slice(finVecina, inicio);
            lineas.splice(vecina, fin - vecina, ...propio, ...enmedio, ...bloque);
        } else {
            const bloque = lineas.slice(vecina, finVecina);
            const enmedio = lineas.slice(fin, vecina);
            lineas.splice(inicio, finVecina - inicio, ...bloque, ...enmedio, ...propio);
        }

        return lineas;
    }, cancellable);
}

/**
 * La sangría con la que se escriben las subtareas de un archivo.
 *
 * Se copia la que ya use: si sangras con tabuladores, la subtarea nueva lleva
 * un tabulador. Sin nada de lo que fiarse, dos espacios.
 *
 * @param {string[]} lineas líneas del archivo
 * @param {string} propia sangría de la tarea que se va a mover
 * @returns {string} un escalón de sangría
 */
function unidadSangria(lineas, propia) {
    if (propia.includes('\t'))
        return '\t';

    let minima = null;
    for (const linea of lineas) {
        const tarea = linea.match(TAREA);
        if (!tarea || tarea[1] === '')
            continue;
        if (minima === null || tarea[1].length < minima.length)
            minima = tarea[1];
    }

    if (minima === null)
        return '  ';
    return minima.includes('\t') ? '\t' : ' '.repeat(minima.length);
}

/**
 * Sangra o desangra una tarea, y con ella todo lo que cuelgue.
 *
 * Sangrar es lo que convierte una tarea en subtarea de la de encima, que es
 * para lo que había que abrir el editor.
 *
 * @param {object} tarea tarea tal como la leyó el escaneo
 * @param {number} delta +1 para sangrarla, -1 para sacarla
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<string|null>} null si se cambió, o el motivo por el que no
 */
export async function sangrarTarea(tarea, delta, cancellable = null) {
    return reescribir(tarea.ruta, lineas => {
        const partes = partesDe(lineas, tarea);
        if (typeof partes === 'string')
            return partes;

        const inicio = tarea.linea - 1;
        const fin = finDelBloque(lineas, inicio);
        const escalon = unidadSangria(lineas, partes[1]);

        if (delta > 0) {
            // Una subtarea lo es de algo: si no hay ninguna tarea encima a su
            // altura, sangrarla solo dejaría una lista torcida.
            if (hermana(lineas, inicio, fin, partes[1].length, -1) < 0)
                return SIN_SITIO;

            for (let i = inicio; i < fin; i++)
                lineas[i] = escalon + lineas[i];
        } else {
            if (partes[1] === '')
                return SIN_SITIO;

            for (let i = inicio; i < fin; i++) {
                const sangria = sangriaDe(lineas[i]);
                lineas[i] = lineas[i].slice(
                    lineas[i].startsWith(escalon)
                        ? escalon.length
                        : Math.min(escalon.length, sangria.length));
            }
        }

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
 * «sangria» manda sobre la que se heredaría: al añadir al final de un grupo la
 * tarea va al margen del grupo aunque la última de la lista sea una subtarea.
 *
 * @param {object} donde dónde va la tarea nueva
 * @param {string} donde.ruta archivo al que se añade
 * @param {object} [donde.despuesDe] tarea debajo de la cual ponerla
 * @param {string} [donde.sangria] sangría a usar, en vez de la heredada
 * @param {string} texto texto de la tarea
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<string|null>} null si se añadió, o el motivo por el que no
 */
export async function anadirTarea({ruta, despuesDe = null, sangria = null}, texto,
    cancellable = null) {
    const limpio = (texto ?? '').replace(/[\r\n]+/g, ' ').trim();
    if (limpio === '')
        return 'una tarea sin texto no es una tarea';

    return reescribir(ruta, lineas => {
        let margen = sangria ?? '';
        let indice;

        if (despuesDe) {
            const partes = partesDe(lineas, despuesDe);
            if (typeof partes === 'string')
                return partes;
            if (sangria === null)
                margen = partes[1];
            // Debajo de ella y de las suyas: una subtarea no se queda huérfana
            // por meter otra tarea en medio.
            indice = finDelBloque(lineas, despuesDe.linea - 1);
        } else {
            // Al final, pero antes de las líneas en blanco que cierran el
            // archivo: si no, la tarea nueva quedaría separada de la lista.
            indice = lineas.length;
            while (indice > 0 && lineas[indice - 1].trim() === '')
                indice--;
        }

        lineas.splice(indice, 0, `${margen}- [ ] ${limpio}`);
        return lineas;
    }, cancellable);
}

/**
 * Nivel de encabezado con el que se escriben los grupos de un archivo.
 *
 * Se copia el del último que haya: si tus grupos son «##», el nuevo también.
 * Un archivo con un solo encabezado es uno que solo tiene título, así que el
 * grupo cuelga de él.
 *
 * @param {string[]} lineas líneas del archivo
 * @returns {number} número de almohadillas, de 1 a 6
 */
function nivelDeGrupo(lineas) {
    let ultimo = 0;
    let cuantos = 0;
    let enCodigo = false;

    for (const linea of lineas) {
        if (CERCA.test(linea)) {
            enCodigo = !enCodigo;
            continue;
        }
        if (enCodigo)
            continue;

        const titulo = linea.match(ENCABEZADO);
        if (titulo) {
            ultimo = titulo[1].length;
            cuantos++;
        }
    }

    if (cuantos === 0)
        return 2;
    if (cuantos === 1)
        return Math.min(ultimo + 1, 6);
    return ultimo;
}

/**
 * Crea un grupo nuevo al final del archivo, con su primera tarea.
 *
 * Van juntos a propósito: un encabezado sin ninguna tarea debajo no sale en el
 * menú —los grupos se sacan de las tareas—, así que crearlo solo sería crear
 * algo que no se ve.
 *
 * @param {string} ruta archivo al que se añade
 * @param {string} titulo nombre del grupo, sin almohadillas
 * @param {string} texto primera tarea del grupo
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<string|null>} null si se creó, o el motivo por el que no
 */
export async function anadirGrupo(ruta, titulo, texto, cancellable = null) {
    const nombre = (titulo ?? '').replace(/[\r\n]+/g, ' ').replace(/^#+\s*/, '').trim();
    if (nombre === '')
        return 'un grupo sin nombre no se distingue de los demás';

    const limpio = (texto ?? '').replace(/[\r\n]+/g, ' ').trim();
    if (limpio === '')
        return 'un grupo sin ninguna tarea no saldría en el menú';

    return reescribir(ruta, lineas => {
        let indice = lineas.length;
        while (indice > 0 && lineas[indice - 1].trim() === '')
            indice--;

        const marca = '#'.repeat(nivelDeGrupo(lineas));
        const nuevas = [`${marca} ${nombre}`, '', `- [ ] ${limpio}`];

        // La línea en blanco de separación solo hace falta si hay algo encima.
        if (indice > 0)
            nuevas.unshift('');

        lineas.splice(indice, 0, ...nuevas);
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

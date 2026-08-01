/*
 * connections.js — Escaneo y parseo asíncrono de la carpeta de conexiones.
 *
 * Formato principal (RealVNC Viewer):
 *
 *     ConnMethod=tcp
 *     FriendlyName=OFICINA
 *     Host=servidor.ejemplo.net:5904
 *     UserName=
 *     Password=<cadena cifrada>          <- cifrada, NO se toca
 *     Labels=OFICINAS/OFICINAS (NORTE)
 *
 * Es texto plano «Clave=Valor», sin cabeceras de sección tipo INI.
 * También se soportan:
 *   - .vnc estilo TigerVNC/TightVNC (host= y port= en claves separadas)
 *   - .remmina (INI de verdad, con [remmina], server=, group=, protocol=)
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {queryInfo, enumerateChildren, nextFiles, closeEnumerator, loadContents} from './asyncgio.js';

// Extensiones que consideramos archivos de conexión.
const EXTENSIONES = ['.vnc', '.remmina', '.vncloc'];

// Profundidad máxima al recorrer subcarpetas (evita bucles y árboles enormes).
const PROFUNDIDAD_MAX = 4;

// Puerto VNC por omisión cuando el archivo no indica ninguno.
const PUERTO_VNC_POR_DEFECTO = 5900;

// Etiqueta usada cuando una conexión no pertenece a ningún grupo.
export const GRUPO_SIN_NOMBRE = 'Sin grupo';

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

    // Permite rutas relativas al home por comodidad (p. ej. "Documentos/VNC").
    if (!GLib.path_is_absolute(r))
        r = GLib.build_filenamev([GLib.get_home_dir(), r]);

    return r;
}

/**
 * Separa "host:puerto" respetando IPv6 entre corchetes ("[::1]:5901").
 *
 * @param {string} valor valor bruto de la clave Host/server
 * @returns {{host: string, port: number}} host y puerto normalizados
 */
function partirHostPuerto(valor) {
    let texto = (valor ?? '').trim();
    if (!texto)
        return {host: '', port: PUERTO_VNC_POR_DEFECTO};

    let host = texto;
    let puerto = null;

    if (texto.startsWith('[')) {
        // IPv6 literal: [dirección]:puerto
        const cierre = texto.indexOf(']');
        if (cierre > 0) {
            host = texto.slice(1, cierre);
            const resto = texto.slice(cierre + 1);
            if (resto.startsWith(':'))
                puerto = parseInt(resto.slice(1), 10);
        }
    } else {
        const dosPuntos = texto.lastIndexOf(':');
        // Si hay más de un ':' y no había corchetes, es una IPv6 sin puerto.
        const esIPv6Pelada = texto.indexOf(':') !== dosPuntos;
        if (dosPuntos > 0 && !esIPv6Pelada) {
            host = texto.slice(0, dosPuntos);
            puerto = parseInt(texto.slice(dosPuntos + 1), 10);
        }
    }

    if (!Number.isFinite(puerto) || puerto === null || puerto <= 0)
        puerto = PUERTO_VNC_POR_DEFECTO;
    else if (puerto < 100)
        // Convención VNC: un número pequeño es un «display», no un puerto real.
        puerto = 5900 + puerto;

    return {host: host.trim(), port: puerto};
}

/**
 * Parsea el contenido de un archivo de conexión a un diccionario de claves.
 * Las claves se pasan a minúsculas; las cabeceras [seccion] se ignoran
 * (los .remmina solo tienen una sección útil).
 *
 * @param {string} texto contenido del archivo
 * @returns {Map<string, string>} claves en minúsculas -> valor
 */
function parsearClaves(texto) {
    const claves = new Map();

    for (const lineaCruda of texto.split(/\r?\n/)) {
        const linea = lineaCruda.trim();
        if (!linea || linea.startsWith('#') || linea.startsWith(';') || linea.startsWith('['))
            continue;

        const igual = linea.indexOf('=');
        if (igual <= 0)
            continue;

        const clave = linea.slice(0, igual).trim().toLowerCase();
        let valor = linea.slice(igual + 1).trim();

        // RealVNC entrecomilla algunos valores (Sequence="1174").
        if (valor.length >= 2 && valor.startsWith('"') && valor.endsWith('"'))
            valor = valor.slice(1, -1);

        // Las claves de credenciales vienen cifradas: se descartan sin leerlas.
        if (clave === 'password' || clave === 'identity' || clave === 'authcertificate')
            continue;

        claves.set(clave, valor);
    }

    return claves;
}

/**
 * Construye el objeto de conexión a partir de las claves de un archivo.
 *
 * @param {string} ruta ruta absoluta del archivo
 * @param {string} nombreArchivo nombre del archivo con extensión
 * @param {string} subcarpeta ruta relativa de la subcarpeta ('' si está en la raíz)
 * @param {string} texto contenido del archivo
 * @returns {object|null} conexión, o null si no se pudo determinar el host
 */
function construirConexion(ruta, nombreArchivo, subcarpeta, texto) {
    const claves = parsearClaves(texto);
    const punto = nombreArchivo.lastIndexOf('.');
    const extension = punto > 0 ? nombreArchivo.slice(punto).toLowerCase() : '';
    // Requisito: el nombre visible es el del archivo sin extensión.
    const nombre = punto > 0 ? nombreArchivo.slice(0, punto) : nombreArchivo;

    // Host: RealVNC usa Host=, Remmina usa server=, TigerVNC usa host= (+ port=).
    const valorHost = claves.get('host') ?? claves.get('server') ?? claves.get('hostname') ?? '';
    let {host, port} = partirHostPuerto(valorHost);

    // TigerVNC/TightVNC guardan el puerto en una clave aparte.
    const puertoSuelto = parseInt(claves.get('port') ?? '', 10);
    if (Number.isFinite(puertoSuelto) && puertoSuelto > 0 && !valorHost.includes(':'))
        port = puertoSuelto < 100 ? 5900 + puertoSuelto : puertoSuelto;

    if (!host)
        return null;

    // Grupos candidatos: en RealVNC vienen en Labels= (separadas por comas y
    // jerarquizadas con '/'); en Remmina, en group=.
    const etiquetas = [];
    const crudas = claves.get('labels') ?? claves.get('group') ?? '';
    for (const etiqueta of crudas.split(',')) {
        const limpia = etiqueta.trim();
        if (limpia)
            etiquetas.push(limpia);
    }

    return {
        // Identificador estable para asociar el estado con el elemento de menú.
        id: ruta,
        ruta,
        nombre,
        extension,
        host,
        port,
        usuario: claves.get('username') ?? claves.get('user') ?? '',
        subcarpeta,
        etiquetas,
        // Se rellena en asignarGrupos().
        grupo: subcarpeta || GRUPO_SIN_NOMBRE,
    };
}

/**
 * Decide el grupo definitivo de cada conexión.
 *
 * - Si el archivo está en una subcarpeta, esa subcarpeta manda.
 * - Si no, se usa la etiqueta compartida por MÁS conexiones (así, con los
 *   archivos reales, "SUCURSALES/SUCURSALES (FACTURACION)" gana sobre las
 *   etiquetas sueltas de una sola conexión como "MAPELO").
 * - Del nombre jerárquico solo se muestra el último tramo tras '/'.
 *
 * @param {object[]} conexiones lista de conexiones ya parseadas (se modifica)
 */
function asignarGrupos(conexiones) {
    const frecuencia = new Map();
    for (const c of conexiones) {
        for (const etiqueta of c.etiquetas)
            frecuencia.set(etiqueta, (frecuencia.get(etiqueta) ?? 0) + 1);
    }

    for (const c of conexiones) {
        if (c.subcarpeta) {
            c.grupo = c.subcarpeta;
            continue;
        }

        let mejor = null;
        let mejorPeso = -1;
        for (const etiqueta of c.etiquetas) {
            const peso = frecuencia.get(etiqueta) ?? 0;
            // A igualdad de frecuencia gana la etiqueta más jerárquica.
            const profundidad = etiqueta.split('/').length;
            if (peso > mejorPeso || (peso === mejorPeso && profundidad > mejor.split('/').length)) {
                mejor = etiqueta;
                mejorPeso = peso;
            }
        }

        if (mejor) {
            const tramos = mejor.split('/');
            c.grupo = tramos[tramos.length - 1].trim() || mejor;
        } else {
            c.grupo = GRUPO_SIN_NOMBRE;
        }
    }
}

/**
 * Enumera de forma asíncrona los archivos de un directorio (y subdirectorios).
 *
 * @param {Gio.File} dir directorio a recorrer
 * @param {string} relativo ruta relativa acumulada (para los grupos)
 * @param {number} profundidad nivel actual de anidamiento
 * @param {Gio.Cancellable} cancellable cancelable compartido
 * @param {object[]} salida array donde se acumulan los archivos encontrados
 * @returns {Promise<void>} promesa que se resuelve al terminar la rama
 */
async function recorrerDirectorio(dir, relativo, profundidad, cancellable, salida) {
    if (profundidad > PROFUNDIDAD_MAX)
        return;

    let enumerador;
    try {
        enumerador = await enumerateChildren(
            dir,
            'standard::name,standard::type,standard::is-hidden',
            Gio.FileQueryInfoFlags.NONE,
            cancellable);
    } catch (e) {
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            console.warn(`[vnc-menu] No se pudo leer ${dir.get_path()}: ${e.message}`);
        return;
    }

    for (;;) {
        let lote;
        try {
            lote = await nextFiles(enumerador, 50, cancellable);
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`[vnc-menu] Error enumerando: ${e.message}`);
            break;
        }

        if (!lote || lote.length === 0)
            break;

        for (const info of lote) {
            if (info.get_is_hidden())
                continue;

            const nombre = info.get_name();
            const hijo = dir.get_child(nombre);

            if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                const sub = relativo ? `${relativo}/${nombre}` : nombre;
                await recorrerDirectorio(hijo, sub, profundidad + 1, cancellable, salida);
                continue;
            }

            const minusculas = nombre.toLowerCase();
            if (EXTENSIONES.some(ext => minusculas.endsWith(ext)))
                salida.push({file: hijo, nombre, subcarpeta: relativo});
        }
    }

    try {
        await closeEnumerator(enumerador);
    } catch {
        // Cerrar el enumerador es best-effort; un fallo aquí no importa.
    }
}

/**
 * Escanea la carpeta de conexiones sin bloquear el hilo principal.
 *
 * @param {string} rutaCarpeta carpeta raíz (ya expandida)
 * @param {Gio.Cancellable} cancellable cancelable para abortar en disable()
 * @returns {Promise<{ok: boolean, motivo: string, conexiones: object[]}>} resultado del escaneo
 */
export async function escanearConexiones(rutaCarpeta, cancellable) {
    const dir = Gio.File.new_for_path(rutaCarpeta);

    // Comprobación asíncrona de que la carpeta existe y es un directorio.
    try {
        const info = await queryInfo(
            dir,
            'standard::type',
            Gio.FileQueryInfoFlags.NONE,
            cancellable);
        if (info.get_file_type() !== Gio.FileType.DIRECTORY)
            return {ok: false, motivo: 'inexistente', conexiones: []};
    } catch (e) {
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            return {ok: false, motivo: 'cancelado', conexiones: []};
        return {ok: false, motivo: 'inexistente', conexiones: []};
    }

    const archivos = [];
    await recorrerDirectorio(dir, '', 0, cancellable, archivos);

    if (cancellable?.is_cancelled())
        return {ok: false, motivo: 'cancelado', conexiones: []};

    // Se leen todos los archivos en paralelo: son pequeños y la E/S es async.
    const lecturas = archivos.map(async ({file, nombre, subcarpeta}) => {
        try {
            const bytes = await loadContents(file, cancellable);
            const texto = new TextDecoder('utf-8', {fatal: false}).decode(bytes);
            return construirConexion(file.get_path(), nombre, subcarpeta, texto);
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`[vnc-menu] No se pudo leer ${nombre}: ${e.message}`);
            return null;
        }
    });

    const conexiones = (await Promise.all(lecturas)).filter(c => c !== null);

    if (cancellable?.is_cancelled())
        return {ok: false, motivo: 'cancelado', conexiones: []};

    asignarGrupos(conexiones);

    // Orden alfabético por grupo y, dentro del grupo, por nombre.
    const comparar = (a, b) => a.localeCompare(b, undefined, {sensitivity: 'base', numeric: true});
    conexiones.sort((a, b) => comparar(a.grupo, b.grupo) || comparar(a.nombre, b.nombre));

    return {
        ok: true,
        motivo: conexiones.length === 0 ? 'vacia' : 'ok',
        conexiones,
    };
}

/**
 * Agrupa una lista de conexiones en un array de grupos ordenados.
 *
 * @param {object[]} conexiones conexiones ya ordenadas
 * @returns {{nombre: string, conexiones: object[]}[]} grupos listos para pintar
 */
export function agruparConexiones(conexiones) {
    const grupos = new Map();
    for (const c of conexiones) {
        if (!grupos.has(c.grupo))
            grupos.set(c.grupo, []);
        grupos.get(c.grupo).push(c);
    }
    return [...grupos.entries()].map(([nombre, lista]) => ({nombre, conexiones: lista}));
}

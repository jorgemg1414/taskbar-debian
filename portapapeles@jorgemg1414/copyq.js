/*
 * copyq.js — Hablar con CopyQ desde la extensión.
 *
 * La extensión no guarda nada: el historial es el de CopyQ, el mismo que abre
 * Super+V. Aquí solo están las llamadas que hacen falta para leerlo y tocarlo,
 * cada una lanzando el programa «copyq» y esperando su salida sin bloquear el
 * hilo del shell.
 *
 * Todo va por «copyq eval», y no por los comandos sueltos de la línea de
 * órdenes, por una razón: «eval» devuelve lo que le pidas en el formato que le
 * pidas. Leer el historial con «read» obligaría a separar los elementos por un
 * carácter que ninguno de ellos contuviera, y eso no existe cuando lo que
 * guardas es texto arbitrario. Con JSON no hay que inventarse un separador.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {comunicar} from './asyncgio.js';

const PROGRAMA = 'copyq';

/** En qué situación está CopyQ cuando se le pregunta. */
export const ESTADO = {
    LISTO: 'listo',                 // contesta y ha devuelto el historial
    SIN_PROGRAMA: 'sin-programa',   // no está instalado
    PARADO: 'parado',               // instalado, pero su servidor no responde
    ERROR: 'error',                 // contesta, pero no se entiende lo que dice
};

/**
 * Si el programa está instalado.
 *
 * @returns {boolean} si «copyq» está en el PATH
 */
export function estaInstalado() {
    return GLib.find_program_in_path(PROGRAMA) !== null;
}

/**
 * Lanza copyq con unos argumentos y recoge lo que escriba.
 *
 * @param {string[]} argv orden completa, empezando por «copyq»
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<{salida: string, error: string, codigo: number}>} resultado
 */
async function lanzar(argv, cancellable) {
    // Gio.Subprocess.new lanza una excepción si el programa no está, en vez de
    // devolver un código de salida; de ahí que la comprobación vaya antes.
    const proceso = Gio.Subprocess.new(
        argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    return comunicar(proceso, cancellable);
}

/**
 * Ejecuta un trozo de guion dentro de CopyQ.
 *
 * El guion va como un argumento más, no por un intérprete de órdenes, así que
 * no hay nada que escapar: las comillas que lleve dentro son suyas.
 *
 * @param {string} guion código para el motor de CopyQ
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<{salida: string, error: string, codigo: number}>} resultado
 */
function evaluar(guion, cancellable) {
    return lanzar([PROGRAMA, 'eval', '--', guion], cancellable);
}

/**
 * Lee los primeros elementos del historial.
 *
 * Solo se pide el texto. Un elemento que no lo tenga —una imagen pegada, por
 * ejemplo— llega como cadena vacía y se marca aparte: la extensión enseña un
 * hueco con su nombre, pero no intenta pintarlo.
 *
 * @param {object} opciones opciones de lectura
 * @param {number} opciones.maximo cuántos elementos pedir como mucho
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<{estado: string, total: number, elementos: object[]}>} el historial
 */
export async function leerHistorial({maximo}, cancellable) {
    if (!estaInstalado())
        return {estado: ESTADO.SIN_PROGRAMA, total: 0, elementos: []};

    const guion = `
        var maximo = ${Math.max(1, maximo)};
        var total = size();
        var n = Math.min(total, maximo);
        var textos = [];
        for (var i = 0; i < n; ++i)
            textos.push(str(read('text/plain', i)));
        print(JSON.stringify({total: total, textos: textos}));
    `;

    let resultado;
    try {
        resultado = await evaluar(guion, cancellable);
    } catch {
        return {estado: ESTADO.PARADO, total: 0, elementos: []};
    }

    // Sin servidor detrás, copyq sale con error y lo explica por stderr. No se
    // distingue de otros fallos, y tampoco hace falta: en los dos casos lo
    // único que puede hacer el usuario es arrancarlo.
    if (resultado.codigo !== 0)
        return {estado: ESTADO.PARADO, total: 0, elementos: []};

    try {
        const datos = JSON.parse(resultado.salida);
        const elementos = datos.textos.map((texto, fila) => ({
            fila,
            texto,
            vacio: texto.length === 0,
        }));
        return {estado: ESTADO.LISTO, total: datos.total, elementos};
    } catch {
        return {estado: ESTADO.ERROR, total: 0, elementos: []};
    }
}

/**
 * Pone un elemento del historial en el portapapeles.
 *
 * «select» es lo que hace CopyQ al pulsar en su propia ventana: copia el
 * elemento entero, con todos sus formatos, y lo sube al principio de la lista.
 * Si esta versión no lo tuviera, queda el texto, que es lo que se ve en el
 * menú y lo que el usuario espera.
 *
 * @param {number} fila posición en el historial, empezando por 0
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<boolean>} si se pudo
 */
export async function elegir(fila, cancellable) {
    const guion = `
        try {
            select(${fila});
        } catch (e) {
            copy(str(read('text/plain', ${fila})));
        }
    `;
    const {codigo} = await evaluar(guion, cancellable);
    return codigo === 0;
}

/**
 * Pega el portapapeles en la ventana que tenga el foco.
 *
 * Es un Ctrl+V simulado, así que depende de que el foco haya vuelto ya a donde
 * estaba antes de abrirse el menú. Por eso quien lo llama espera un momento.
 *
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<boolean>} si se pudo
 */
export async function pegar(cancellable) {
    const {codigo} = await evaluar('paste();', cancellable);
    return codigo === 0;
}

/**
 * Borra un elemento del historial.
 *
 * @param {number} fila posición en el historial
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<boolean>} si se pudo
 */
export async function quitar(fila, cancellable) {
    const {codigo} = await evaluar(`remove(${fila});`, cancellable);
    return codigo === 0;
}

/**
 * Vacía el historial entero.
 *
 * Se borra de atrás hacia delante y de uno en uno: quitar una fila recoloca
 * las de abajo, así que empezando por el final los índices que quedan por
 * borrar no se mueven.
 *
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<boolean>} si se pudo
 */
export async function vaciar(cancellable) {
    const {codigo} = await evaluar(
        'for (var i = size() - 1; i >= 0; --i) remove(i);', cancellable);
    return codigo === 0;
}

/**
 * Abre —o cierra— la ventana de CopyQ.
 *
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<boolean>} si se pudo
 */
export async function abrirVentana(cancellable) {
    const {codigo} = await lanzar([PROGRAMA, 'toggle'], cancellable);
    return codigo === 0;
}

/**
 * Arranca el servidor de CopyQ.
 *
 * No se espera a que termine: «--start-server» se queda corriendo, que es
 * justo lo que se le pide. Basta con soltarlo y volver a preguntar luego.
 *
 * @returns {boolean} si se pudo lanzar
 */
export function arrancarServidor() {
    try {
        Gio.Subprocess.new([PROGRAMA, '--start-server'], Gio.SubprocessFlags.NONE);
        return true;
    } catch {
        return false;
    }
}

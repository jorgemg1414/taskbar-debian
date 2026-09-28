/*
 * marco.js — Lo justo para escribir pruebas y ejecutarlas con gjs.
 *
 * Sin dependencias: gjs viene con GNOME y es el mismo motor que ejecuta las
 * extensiones, así que lo que pasa aquí es lo que pasa en la barra. Cada
 * archivo de pruebas declara las suyas con prueba() y termina con ejecutar().
 *
 * No se lanza a mano: lo hace ejecutar.sh, que monta los módulos como los deja
 * el instalador y le da a cada archivo una carpeta personal de usar y tirar.
 */

import GLib from 'gi://GLib';
import System from 'system';

const pruebas = [];

/**
 * Declara una prueba.
 *
 * @param {string} nombre lo que se comprueba, como se leerá en la salida
 * @param {Function} fn cuerpo de la prueba; puede ser async
 */
export function prueba(nombre, fn) {
    pruebas.push({nombre, fn});
}

/**
 * Falla si dos valores no son iguales. Se comparan por su JSON, así que vale
 * para listas y objetos, y el orden de las claves cuenta.
 *
 * @param {*} real lo que salió
 * @param {*} esperado lo que tenía que salir
 * @param {string} [que] qué se estaba mirando, para el mensaje
 */
export function igual(real, esperado, que = '') {
    const a = JSON.stringify(real);
    const b = JSON.stringify(esperado);
    if (a !== b)
        throw new Error(`${que ? `${que}: ` : ''}\n      esperado: ${b}\n      real:     ${a}`);
}

/**
 * Falla si la condición no se cumple.
 *
 * @param {boolean} condicion lo que tiene que ser verdad
 * @param {string} que qué se estaba mirando
 */
export function cierto(condicion, que) {
    if (!condicion)
        throw new Error(que);
}

/**
 * Carpeta nueva y vacía dentro de la carpeta personal de pruebas.
 *
 * @returns {string} ruta absoluta
 */
export function carpetaTemporal() {
    return GLib.dir_make_tmp('prueba-XXXXXX');
}

/**
 * Escribe un archivo de texto, creando las carpetas que falten.
 *
 * @param {string} ruta ruta absoluta
 * @param {string} texto contenido
 */
export function escribir(ruta, texto) {
    GLib.mkdir_with_parents(GLib.path_get_dirname(ruta), 0o700);
    GLib.file_set_contents(ruta, texto);
}

/**
 * Lee un archivo de texto entero.
 *
 * @param {string} ruta ruta absoluta
 * @returns {string} contenido
 */
export function leer(ruta) {
    const [, bytes] = GLib.file_get_contents(ruta);
    return new TextDecoder().decode(bytes);
}

/**
 * Ejecuta las pruebas declaradas, una detrás de otra, y sale con 1 si alguna
 * falla. Va dentro de un bucle de GLib porque las funciones asíncronas de Gio
 * solo avanzan si alguien lo hace girar.
 */
export function ejecutar() {
    const bucle = new GLib.MainLoop(null, false);
    let fallos = 0;

    (async () => {
        for (const {nombre, fn} of pruebas) {
            try {
                await fn();
                print(`  \x1b[32m✓\x1b[0m ${nombre}`);
            } catch (e) {
                fallos++;
                print(`  \x1b[31m✗ ${nombre}\x1b[0m ${e.message}`);
            }
        }
    })().finally(() => bucle.quit());

    bucle.run();
    System.exit(fallos === 0 ? 0 : 1);
}

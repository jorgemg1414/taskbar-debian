/*
 * lanzar.js — Abrir programas a partir de una orden escrita en los ajustes.
 *
 * Las extensiones dejan elegir con qué se abre cada cosa —la terminal, el
 * cliente VNC, el editor— con una plantilla como «tilix -e "ssh %n"». Aquí se
 * convierte esa plantilla en una orden y se lanza, probando alternativas si el
 * programa elegido no está instalado.
 *
 * Lo importante es el orden: primero se trocea la plantilla y DESPUÉS se
 * sustituyen los marcadores. Así un valor con espacios, comillas o punto y coma
 * —un alias, una ruta, un nombre de archivo— queda dentro de su argumento y no
 * puede convertirse en argumentos de más ni en otra orden. Nada pasa por un
 * intérprete de órdenes.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Editores con los que abrir un archivo de texto, en orden, por si el
// configurado no está instalado. xdg-open va el último: abre lo que el
// sistema tenga asociado, que puede no ser un editor.
export const ALTERNATIVAS_EDITOR = [
    'gnome-text-editor %f',
    'gedit %f',
    'kate %f',
    'xdg-open %f',
];

/**
 * Convierte una plantilla en la lista de argumentos que se lanza.
 *
 * Un marcador es «%» y una letra. Los que no estén en «valores» se dejan tal
 * cual, que es lo que cabe esperar de un «%» que no era un marcador.
 *
 * @param {string} plantilla orden con marcadores, p. ej. «remmina -c vnc://%h:%p»
 * @param {object} valores marcador -> valor, p. ej. {'%h': '10.0.0.1'}
 * @param {string} [etiqueta] nombre para los avisos del registro
 * @returns {string[]|null} argv listo para Gio.Subprocess, o null si no se entiende
 */
export function construirArgv(plantilla, valores, etiqueta = 'taskbar') {
    if (!plantilla || plantilla.trim() === '')
        return null;

    let troceado;
    try {
        const [ok, argv] = GLib.shell_parse_argv(plantilla);
        if (!ok || argv.length === 0)
            return null;
        troceado = argv;
    } catch (e) {
        console.warn(`[${etiqueta}] Orden mal escrita «${plantilla}»: ${e.message}`);
        return null;
    }

    // Una sola pasada por argumento: un valor que contenga «%h» no se vuelve
    // a sustituir.
    return troceado.map(arg =>
        arg.replace(/%[a-zA-Z]/g, marca => valores[marca] ?? marca));
}

/**
 * Lanza la primera plantilla cuyo programa esté instalado.
 *
 * Las vacías o mal escritas se saltan, igual que las de un programa que no
 * está: así la configurada puede ir la primera de la lista y, si falla, se
 * pasa a las alternativas sin más.
 *
 * @param {string[]} plantillas órdenes candidatas, en orden de preferencia
 * @param {object} valores marcador -> valor
 * @param {string} [etiqueta] nombre para los avisos del registro
 * @returns {boolean} si se pudo lanzar alguna
 */
export function lanzarPrimera(plantillas, valores, etiqueta = 'taskbar') {
    for (const plantilla of plantillas) {
        const argv = construirArgv(plantilla, valores, etiqueta);
        if (!argv)
            continue;

        if (!GLib.find_program_in_path(argv[0]))
            continue;

        try {
            // Sin esperar ni recoger nada: el programa sigue su vida aparte.
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
            return true;
        } catch (e) {
            console.warn(`[${etiqueta}] Falló «${argv.join(' ')}»: ${e.message}`);
        }
    }

    return false;
}

/*
 * rutas.js — Rutas tal como se escriben en los ajustes, pasadas a absolutas.
 *
 * Las extensiones guardan rutas escritas a mano en las preferencias: «~/.ssh/config»,
 * «Documentos/VNC», «/srv/notas». Aquí se convierten en rutas absolutas de una
 * sola forma, la misma para todas.
 */

import GLib from 'gi://GLib';

/**
 * Expande '~' al directorio personal y normaliza la ruta.
 *
 * Una ruta relativa se toma relativa a la carpeta personal, por comodidad: en
 * las preferencias se escribe «Documentos/VNC» y se entiende.
 *
 * @param {string} ruta ruta tal cual viene de GSettings
 * @returns {string} ruta absoluta, o cadena vacía si no había ruta
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

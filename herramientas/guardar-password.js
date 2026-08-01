#!/usr/bin/gjs -m
/*
 * guardar-password.js — Guarda una contraseña en el llavero de GNOME con el
 * esquema que usa Remmina, para los perfiles .remmina indicados.
 *
 * La contraseña se lee por la entrada estándar, nunca por argumentos: así no
 * queda visible en `ps` ni en el historial del intérprete de órdenes.
 *
 * Uso (normalmente a través de guardar-password.sh):
 *
 *     printf '%s' 'la-contraseña' | gjs -m guardar-password.js perfil1.remmina perfil2.remmina
 *
 * Remmina busca la contraseña en el llavero con el esquema
 * «org.remmina.Password» y los atributos:
 *     filename = ruta absoluta del perfil
 *     key      = "password"
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import Secret from 'gi://Secret';

// Esquema exactamente igual al que declara remmina-plugin-secret.
const ESQUEMA = new Secret.Schema(
    'org.remmina.Password',
    Secret.SchemaFlags.NONE,
    {
        'filename': Secret.SchemaAttributeType.STRING,
        'key': Secret.SchemaAttributeType.STRING,
    });

/**
 * Lee toda la entrada estándar sin mostrarla.
 *
 * @returns {string} contenido leído, sin el salto de línea final
 */
function leerEntradaEstandar() {
    const entrada = new Gio.DataInputStream({
        base_stream: new GioUnix.InputStream({fd: 0, close_fd: false}),
    });

    let texto = '';
    for (;;) {
        const [linea] = entrada.read_line_utf8(null);
        if (linea === null)
            break;
        texto += linea;
    }
    return texto;
}

const perfiles = ARGV.filter(a => a.trim() !== '');
if (perfiles.length === 0) {
    printerr('Uso: gjs -m guardar-password.js <perfil.remmina> [...]');
    imports.system.exit(2);
}

const clave = leerEntradaEstandar();
if (clave === '') {
    printerr('No se recibió ninguna contraseña por la entrada estándar.');
    imports.system.exit(2);
}

let guardados = 0;
for (const perfil of perfiles) {
    // Remmina identifica el secreto por la ruta absoluta del perfil.
    const ruta = GLib.canonicalize_filename(perfil, null);
    const nombre = GLib.path_get_basename(ruta).replace(/\.remmina$/, '');

    try {
        Secret.password_store_sync(
            ESQUEMA,
            {'filename': ruta, 'key': 'password'},
            Secret.COLLECTION_DEFAULT,
            `Remmina: ${nombre} - password`,
            clave,
            null);
        guardados++;
    } catch (e) {
        printerr(`No se pudo guardar «${nombre}»: ${e.message}`);
    }
}

print(`Contraseñas guardadas en el llavero: ${guardados} de ${perfiles.length}`);

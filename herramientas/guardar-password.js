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
 *
 * Pero solo la busca si el perfil lleva «password=.»: ese punto es la marca
 * de «está en el llavero». Con el campo vacío, Remmina no pregunta al llavero
 * y pide la contraseña al conectar. Por eso, tras guardar cada una, se pone la
 * marca en su perfil.
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
 * Pone la marca «password=.» en un perfil, para que Remmina vaya al llavero.
 *
 * Se toca solo esa línea; si el perfil no la tiene, se añade detrás de la
 * cabecera [remmina]. El resto del archivo se queda como estaba.
 *
 * @param {string} ruta ruta absoluta del perfil
 */
function marcarEnLlavero(ruta) {
    const file = Gio.File.new_for_path(ruta);
    const [, contenido] = file.load_contents(null);
    const texto = new TextDecoder().decode(contenido);

    let nuevo;
    if (/^password=[^\r\n]*/m.test(texto))
        nuevo = texto.replace(/^password=[^\r\n]*/m, 'password=.');
    else if (/^\[remmina\][ \t]*$/m.test(texto))
        nuevo = texto.replace(/^\[remmina\][ \t]*$/m, '[remmina]\npassword=.');
    else
        throw new Error('no tiene la sección [remmina]');

    if (nuevo !== texto) {
        // PRIVATE: el perfil se queda con permisos 600, como lo deja Remmina.
        file.replace_contents(new TextEncoder().encode(nuevo), null, false,
            Gio.FileCreateFlags.PRIVATE, null);
    }
}

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
        marcarEnLlavero(ruta);
        guardados++;
    } catch (e) {
        printerr(`No se pudo guardar «${nombre}»: ${e.message}`);
    }
}

print(`Contraseñas guardadas en el llavero: ${guardados} de ${perfiles.length}`);

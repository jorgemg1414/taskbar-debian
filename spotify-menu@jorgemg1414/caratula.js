/*
 * caratula.js — La portada del disco: descarga y caché en disco.
 *
 * MPRIS no manda la imagen, manda su dirección (mpris:artUrl). La de Spotify
 * apunta a su CDN, así que hay que bajarla; la de un reproductor local suele
 * ser un «file://» que ya está en disco y se usa tal cual.
 *
 * Lo que se baja se guarda en ~/.cache, con el nombre sacado del hash de la
 * dirección, y de ahí en adelante se lee de disco: cambiar de canción y volver
 * no vuelve a salir a la red. La caché se poda sola.
 *
 * Es la única parte de la extensión que toca la red, y solo con las direcciones
 * que publica el propio reproductor.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {queryInfo, enumerateChildren, nextFiles, closeEnumerator} from './asyncgio.js';

// Carpeta dentro de ~/.cache. Se puede borrar entera sin perder nada.
const CARPETA = 'spotify-menu';

// Una portada es una imagen de unos cientos de kilobytes. Lo que pase de aquí
// no es una portada, y no se guarda.
const MAX_BYTES = 4 * 1024 * 1024;

// Portadas que se guardan antes de empezar a tirar las más viejas.
const MAX_ARCHIVOS = 60;

// Segundos que se espera a la descarga.
const TIEMPO_LIMITE_S = 15;

/**
 * Guarda unos bytes en un archivo.
 *
 * @param {Gio.File} archivo destino
 * @param {GLib.Bytes} bytes contenido
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<void>} promesa resuelta al terminar de escribir
 */
function guardar(archivo, bytes, cancellable) {
    return new Promise((resolve, reject) => {
        archivo.replace_contents_bytes_async(
            bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, cancellable,
            (objeto, res) => {
                try {
                    objeto.replace_contents_finish(res);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
    });
}

/**
 * Borra un archivo sin esperar el resultado.
 *
 * @param {Gio.File} archivo archivo a borrar
 */
function borrar(archivo) {
    archivo.delete_async(GLib.PRIORITY_LOW, null, (objeto, res) => {
        try {
            objeto.delete_finish(res);
        } catch {
            // Podar la caché es mantenimiento: si un archivo se resiste, se
            // queda ahí y no pasa nada.
        }
    });
}

/**
 * Portadas ya descargadas, listas para pintar.
 */
export class CacheCaratulas {
    constructor() {
        this._sesion = null;
        this._cancellable = new Gio.Cancellable();
        this._enDisco = new Map();  // dirección -> ruta local
        this._enCurso = new Map();  // dirección -> descarga en marcha
        this._carpeta = GLib.build_filenamev([GLib.get_user_cache_dir(), CARPETA]);
    }

    /**
     * Ruta local de una portada, bajándola si hace falta.
     *
     * @param {string} url dirección que publica el reproductor
     * @returns {Promise<string|null>} ruta en disco, o null si no se pudo tener
     */
    async rutaDe(url) {
        if (!url)
            return null;

        // Un reproductor local apunta a un archivo que ya está aquí.
        if (url.startsWith('file://'))
            return Gio.File.new_for_uri(url).get_path();

        // Cualquier otro esquema (data:, un http raro de un reproductor
        // cualquiera) no se toca.
        if (!url.startsWith('https://') && !url.startsWith('http://'))
            return null;

        const conocida = this._enDisco.get(url);
        if (conocida !== undefined)
            return conocida;

        // Al abrir y cerrar el menú se pide la misma portada varias veces: se
        // comparte la descarga que ya está en marcha en vez de repetirla.
        let descarga = this._enCurso.get(url);
        if (descarga === undefined) {
            descarga = this._traer(url).finally(() => this._enCurso.delete(url));
            this._enCurso.set(url, descarga);
        }
        return descarga;
    }

    /**
     * Busca la portada en la caché y, si no está, la baja.
     *
     * @param {string} url dirección de la imagen
     * @returns {Promise<string|null>} ruta en disco, o null
     */
    async _traer(url) {
        const ruta = this._rutaEnCache(url);
        const archivo = Gio.File.new_for_path(ruta);

        // La caché sobrevive a cerrar sesión: lo más probable es que ya esté.
        try {
            await queryInfo(archivo, 'standard::type', Gio.FileQueryInfoFlags.NONE,
                this._cancellable);
            this._enDisco.set(url, ruta);
            return ruta;
        } catch {
            // No está: hay que bajarla.
        }

        const bytes = await this._pedir(url);
        if (bytes === null)
            return null;

        try {
            this._asegurarCarpeta();
            await guardar(archivo, bytes, this._cancellable);
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.error(`[spotify-menu] No se pudo guardar la portada: ${e.message}`);
            return null;
        }

        this._enDisco.set(url, ruta);
        this._podar();
        return ruta;
    }

    /**
     * Baja la imagen.
     *
     * @param {string} url dirección de la imagen
     * @returns {Promise<GLib.Bytes|null>} contenido, o null si no se pudo bajar
     */
    _pedir(url) {
        this._sesion ??= new Soup.Session({
            timeout: TIEMPO_LIMITE_S,
            user_agent: 'spotify-menu (GNOME Shell)',
        });

        const mensaje = Soup.Message.new('GET', url);
        if (mensaje === null)
            return Promise.resolve(null);

        // Cada descarga tiene su propio cancelable, colgado del general, para
        // poder cortar solo esta si el servidor anuncia algo desmedido.
        const cancelable = new Gio.Cancellable();
        const idCancelar = this._cancellable.connect(() => cancelable.cancel());

        // El tamaño se mira en las cabeceras, antes de que el cuerpo entero
        // acabe en la memoria del shell.
        const idCabeceras = mensaje.connect('got-headers', () => {
            const largo = mensaje.get_response_headers().get_content_length();
            if (largo > MAX_BYTES)
                cancelable.cancel();
        });

        return new Promise(resolve => {
            this._sesion.send_and_read_async(
                mensaje, GLib.PRIORITY_DEFAULT, cancelable,
                (sesion, res) => {
                    mensaje.disconnect(idCabeceras);
                    this._cancellable.disconnect(idCancelar);

                    let bytes;
                    try {
                        bytes = sesion.send_and_read_finish(res);
                    } catch (e) {
                        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                            console.error(`[spotify-menu] No se pudo bajar la portada: ${e.message}`);
                        resolve(null);
                        return;
                    }

                    if (mensaje.get_status() !== Soup.Status.OK) {
                        resolve(null);
                        return;
                    }

                    const tamano = bytes.get_size();
                    resolve(tamano > 0 && tamano <= MAX_BYTES ? bytes : null);
                });
        });
    }

    /**
     * Dónde va a parar una portada dentro de la caché.
     *
     * @param {string} url dirección de la imagen
     * @returns {string} ruta local
     */
    _rutaEnCache(url) {
        // El nombre sale del hash de la dirección: así no depende de lo que
        // venga en ella, que es texto de fuera.
        const huella = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1);
        return GLib.build_filenamev([this._carpeta, `${huella}.img`]);
    }

    /**
     * Crea la carpeta de la caché si todavía no existe.
     */
    _asegurarCarpeta() {
        try {
            Gio.File.new_for_path(this._carpeta).make_directory_with_parents(null);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                throw e;
        }
    }

    /**
     * Deja en la caché solo las portadas más recientes.
     */
    _podar() {
        this._podarAsync().catch(e => {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.error(`[spotify-menu] No se pudo podar la caché: ${e.message}`);
        });
    }

    /**
     * Recorre la caché y borra las portadas más viejas que sobren.
     *
     * @returns {Promise<void>} promesa resuelta al terminar
     */
    async _podarAsync() {
        const carpeta = Gio.File.new_for_path(this._carpeta);
        const enumerador = await enumerateChildren(
            carpeta, 'standard::name,time::modified',
            Gio.FileQueryInfoFlags.NONE, this._cancellable);

        const archivos = [];
        for (;;) {
            const lote = await nextFiles(enumerador, 64, this._cancellable);
            if (lote.length === 0)
                break;
            for (const info of lote) {
                archivos.push({
                    nombre: info.get_name(),
                    fecha: info.get_modification_date_time()?.to_unix() ?? 0,
                });
            }
        }
        await closeEnumerator(enumerador);

        if (archivos.length <= MAX_ARCHIVOS)
            return;

        archivos.sort((a, b) => b.fecha - a.fecha);
        for (const {nombre} of archivos.slice(MAX_ARCHIVOS)) {
            const ruta = GLib.build_filenamev([this._carpeta, nombre]);
            borrar(Gio.File.new_for_path(ruta));

            // Lo que ya no está en disco tampoco puede seguir apuntado aquí: se
            // volverá a bajar el día que vuelva a sonar esa canción.
            for (const [url, guardada] of this._enDisco) {
                if (guardada === ruta)
                    this._enDisco.delete(url);
            }
        }
    }

    /**
     * Corta las descargas en curso. Se llama desde disable().
     */
    destruir() {
        this._cancellable.cancel();
        this._sesion?.abort();
        this._sesion = null;
        this._enDisco.clear();
        this._enCurso.clear();
    }
}

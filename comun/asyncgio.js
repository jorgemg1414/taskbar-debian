/*
 * asyncgio.js — Envoltorios de Promise para las operaciones asíncronas de Gio
 * que usa la extensión.
 *
 * GJS no promisifica automáticamente estos métodos, y Gio._promisify es API
 * privada (y global: parchearla afectaría a otras extensiones). Por eso aquí
 * se envuelven a mano con new Promise + callback, que es estable y no toca
 * nada fuera de este módulo.
 *
 * Ninguna de estas funciones bloquea el hilo principal.
 */

import GLib from 'gi://GLib';

/**
 * Consulta la información de un archivo o carpeta.
 *
 * @param {Gio.File} file archivo o carpeta
 * @param {string} atributos atributos a consultar (p. ej. 'standard::type')
 * @param {Gio.FileQueryInfoFlags} flags banderas de consulta
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<Gio.FileInfo>} información del archivo
 */
export function queryInfo(file, atributos, flags, cancellable) {
    return new Promise((resolve, reject) => {
        file.query_info_async(atributos, flags, GLib.PRIORITY_DEFAULT, cancellable, (obj, res) => {
            try {
                resolve(obj.query_info_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * Abre un enumerador sobre el contenido de un directorio.
 *
 * @param {Gio.File} dir directorio
 * @param {string} atributos atributos a consultar
 * @param {Gio.FileQueryInfoFlags} flags banderas de consulta
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<Gio.FileEnumerator>} enumerador del directorio
 */
export function enumerateChildren(dir, atributos, flags, cancellable) {
    return new Promise((resolve, reject) => {
        dir.enumerate_children_async(atributos, flags, GLib.PRIORITY_DEFAULT, cancellable, (obj, res) => {
            try {
                resolve(obj.enumerate_children_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * Pide el siguiente lote de entradas del enumerador.
 *
 * @param {Gio.FileEnumerator} enumerador enumerador abierto
 * @param {number} cantidad número máximo de entradas por lote
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<Gio.FileInfo[]>} lote de entradas (vacío al terminar)
 */
export function nextFiles(enumerador, cantidad, cancellable) {
    return new Promise((resolve, reject) => {
        enumerador.next_files_async(cantidad, GLib.PRIORITY_DEFAULT, cancellable, (obj, res) => {
            try {
                resolve(obj.next_files_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * Cierra un enumerador de directorio.
 *
 * @param {Gio.FileEnumerator} enumerador enumerador a cerrar
 * @returns {Promise<void>} promesa resuelta al cerrarse
 */
export function closeEnumerator(enumerador) {
    return new Promise((resolve, reject) => {
        enumerador.close_async(GLib.PRIORITY_DEFAULT, null, (obj, res) => {
            try {
                obj.close_finish(res);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * Lee el contenido completo de un archivo.
 *
 * @param {Gio.File} file archivo a leer
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<Uint8Array>} contenido en bytes
 */
export function loadContents(file, cancellable) {
    return new Promise((resolve, reject) => {
        file.load_contents_async(cancellable, (obj, res) => {
            try {
                // load_contents_finish devuelve [ok, contenido, etag].
                const [, contenido] = obj.load_contents_finish(res);
                resolve(contenido);
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * Intenta abrir una conexión TCP contra "host:puerto".
 *
 * @param {Gio.SocketClient} cliente cliente con el timeout ya configurado
 * @param {string} destino cadena "host:puerto" (IPv6 entre corchetes)
 * @param {number} puertoPorDefecto puerto usado si la cadena no lo lleva
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<Gio.SocketConnection>} conexión establecida
 */
export function connectToHost(cliente, destino, puertoPorDefecto, cancellable) {
    return new Promise((resolve, reject) => {
        cliente.connect_to_host_async(destino, puertoPorDefecto, cancellable, (obj, res) => {
            try {
                resolve(obj.connect_to_host_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * Espera a que termine un subproceso y recoge lo que haya escrito.
 *
 * @param {Gio.Subprocess} proceso proceso lanzado con las tuberías abiertas
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<{salida: string, error: string, codigo: number}>} resultado
 */
export function comunicar(proceso, cancellable) {
    return new Promise((resolve, reject) => {
        proceso.communicate_utf8_async(null, cancellable, (obj, res) => {
            try {
                const [, salida, error] = obj.communicate_utf8_finish(res);
                resolve({
                    salida: salida ?? '',
                    error: error ?? '',
                    // El código de salida solo es válido si terminó por su
                    // cuenta; si lo mató una señal, se cuenta como fallo.
                    codigo: obj.get_if_exited() ? obj.get_exit_status() : -1,
                });
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * Cierra una conexión de socket sin esperar el resultado.
 *
 * @param {Gio.IOStream} conexion conexión a cerrar
 */
export function cerrarConexion(conexion) {
    conexion.close_async(GLib.PRIORITY_DEFAULT, null, (obj, res) => {
        try {
            obj.close_finish(res);
        } catch {
            // Cerrar es best-effort: si falla, no hay nada que hacer.
        }
    });
}

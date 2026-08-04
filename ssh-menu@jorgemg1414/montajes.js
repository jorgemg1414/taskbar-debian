/*
 * montajes.js — Carpetas remotas montadas por SFTP.
 *
 * Cuando se abre una URL «sftp://» el gestor de archivos no descarga nada: le
 * pide a GVfs que monte el servidor, y GVfs lanza el propio ssh por debajo. Ese
 * montaje sigue vivo aunque cierres la ventana, así que el menú lo enseña y
 * permite desmontarlo.
 *
 * Se consulta con Gio.VolumeMonitor, que es un singleton del proceso: aquí solo
 * se leen sus montajes y se escuchan sus señales, nunca se destruye.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Trocea una URL sftp:// en usuario, host y puerto.
 *
 * @param {string} uri URL del montaje
 * @returns {{usuario: string, host: string, port: number}} partes de la URL
 */
function partirUri(uri) {
    try {
        const partes = GLib.Uri.parse(uri, GLib.UriFlags.NONE);
        return {
            usuario: partes.get_userinfo() ?? '',
            host: partes.get_host() ?? '',
            // Sin puerto explícito, GLib devuelve -1.
            port: partes.get_port() > 0 ? partes.get_port() : 22,
        };
    } catch {
        return {usuario: '', host: '', port: 22};
    }
}

/**
 * Devuelve los montajes SFTP activos ahora mismo.
 *
 * Si el servidor montado corresponde a un host del menú se usa su alias: es más
 * corto que el nombre que pone GVfs y coincide con lo que ves en la lista.
 *
 * @param {object[]} [hosts] hosts cargados, para reconocer los montajes
 * @returns {{mount: Gio.Mount, nombre: string, uri: string, id: string|null}[]} montajes
 */
export function listarMontajesSftp(hosts = []) {
    const salida = [];

    for (const mount of Gio.VolumeMonitor.get().get_mounts()) {
        const uri = mount.get_root()?.get_uri() ?? '';
        if (!uri.startsWith('sftp://'))
            continue;

        const {usuario, host, port} = partirUri(uri);

        // El usuario solo se compara si el montaje lo lleva: sin él, GVfs usa
        // el de la configuración de ssh, que es el mismo que mostramos.
        const conocido = hosts.find(h =>
            h.host.toLowerCase() === host.toLowerCase() &&
            h.port === port &&
            (usuario === '' || h.usuario === '' || h.usuario === usuario));

        salida.push({
            mount,
            nombre: conocido?.nombre ?? mount.get_name(),
            uri,
            id: conocido?.id ?? null,
        });
    }

    salida.sort((a, b) =>
        a.nombre.localeCompare(b.nombre, undefined, {sensitivity: 'base', numeric: true}));

    return salida;
}

/**
 * Identificadores de los hosts que están montados ahora mismo.
 *
 * @param {object[]} hosts hosts cargados
 * @returns {Set<string>} ids con montaje activo
 */
export function idsMontados(hosts) {
    const ids = new Set();
    for (const montaje of listarMontajesSftp(hosts)) {
        if (montaje.id)
            ids.add(montaje.id);
    }
    return ids;
}

/**
 * Carpeta que hay que abrir para un montaje: la que GVfs marca como inicial,
 * que en SFTP es la carpeta personal del usuario remoto y no la raíz.
 *
 * @param {Gio.Mount} mount montaje activo
 * @returns {string} URL a abrir
 */
export function uriDeMontaje(mount) {
    const inicial = mount.get_default_location();
    return (inicial ?? mount.get_root()).get_uri();
}

/**
 * Desmonta una carpeta remota.
 *
 * @param {Gio.Mount} mount montaje a soltar
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<void>} promesa que falla si el montaje sigue en uso
 */
export function desmontar(mount, cancellable) {
    return new Promise((resolve, reject) => {
        // Con operación de montaje GVfs puede preguntar qué hacer si hay
        // archivos abiertos, en vez de fallar sin más.
        mount.unmount_with_operation(
            Gio.MountUnmountFlags.NONE,
            new Gio.MountOperation(),
            cancellable,
            (obj, res) => {
                try {
                    obj.unmount_with_operation_finish(res);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
    });
}

/*
 * checker.js — Comprobación asíncrona de disponibilidad de los hosts.
 *
 * Se abre un socket TCP contra host:puerto con Gio.SocketClient. Nunca se
 * bloquea el hilo principal y cada comprobación tiene su propio Gio.Cancellable
 * para poder abortarla en disable().
 */

import Gio from 'gi://Gio';

import {connectToHost, cerrarConexion} from './asyncgio.js';

// Estados posibles de una conexión.
export const ESTADO = {
    DESCONOCIDO: 'desconocido',
    COMPROBANDO: 'comprobando',
    ARRIBA: 'arriba',
    ABAJO: 'abajo',
};

export class ComprobadorPuertos {
    /**
     * @param {object} opciones opciones del comprobador
     * @param {number} opciones.timeout segundos de espera por comprobación
     * @param {Function} opciones.alCambiar callback (id, estado) al cambiar un estado
     */
    constructor({timeout = 2, alCambiar = () => {}} = {}) {
        this._timeout = timeout;
        this._alCambiar = alCambiar;
        // id de conexión -> estado actual
        this._estados = new Map();
        // id de conexión -> Gio.Cancellable de la comprobación en curso
        this._enCurso = new Map();
        this._destruido = false;
    }

    /**
     * Segundos de espera antes de dar un host por caído.
     *
     * @param {number} segundos nuevo tiempo de espera
     */
    set timeout(segundos) {
        this._timeout = segundos;
    }

    /**
     * Estado conocido de una conexión.
     *
     * @param {string} id identificador de la conexión
     * @returns {string} uno de los valores de ESTADO
     */
    estadoDe(id) {
        return this._estados.get(id) ?? ESTADO.DESCONOCIDO;
    }

    /**
     * Olvida los estados de conexiones que ya no existen y cancela sus checks.
     *
     * @param {Set<string>} idsVivos identificadores que siguen existiendo
     */
    podar(idsVivos) {
        for (const id of [...this._estados.keys()]) {
            if (!idsVivos.has(id))
                this._estados.delete(id);
        }
        for (const [id, cancellable] of [...this._enCurso.entries()]) {
            if (!idsVivos.has(id)) {
                cancellable.cancel();
                this._enCurso.delete(id);
            }
        }
    }

    /**
     * Lanza la comprobación de todas las conexiones indicadas.
     *
     * @param {object[]} conexiones conexiones a comprobar
     */
    comprobarTodas(conexiones) {
        if (this._destruido)
            return;
        for (const conexion of conexiones)
            this.comprobar(conexion);
    }

    /**
     * Comprueba una conexión concreta. Si ya hay una comprobación en vuelo
     * para esa conexión, no se lanza otra.
     *
     * @param {object} conexion conexión con host y port
     */
    comprobar(conexion) {
        if (this._destruido || this._enCurso.has(conexion.id))
            return;

        const cancellable = new Gio.Cancellable();
        this._enCurso.set(conexion.id, cancellable);
        this._fijarEstado(conexion.id, ESTADO.COMPROBANDO);

        // IPv6 literal necesita corchetes en la cadena "host:puerto".
        const destino = conexion.host.includes(':')
            ? `[${conexion.host}]:${conexion.port}`
            : `${conexion.host}:${conexion.port}`;

        // El timeout de Gio.SocketClient se aplica a la resolución DNS y a la
        // conexión, así que un host DDNS caído no deja la comprobación colgada.
        const cliente = new Gio.SocketClient({timeout: this._timeout});

        connectToHost(cliente, destino, conexion.port, cancellable)
            .then(conn => {
                // Cerrar en cuanto sabemos que el puerto acepta conexiones.
                cerrarConexion(conn);
                this._terminar(conexion.id, cancellable, ESTADO.ARRIBA);
            })
            .catch(e => {
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    // Cancelado en disable() o al recargar: no se toca el estado.
                    if (this._enCurso.get(conexion.id) === cancellable)
                        this._enCurso.delete(conexion.id);
                    return;
                }
                this._terminar(conexion.id, cancellable, ESTADO.ABAJO);
            });
    }

    /**
     * Registra el resultado de una comprobación terminada.
     *
     * @param {string} id identificador de la conexión
     * @param {Gio.Cancellable} cancellable cancelable de esa comprobación
     * @param {string} estado estado resultante
     */
    _terminar(id, cancellable, estado) {
        if (this._enCurso.get(id) === cancellable)
            this._enCurso.delete(id);
        if (this._destruido)
            return;
        this._fijarEstado(id, estado);
    }

    /**
     * Guarda un estado y avisa solo si ha cambiado.
     *
     * @param {string} id identificador de la conexión
     * @param {string} estado nuevo estado
     */
    _fijarEstado(id, estado) {
        if (this._estados.get(id) === estado)
            return;
        this._estados.set(id, estado);
        this._alCambiar(id, estado);
    }

    /**
     * Cancela las comprobaciones en vuelo sin inutilizar el comprobador.
     * Se usa al cerrar el menú: los estados ya conocidos se conservan.
     */
    cancelarPendientes() {
        for (const [id, cancellable] of this._enCurso) {
            cancellable.cancel();
            // Una comprobación a medias no dice nada del host.
            if (this._estados.get(id) === ESTADO.COMPROBANDO)
                this._estados.delete(id);
        }
        this._enCurso.clear();
    }

    /**
     * Cancela todas las comprobaciones pendientes y deja el objeto inservible.
     * Se llama desde disable().
     */
    destruir() {
        this._destruido = true;
        for (const cancellable of this._enCurso.values())
            cancellable.cancel();
        this._enCurso.clear();
        this._estados.clear();
        this._alCambiar = () => {};
    }
}

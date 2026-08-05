/*
 * checker.js — Comprobación asíncrona de disponibilidad de los hosts.
 *
 * Se abre un socket TCP contra host:puerto con Gio.SocketClient. Nunca se
 * bloquea el hilo principal y cada comprobación tiene su propio Gio.Cancellable
 * para poder abortarla en disable().
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {connectToHost, cerrarConexion} from './asyncgio.js';

// Estados posibles de una conexión.
export const ESTADO = {
    DESCONOCIDO: 'desconocido',
    COMPROBANDO: 'comprobando',
    ARRIBA: 'arriba',
    ABAJO: 'abajo',
};

// Comprobaciones simultáneas como máximo. Abrir veinte sockets de golpe
// funciona, pero castiga al router y a los DNS sin ganar nada: el resto
// espera en cola y entra según van terminando.
const MAX_PARALELO = 8;

/**
 * Abre y cierra una conexión TCP contra host:puerto, midiendo lo que tarda.
 *
 * @param {object} destino equipo a sondear
 * @param {string} destino.host nombre o dirección
 * @param {number} destino.port puerto TCP
 * @param {number} timeout segundos de espera (incluye la resolución DNS)
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<number>} milisegundos que tardó en aceptar la conexión
 * @throws {GLib.Error} si no responde, no resuelve o se cancela
 */
export async function sondearPuerto({host, port}, timeout, cancellable = null) {
    // IPv6 literal necesita corchetes en la cadena "host:puerto".
    const destino = host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;

    // El timeout de Gio.SocketClient se aplica a la resolución DNS y a la
    // conexión, así que un host DDNS caído no deja la comprobación colgada.
    const cliente = new Gio.SocketClient({timeout});
    const inicio = GLib.get_monotonic_time();

    const conexion = await connectToHost(cliente, destino, port, cancellable);
    // Cerrar en cuanto sabemos que el puerto acepta conexiones.
    cerrarConexion(conexion);

    // Incluye la resolución DNS, que es justo lo que se nota al conectar.
    return Math.round((GLib.get_monotonic_time() - inicio) / 1000);
}

/**
 * Espera sin bloquear, y se corta si se cancela.
 *
 * @param {number} ms milisegundos a esperar
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<void>} promesa resuelta al cumplirse el plazo
 */
function dormir(ms, cancellable) {
    return new Promise(resolve => {
        if (cancellable?.is_cancelled()) {
            resolve();
            return;
        }

        let idFuente = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            idFuente = 0;
            if (idCancelacion)
                cancellable?.disconnect(idCancelacion);
            resolve();
            return GLib.SOURCE_REMOVE;
        });

        // Sin esto, un disable() dejaría vivo el temporizador hasta que venciera.
        const idCancelacion = cancellable?.connect(() => {
            if (idFuente) {
                GLib.source_remove(idFuente);
                idFuente = 0;
            }
            resolve();
        });
    });
}

/**
 * Espera a que un equipo empiece a responder, sondeándolo cada pocos segundos.
 *
 * Es lo que convierte el paquete mágico de Wake-on-LAN, que no tiene respuesta,
 * en algo que se puede afirmar: en vez de «paquete enviado», «ya responde».
 *
 * @param {object} destino equipo a sondear (host y port)
 * @param {object} [opciones] cadencia de la espera
 * @param {number} [opciones.timeout] segundos de espera de cada sondeo
 * @param {number} [opciones.intervalo] segundos entre sondeo y sondeo
 * @param {number} [opciones.limite] segundos que se espera como mucho
 * @param {Gio.Cancellable} [cancellable] cancelable
 * @returns {Promise<number|null>} segundos que tardó en responder, o null si no
 */
export async function esperarArranque(
    destino, {timeout = 2, intervalo = 5, limite = 120} = {}, cancellable = null) {
    const inicio = GLib.get_monotonic_time();
    const transcurrido = () =>
        Math.round((GLib.get_monotonic_time() - inicio) / 1000000);

    for (;;) {
        if (cancellable?.is_cancelled())
            return null;

        try {
            await sondearPuerto(destino, timeout, cancellable);
            return transcurrido();
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return null;
            // Cualquier otro fallo es lo normal mientras el equipo arranca.
        }

        // Un equipo apagado rechaza o agota el plazo, así que cada vuelta ya
        // consume su tiempo: se cuenta el real, no el número de intentos.
        if (transcurrido() >= limite)
            return null;

        await dormir(intervalo * 1000, cancellable);
    }
}

export class ComprobadorPuertos {
    /**
     * @param {object} opciones opciones del comprobador
     * @param {number} opciones.timeout segundos de espera por comprobación
     * @param {Function} opciones.alCambiar callback (id, estado, latencia) al cambiar un estado
     */
    constructor({timeout = 2, alCambiar = () => {}} = {}) {
        this._timeout = timeout;
        this._alCambiar = alCambiar;
        // id de conexión -> estado actual
        this._estados = new Map();
        // id de conexión -> milisegundos que tardó en aceptar la conexión
        this._latencias = new Map();
        // id de conexión -> Gio.Cancellable de la comprobación en curso
        this._enCurso = new Map();
        // Conexiones esperando hueco, y sus ids para no encolarlas dos veces.
        this._cola = [];
        this._enCola = new Set();
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
     * Última latencia medida de una conexión.
     *
     * @param {string} id identificador de la conexión
     * @returns {number|null} milisegundos, o null si no responde o no se sabe
     */
    latenciaDe(id) {
        return this._latencias.get(id) ?? null;
    }

    /**
     * Olvida los estados de conexiones que ya no existen y cancela sus checks.
     *
     * @param {Set<string>} idsVivos identificadores que siguen existiendo
     */
    podar(idsVivos) {
        for (const id of [...this._estados.keys()]) {
            if (!idsVivos.has(id)) {
                this._estados.delete(id);
                this._latencias.delete(id);
            }
        }
        for (const [id, cancellable] of [...this._enCurso.entries()]) {
            if (!idsVivos.has(id)) {
                cancellable.cancel();
                this._enCurso.delete(id);
            }
        }

        this._cola = this._cola.filter(c => idsVivos.has(c.id));
        this._enCola = new Set(this._cola.map(c => c.id));
        this._bombear();
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
     * Pone una conexión en la cola de comprobación. Si ya está en vuelo o
     * esperando turno, no se duplica.
     *
     * @param {object} conexion conexión con host y port
     */
    comprobar(conexion) {
        if (this._destruido || this._enCurso.has(conexion.id) || this._enCola.has(conexion.id))
            return;

        this._cola.push(conexion);
        this._enCola.add(conexion.id);
        // Se marca ya como «comprobando» aunque todavía esté esperando turno:
        // desde fuera es lo mismo, la comprobación está pedida.
        this._fijarEstado(conexion.id, ESTADO.COMPROBANDO);
        this._bombear();
    }

    /**
     * Arranca comprobaciones de la cola hasta llenar los huecos disponibles.
     */
    _bombear() {
        while (!this._destruido &&
               this._enCurso.size < MAX_PARALELO &&
               this._cola.length > 0) {
            const conexion = this._cola.shift();
            this._enCola.delete(conexion.id);
            this._lanzar(conexion);
        }
    }

    /**
     * Abre el socket de una comprobación concreta y mide lo que tarda.
     *
     * @param {object} conexion conexión con host y port
     */
    _lanzar(conexion) {
        const cancellable = new Gio.Cancellable();
        this._enCurso.set(conexion.id, cancellable);

        sondearPuerto(conexion, this._timeout, cancellable)
            .then(ms => {
                this._terminar(conexion.id, cancellable, ESTADO.ARRIBA, ms);
            })
            .catch(e => {
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    // Cancelado en disable() o al recargar: no se toca el estado.
                    if (this._enCurso.get(conexion.id) === cancellable)
                        this._enCurso.delete(conexion.id);
                    this._bombear();
                    return;
                }
                this._terminar(conexion.id, cancellable, ESTADO.ABAJO, null);
            });
    }

    /**
     * Registra el resultado de una comprobación terminada y da paso a la
     * siguiente de la cola.
     *
     * @param {string} id identificador de la conexión
     * @param {Gio.Cancellable} cancellable cancelable de esa comprobación
     * @param {string} estado estado resultante
     * @param {number|null} latencia milisegundos, o null si no respondió
     */
    _terminar(id, cancellable, estado, latencia) {
        if (this._enCurso.get(id) === cancellable)
            this._enCurso.delete(id);

        if (!this._destruido) {
            const anterior = this._latencias.get(id) ?? null;
            if (latencia === null)
                this._latencias.delete(id);
            else
                this._latencias.set(id, latencia);

            // La latencia también se avisa: cambia aunque el estado siga «arriba».
            const cambio = this._estados.get(id) !== estado || anterior !== latencia;
            this._estados.set(id, estado);
            if (cambio)
                this._alCambiar(id, estado, latencia);
        }

        this._bombear();
    }

    /**
     * Guarda un estado y avisa solo si ha cambiado. No toca la latencia: la
     * anterior se sigue mostrando mientras se recomprueba.
     *
     * @param {string} id identificador de la conexión
     * @param {string} estado nuevo estado
     */
    _fijarEstado(id, estado) {
        if (this._estados.get(id) === estado)
            return;
        this._estados.set(id, estado);
        this._alCambiar(id, estado, this.latenciaDe(id));
    }

    /**
     * Cancela las comprobaciones en vuelo sin inutilizar el comprobador.
     * Se usa al cerrar el menú: los estados ya conocidos se conservan.
     */
    cancelarPendientes() {
        for (const conexion of this._cola) {
            if (this._estados.get(conexion.id) === ESTADO.COMPROBANDO)
                this._estados.delete(conexion.id);
        }
        this._cola = [];
        this._enCola.clear();

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
        this._cola = [];
        this._enCola.clear();
        this._estados.clear();
        this._latencias.clear();
        this._alCambiar = () => {};
    }
}

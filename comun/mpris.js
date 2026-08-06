/*
 * mpris.js — Qué está sonando, preguntado por D-Bus, y cómo callarlo.
 *
 * Spotify —como casi todos los reproductores del escritorio— publica lo que
 * está reproduciendo en el bus de sesión con la interfaz estándar MPRIS
 * (org.mpris.MediaPlayer2). Ahí están el título, el artista, el álbum, la
 * portada, la duración y el estado, y desde ahí se le puede dar a siguiente o
 * a pausa. No hace falta ninguna cuenta, ni ninguna clave de la API web, ni que
 * salga nada de este equipo: es el propio programa el que lo cuenta.
 *
 * El reproductor va y viene: aparece en el bus al abrir Spotify y desaparece al
 * cerrarlo. Por eso aquí no se guarda una conexión fija, sino que se vigila el
 * bus y se elige a quién seguir cada vez que la lista de nombres cambia.
 *
 * Todo lo que se crea (suscripción al bus, proxies y cancelable) se suelta en
 * destruir().
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Todos los reproductores cuelgan de este prefijo: «org.mpris.MediaPlayer2.vlc»,
// «org.mpris.MediaPlayer2.spotify»…
const PREFIJO = 'org.mpris.MediaPlayer2';
export const BUS_SPOTIFY = `${PREFIJO}.spotify`;

// La ruta del objeto está fijada por la especificación: es la misma en todos.
const RUTA = '/org/mpris/MediaPlayer2';

// Milisegundos que se espera a una respuesta del reproductor. La posición se
// pide una vez por segundo: una respuesta más lenta que eso ya no sirve.
const TIEMPO_LIMITE_MS = 800;

// Valores de PlaybackStatus, tal cual los define MPRIS.
export const ESTADO = {
    SONANDO: 'Playing',
    PAUSADO: 'Paused',
    PARADO: 'Stopped',
};

// Solo se declara lo que se usa: el proxy se construye a partir de este XML y
// pedir de más son propiedades que hay que traer y mantener al día.
const XML_PLAYER = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
    <method name="SetPosition">
      <arg type="o" direction="in"/>
      <arg type="x" direction="in"/>
    </method>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <property name="Position" type="x" access="read"/>
  </interface>
</node>`;

const XML_RAIZ = `
<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/>
    <property name="Identity" type="s" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
    <property name="CanRaise" type="b" access="read"/>
  </interface>
</node>`;

const ProxyPlayer = Gio.DBusProxy.makeProxyWrapper(XML_PLAYER);
const ProxyRaiz = Gio.DBusProxy.makeProxyWrapper(XML_RAIZ);

/**
 * Sigue al reproductor que hay en el bus y avisa cada vez que algo cambia.
 */
export class ClienteMpris {
    /**
     * @param {object} opciones configuración
     * @param {boolean} opciones.cualquiera seguir a cualquier reproductor, no solo a Spotify
     * @param {Function} opciones.alCambiar se llama en cada cambio (pista, estado, reproductor)
     */
    constructor({cualquiera = false, alCambiar}) {
        this._alCambiar = alCambiar;
        this._cualquiera = cualquiera;
        this._bus = Gio.DBus.session;
        this._cancellable = new Gio.Cancellable();
        this._nombres = new Set();
        this._destino = null;
        this._player = null;
        this._raiz = null;
        this._idPropiedades = 0;
        this._destruido = false;

        // Con MATCH_ARG0_NAMESPACE llegan las altas y bajas de cualquier nombre
        // que cuelgue del prefijo, y solo de esos: el resto del bus, que es
        // mucho, ni se mira.
        this._idNombres = this._bus.signal_subscribe(
            'org.freedesktop.DBus',
            'org.freedesktop.DBus',
            'NameOwnerChanged',
            '/org/freedesktop/DBus',
            PREFIJO,
            Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE,
            (_conexion, _remitente, _ruta, _iface, _senal, parametros) => {
                const [nombre, , duenoNuevo] = parametros.deepUnpack();
                if (duenoNuevo === '')
                    this._nombres.delete(nombre);
                else
                    this._nombres.add(nombre);
                this._elegir();
            });

        this._listarNombres();
    }

    /**
     * Cambia si se sigue a cualquier reproductor o solo a Spotify.
     *
     * @param {boolean} valor true para seguir a cualquiera
     */
    set seguirCualquiera(valor) {
        if (this._cualquiera === valor)
            return;
        this._cualquiera = valor;
        this._elegir();
    }

    /* ------------------------- Quién está en el bus ------------------------- */

    /**
     * Primera foto de los reproductores que ya estaban abiertos.
     */
    _listarNombres() {
        this._bus.call(
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, new GLib.VariantType('(as)'),
            Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (objeto, res) => {
                let nombres;
                try {
                    [nombres] = objeto.call_finish(res).deepUnpack();
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.error(`[spotify-menu] No se pudo listar el bus: ${e.message}`);
                    return;
                }

                for (const nombre of nombres) {
                    if (nombre.startsWith(`${PREFIJO}.`))
                        this._nombres.add(nombre);
                }
                this._elegir();
            });
    }

    /**
     * Reproductor al que hay que seguir ahora mismo.
     *
     * Spotify manda siempre que esté abierto. Si no está y se sigue a
     * cualquiera, se mantiene el que ya se estaba siguiendo mientras siga en el
     * bus: cambiar de reproductor porque otro haya aparecido dejaría el panel
     * bailando entre dos programas.
     *
     * @returns {string|null} nombre de bus, o null si no hay a quién seguir
     */
    _preferido() {
        if (this._nombres.has(BUS_SPOTIFY))
            return BUS_SPOTIFY;
        if (!this._cualquiera)
            return null;
        if (this._destino !== null && this._nombres.has(this._destino))
            return this._destino;
        return [...this._nombres].sort()[0] ?? null;
    }

    /**
     * Se engancha al reproductor que toque, si ha cambiado.
     */
    _elegir() {
        if (this._destruido)
            return;

        const destino = this._preferido();
        if (destino === this._destino)
            return;

        this._soltar();
        this._destino = destino;
        if (destino !== null)
            this._conectar(destino);

        this._avisar();
    }

    /**
     * Crea los proxies del reproductor elegido.
     *
     * @param {string} destino nombre de bus del reproductor
     */
    _conectar(destino) {
        // Los proxies tardan en construirse: para cuando estén, el reproductor
        // puede haberse cerrado o haber cambiado la elección.
        const vigente = () => !this._destruido && this._destino === destino;

        new ProxyPlayer(this._bus, destino, RUTA, (proxy, error) => {
            if (!vigente())
                return;
            if (error) {
                console.error(`[spotify-menu] No se pudo hablar con ${destino}: ${error.message}`);
                return;
            }
            this._player = proxy;
            this._idPropiedades = proxy.connect('g-properties-changed', () => this._avisar());
            this._avisar();
        }, this._cancellable);

        new ProxyRaiz(this._bus, destino, RUTA, (proxy, error) => {
            // Esta interfaz solo da el nombre del programa y el poder traerlo al
            // frente: si falla, el menú sigue funcionando sin ella.
            if (!vigente() || error)
                return;
            this._raiz = proxy;
            this._avisar();
        }, this._cancellable);
    }

    /**
     * Suelta los proxies del reproductor anterior.
     */
    _soltar() {
        if (this._player !== null && this._idPropiedades !== 0)
            this._player.disconnect(this._idPropiedades);
        this._idPropiedades = 0;
        this._player = null;
        this._raiz = null;
    }

    /**
     * Avisa al menú de que hay algo nuevo que pintar.
     */
    _avisar() {
        if (!this._destruido)
            this._alCambiar?.();
    }

    /* ----------------------------- Qué suena ------------------------------- */

    /** @returns {boolean} si hay un reproductor al que seguir */
    get hayReproductor() {
        return this._player !== null;
    }

    /** @returns {boolean} si el reproductor es Spotify */
    get esSpotify() {
        return this._destino === BUS_SPOTIFY;
    }

    /** @returns {string} nombre del programa («Spotify», «VLC media player»…) */
    get reproductor() {
        const identidad = this._raiz?.Identity ?? '';
        if (identidad !== '')
            return identidad;
        // Sin la interfaz raíz, el sufijo del nombre de bus es lo que hay.
        return this._destino?.slice(PREFIJO.length + 1) ?? '';
    }

    /** @returns {string} archivo .desktop del programa, sin extensión */
    get entradaEscritorio() {
        return this._raiz?.DesktopEntry ?? '';
    }

    /** @returns {string} valor de ESTADO */
    get estado() {
        return this._player?.PlaybackStatus ?? ESTADO.PARADO;
    }

    /** @returns {boolean} si está sonando ahora mismo */
    get sonando() {
        return this.estado === ESTADO.SONANDO;
    }

    /** @returns {boolean} si se puede pasar a la siguiente */
    get puedeSiguiente() {
        return this._player?.CanGoNext === true;
    }

    /** @returns {boolean} si se puede volver a la anterior */
    get puedeAnterior() {
        return this._player?.CanGoPrevious === true;
    }

    /** @returns {boolean} si se puede saltar a un punto de la canción */
    get puedeBuscar() {
        return this._player?.CanSeek === true;
    }

    /** @returns {boolean} si se puede dar a reproducir o pausar */
    get puedeReproducir() {
        return this._player?.CanPlay === true;
    }

    /** @returns {boolean} si el programa puede traer su ventana al frente */
    get puedeElevar() {
        return this._raiz?.CanRaise === true;
    }

    /**
     * Lo que se sabe de la canción que está cargada.
     *
     * @returns {object|null} datos de la pista, o null si no hay ninguna
     */
    get pista() {
        // Se lee el variante en crudo en vez de la propiedad del proxy porque
        // los valores de un a{sv} llegan envueltos uno a uno; recursiveUnpack
        // los deja en tipos de JavaScript de una vez.
        const meta = this._player?.get_cached_property('Metadata')?.recursiveUnpack();
        if (!meta)
            return null;

        const titulo = meta['xesam:title'] ?? '';
        const artistas = Array.isArray(meta['xesam:artist']) ? meta['xesam:artist'] : [];

        // Un reproductor recién abierto está en el bus sin nada cargado.
        if (titulo === '' && artistas.length === 0)
            return null;

        return {
            id: meta['mpris:trackid'] ?? '',
            titulo,
            artista: artistas.filter(a => a !== '').join(', '),
            album: meta['xesam:album'] ?? '',
            caratula: meta['mpris:artUrl'] ?? '',
            // MPRIS cuenta el tiempo en microsegundos.
            duracion: Number(meta['mpris:length'] ?? 0),
            enlace: meta['xesam:url'] ?? '',
        };
    }

    /**
     * Por dónde va la canción.
     *
     * Position no se anuncia con PropertiesChanged —cambiaría mil veces por
     * segundo—, así que el valor que guarda el proxy nace viejo y hay que
     * preguntar cada vez.
     *
     * @returns {Promise<number|null>} microsegundos, o null si no se pudo saber
     */
    posicion() {
        if (this._player === null)
            return Promise.resolve(null);

        return new Promise(resolve => {
            this._bus.call(
                this._destino, RUTA, 'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
                new GLib.VariantType('(v)'),
                Gio.DBusCallFlags.NONE, TIEMPO_LIMITE_MS, this._cancellable,
                (objeto, res) => {
                    try {
                        const [valor] = objeto.call_finish(res).deepUnpack();
                        resolve(Number(valor.deepUnpack()));
                    } catch {
                        // El reproductor puede haberse cerrado entre pregunta y
                        // respuesta: sin posición, la barra se queda quieta.
                        resolve(null);
                    }
                });
        });
    }

    /* ------------------------------ Control -------------------------------- */

    /**
     * Llama a un método del reproductor sin esperar respuesta.
     *
     * @param {string} metodo nombre del método MPRIS
     * @param {...any} args argumentos del método
     */
    _llamar(metodo, ...args) {
        if (this._player === null)
            return;

        try {
            this._player[`${metodo}Async`](...args)
                .catch(e => console.error(`[spotify-menu] ${metodo} falló: ${e.message}`));
        } catch (e) {
            // Argumentos que el reproductor no acepta (una pista sin ruta
            // válida, por ejemplo): no es motivo para tirar el menú abajo.
            console.error(`[spotify-menu] No se pudo llamar a ${metodo}: ${e.message}`);
        }
    }

    /** Alterna entre reproducir y pausar. */
    reproducirPausar() {
        this._llamar('PlayPause');
    }

    /** Pasa a la canción siguiente. */
    siguiente() {
        this._llamar('Next');
    }

    /** Vuelve a la canción anterior. */
    anterior() {
        this._llamar('Previous');
    }

    /**
     * Salta a un punto de la canción que está sonando.
     *
     * @param {string} id identificador de la pista (mpris:trackid)
     * @param {number} microsegundos punto al que saltar
     */
    saltarA(id, microsegundos) {
        // SetPosition lleva el identificador de la pista para que el salto no
        // caiga en otra canción si cambió mientras arrastrabas la barra.
        if (!this.puedeBuscar || id === '')
            return;
        this._llamar('SetPosition', id, Math.max(0, Math.round(microsegundos)));
    }

    /** Pide al programa que traiga su ventana al frente. */
    elevar() {
        if (this.puedeElevar)
            this._llamar('Raise');
    }

    /* ------------------------------ Limpieza ------------------------------- */

    /**
     * Suelta la suscripción al bus y los proxies. Se llama desde disable().
     */
    destruir() {
        this._destruido = true;
        this._cancellable.cancel();

        if (this._idNombres !== 0) {
            this._bus.signal_unsubscribe(this._idNombres);
            this._idNombres = 0;
        }

        this._soltar();
        this._destino = null;
        this._nombres.clear();
        this._alCambiar = null;
    }
}

/* -------------------------------------------------------------------------
 * Callar y devolver el sonido a todo lo que esté reproduciendo
 *
 * Esto no sigue a nadie ni mantiene proxies: son cuatro llamadas sueltas al
 * bus. Lo usa el modo de concentración, al que no le interesa qué suena sino
 * que deje de sonar.
 * ------------------------------------------------------------------------- */

/**
 * Llama a un método de un reproductor y espera a que conteste.
 *
 * @param {string} destino nombre de bus del reproductor
 * @param {string} metodo método de org.mpris.MediaPlayer2.Player
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<boolean>} si la llamada salió bien
 */
function llamarA(destino, metodo, cancellable) {
    return new Promise(resolve => {
        Gio.DBus.session.call(
            destino, RUTA, 'org.mpris.MediaPlayer2.Player', metodo,
            null, null, Gio.DBusCallFlags.NONE, TIEMPO_LIMITE_MS, cancellable,
            (objeto, res) => {
                try {
                    objeto.call_finish(res);
                    resolve(true);
                } catch {
                    // Un reproductor que no implementa el método, o que se ha
                    // cerrado mientras tanto: no es motivo para nada.
                    resolve(false);
                }
            });
    });
}

/**
 * Estado de reproducción de un reproductor concreto.
 *
 * @param {string} destino nombre de bus del reproductor
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<string>} valor de ESTADO, o cadena vacía si no contestó
 */
function estadoDe(destino, cancellable) {
    return new Promise(resolve => {
        Gio.DBus.session.call(
            destino, RUTA, 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'PlaybackStatus']),
            new GLib.VariantType('(v)'),
            Gio.DBusCallFlags.NONE, TIEMPO_LIMITE_MS, cancellable,
            (objeto, res) => {
                try {
                    const [valor] = objeto.call_finish(res).deepUnpack();
                    resolve(valor.deepUnpack());
                } catch {
                    resolve('');
                }
            });
    });
}

/**
 * Nombres de bus de todos los reproductores que hay ahora mismo.
 *
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<string[]>} nombres, vacío si no se pudo preguntar
 */
function listarReproductores(cancellable) {
    return new Promise(resolve => {
        Gio.DBus.session.call(
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, new GLib.VariantType('(as)'),
            Gio.DBusCallFlags.NONE, TIEMPO_LIMITE_MS, cancellable,
            (objeto, res) => {
                try {
                    const [nombres] = objeto.call_finish(res).deepUnpack();
                    resolve(nombres.filter(n => n.startsWith(`${PREFIJO}.`)));
                } catch {
                    resolve([]);
                }
            });
    });
}

/**
 * Pausa todo lo que esté sonando.
 *
 * Se apunta a quién se pausó para poder devolvérselo después: lo que ya estaba
 * en pausa no se toca, y al reanudar no se le da a reproducir sin motivo.
 *
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<string[]>} reproductores que estaban sonando y se pausaron
 */
export async function pausarReproductores(cancellable) {
    const nombres = await listarReproductores(cancellable);
    const sonando = [];

    for (const nombre of nombres) {
        if (await estadoDe(nombre, cancellable) === ESTADO.SONANDO)
            sonando.push(nombre);
    }

    // Pause en vez de PlayPause: si algo cambia entre la consulta y la orden,
    // pausar dos veces sigue dejándolo en pausa.
    await Promise.all(sonando.map(nombre => llamarA(nombre, 'Pause', cancellable)));

    return sonando;
}

/**
 * Vuelve a poner en marcha los reproductores que se pausaron.
 *
 * @param {string[]} nombres los que devolvió pausarReproductores()
 * @param {Gio.Cancellable} cancellable cancelable
 * @returns {Promise<void>} promesa resuelta al terminar
 */
export async function reanudarReproductores(nombres, cancellable) {
    // Los que ya no están en el bus fallan solos y no molestan a los demás.
    await Promise.all(nombres.map(nombre => llamarA(nombre, 'Play', cancellable)));
}

/**
 * Pasa microsegundos a «m:ss», o «h:mm:ss» si hace falta.
 *
 * @param {number} microsegundos tiempo a escribir
 * @returns {string} tiempo legible
 */
export function formatearTiempo(microsegundos) {
    const total = Math.max(0, Math.floor(microsegundos / 1000000));
    const segundos = total % 60;
    const minutos = Math.floor(total / 60) % 60;
    const horas = Math.floor(total / 3600);

    const dosCifras = n => String(n).padStart(2, '0');

    return horas > 0
        ? `${horas}:${dosCifras(minutos)}:${dosCifras(segundos)}`
        : `${minutos}:${dosCifras(segundos)}`;
}

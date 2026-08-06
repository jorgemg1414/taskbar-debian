/*
 * extension.js — Spotify para GNOME Shell 48 (ESM).
 *
 * Indicador en la barra superior que dice qué canción está sonando, con su
 * portada, por dónde va y los botones para pasar de canción o pausarla.
 *
 * Lo que sabe se lo cuenta el propio reproductor por D-Bus (MPRIS): no hay
 * cuenta que enlazar, ni clave de la API web, ni nada que salga de este equipo
 * salvo la portada, que se baja de la dirección que publica Spotify.
 *
 * Con el menú cerrado el indicador solo escucha: los cambios de canción los
 * anuncia el reproductor. La posición, que nadie anuncia, se pregunta una vez
 * por segundo y únicamente mientras el menú está abierto.
 *
 * Todo lo que se crea aquí (indicador, cliente de D-Bus, temporizador y
 * señales) se destruye en disable(), como exige GNOME.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

import {ClienteMpris, ESTADO, formatearTiempo} from './mpris.js';
import {CacheCaratulas} from './caratula.js';

// Cada cuánto se pregunta por dónde va la canción, con el menú abierto.
const INTERVALO_POSICION_MS = 1000;

// Lado de la portada, en píxeles.
const TAMANO_CARATULA = 180;

// Cuánto hay que girar la rueda del ratón para que cuente como un paso, cuando
// el desplazamiento llega como valores continuos (ratones de precisión, táctil).
const PASO_RUEDA = 1.0;

// Programa que se abre desde el menú cuando Spotify no está en marcha.
const ESCRITORIO_SPOTIFY = 'spotify.desktop';

/* -------------------------------------------------------------------------
 * Barra de progreso: por dónde va la canción, y saltar a otro punto
 * ------------------------------------------------------------------------- */
const ItemProgreso = GObject.registerClass(
class ItemProgreso extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {Function} alSaltar se llama con la fracción (0-1) al soltar la barra
     */
    _init(alSaltar) {
        // Activar esta fila no cierra el menú: se arrastra dentro de ella.
        super._init({activate: false, hover: false, can_focus: false});

        this._alSaltar = alSaltar;
        this._arrastrando = false;
        this._duracion = 0;

        const columna = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'spotify-progreso',
        });
        this.add_child(columna);

        this._barra = new Slider.Slider(0);
        this._barra.connect('drag-begin', () => (this._arrastrando = true));
        this._barra.connect('drag-end', () => {
            this._arrastrando = false;
            this._alSaltar(this._barra.value);
        });
        // Mientras se arrastra, el tiempo de la izquierda sigue al dedo: es la
        // única referencia de a dónde va a caer el salto.
        this._barra.connect('notify::value', () => {
            if (this._arrastrando)
                this._transcurrido.text = formatearTiempo(this._barra.value * this._duracion);
        });
        columna.add_child(this._barra);

        const tiempos = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
        });
        this._transcurrido = new St.Label({text: '0:00', style_class: 'spotify-tiempo'});
        this._total = new St.Label({
            text: '0:00',
            style_class: 'spotify-tiempo',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        });
        tiempos.add_child(this._transcurrido);
        tiempos.add_child(this._total);
        columna.add_child(tiempos);
    }

    /** @returns {boolean} si el usuario está arrastrando la barra ahora mismo */
    get arrastrando() {
        return this._arrastrando;
    }

    /**
     * Deja la barra donde toque.
     *
     * @param {number} posicion microsegundos transcurridos
     * @param {number} duracion microsegundos que dura la canción
     * @param {boolean} sePuedeSaltar si el reproductor admite saltos
     */
    fijar(posicion, duracion, sePuedeSaltar) {
        this._duracion = duracion;

        // Con la barra en la mano, mandan los dedos y no el reproductor.
        if (this._arrastrando)
            return;

        this._barra.value = duracion > 0
            ? Math.min(1, Math.max(0, posicion / duracion))
            : 0;
        this._barra.reactive = sePuedeSaltar;
        this._transcurrido.text = formatearTiempo(posicion);
        this._total.text = formatearTiempo(duracion);
    }
});

/* -------------------------------------------------------------------------
 * Fila de botones: anterior, reproducir/pausar, siguiente
 * ------------------------------------------------------------------------- */
const ItemControles = GObject.registerClass(
class ItemControles extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {object} acciones qué hace cada botón
     * @param {Function} acciones.anterior canción anterior
     * @param {Function} acciones.reproducirPausar alternar reproducción
     * @param {Function} acciones.siguiente canción siguiente
     */
    _init({anterior, reproducirPausar, siguiente}) {
        super._init({activate: false, hover: false, can_focus: false});

        const fila = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'spotify-controles',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(fila);

        this._anterior = this._boton('media-skip-backward-symbolic', _('Anterior'), anterior);
        this._reproducir = this._boton('media-playback-start-symbolic', _('Reproducir'), reproducirPausar);
        this._siguiente = this._boton('media-skip-forward-symbolic', _('Siguiente'), siguiente);

        for (const boton of [this._anterior, this._reproducir, this._siguiente])
            fila.add_child(boton);
    }

    /**
     * Construye uno de los botones.
     *
     * @param {string} icono nombre del icono simbólico
     * @param {string} descripcion nombre accesible del botón
     * @param {Function} accion qué hacer al pulsarlo
     * @returns {St.Button} botón listo para añadir
     */
    _boton(icono, descripcion, accion) {
        const boton = new St.Button({
            style_class: 'spotify-boton',
            can_focus: true,
            accessible_name: descripcion,
            child: new St.Icon({icon_name: icono, style_class: 'popup-menu-icon'}),
        });
        boton.connect('clicked', () => accion());
        return boton;
    }

    /**
     * Pone los botones al día con lo que el reproductor deja hacer.
     *
     * @param {object} estado qué se puede hacer ahora mismo
     * @param {boolean} estado.sonando si está sonando
     * @param {boolean} estado.puedeAnterior si admite volver atrás
     * @param {boolean} estado.puedeReproducir si admite reproducir o pausar
     * @param {boolean} estado.puedeSiguiente si admite pasar a la siguiente
     */
    fijar({sonando, puedeAnterior, puedeReproducir, puedeSiguiente}) {
        this._reproducir.child.icon_name = sonando
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._reproducir.accessible_name = sonando ? _('Pausar') : _('Reproducir');

        // Un botón que el reproductor no atendería se queda apagado en vez de
        // fingir que hace algo.
        const habilitar = (boton, puede) => {
            boton.reactive = puede;
            boton.can_focus = puede;
            if (puede)
                boton.remove_style_class_name('spotify-boton-apagado');
            else
                boton.add_style_class_name('spotify-boton-apagado');
        };

        habilitar(this._anterior, puedeAnterior);
        habilitar(this._reproducir, puedeReproducir);
        habilitar(this._siguiente, puedeSiguiente);
    }
});

/* -------------------------------------------------------------------------
 * Indicador del panel
 * ------------------------------------------------------------------------- */
const IndicadorSpotify = GObject.registerClass(
class IndicadorSpotify extends PanelMenu.Button {
    /**
     * @param {Extension} extension instancia de la extensión (settings, openPreferences)
     */
    _init(extension) {
        super._init(0.5, 'Spotify');

        this._extension = extension;
        this._settings = extension.getSettings();
        this._idsSettings = [];
        this._idPosicion = 0;
        this._urlCaratula = null;
        this._acumuladoRueda = 0;
        this._destruido = false;

        this._cache = new CacheCaratulas();

        /* ------------------------- Barra superior ------------------------ */
        const caja = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'panel-status-menu-box',
        });
        this._icono = new St.Icon({
            icon_name: this._settings.get_string('panel-icon'),
            style_class: 'system-status-icon',
        });
        this._etiquetaPanel = new St.Label({
            text: '',
            style_class: 'spotify-panel-texto',
            y_align: Clutter.ActorAlign.CENTER,
        });
        caja.add_child(this._icono);
        caja.add_child(this._etiquetaPanel);
        this.add_child(caja);

        this._construirMenu();

        this._cliente = new ClienteMpris({
            cualquiera: this._settings.get_boolean('any-player'),
            alCambiar: () => this._refrescar(),
        });

        // La posición solo se pregunta con el menú abierto: cerrado, el
        // indicador no habla con nadie.
        this._idAbrir = this.menu.connect('open-state-changed', (_menu, abierto) => {
            if (abierto)
                this._arrancarReloj();
            else
                this._pararReloj();
        });

        // Conectado sobre el propio actor: se suelta solo al destruirlo.
        this.connect('scroll-event', (_actor, evento) => this._alDesplazar(evento));

        this._conectarSettings();
        this._refrescar();
    }

    /**
     * Reacciona a los cambios de configuración sin recargar el shell.
     */
    _conectarSettings() {
        const conectar = (clave, cb) =>
            this._idsSettings.push(this._settings.connect(`changed::${clave}`, cb));

        conectar('any-player', () =>
            (this._cliente.seguirCualquiera = this._settings.get_boolean('any-player')));
        conectar('panel-icon', () =>
            (this._icono.icon_name = this._settings.get_string('panel-icon')));

        for (const clave of ['panel-format', 'panel-max-chars', 'show-panel-text',
            'hide-when-stopped', 'icon-shows-state', 'show-art', 'show-position'])
            conectar(clave, () => this._refrescar());
    }

    /* ------------------------------ Menú ------------------------------- */

    /**
     * Monta el menú una sola vez; luego solo cambia lo que hay dentro.
     */
    _construirMenu() {
        /* Cabecera: portada, título, artista y álbum. */
        this._itemPista = new PopupMenu.PopupBaseMenuItem({style_class: 'spotify-pista'});
        const columna = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._itemPista.add_child(columna);

        this._caratula = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: TAMANO_CARATULA,
            style_class: 'spotify-caratula',
            x_align: Clutter.ActorAlign.CENTER,
        });
        columna.add_child(this._caratula);

        this._titulo = this._etiqueta('spotify-titulo');
        this._artista = this._etiqueta('spotify-artista');
        this._album = this._etiqueta('spotify-album');
        for (const etiqueta of [this._titulo, this._artista, this._album])
            columna.add_child(etiqueta);

        // Pulsar la canción lleva a la ventana del reproductor, que es lo que
        // se quiere hacer casi siempre después de mirar qué suena.
        this._itemPista.connect('activate', () => this._irAlReproductor());
        this.menu.addMenuItem(this._itemPista);

        /* Progreso y botones. */
        this._itemProgreso = new ItemProgreso(fraccion => {
            const pista = this._cliente.pista;
            if (pista !== null && pista.duracion > 0)
                this._cliente.saltarA(pista.id, fraccion * pista.duracion);
        });
        this.menu.addMenuItem(this._itemProgreso);

        this._itemControles = new ItemControles({
            anterior: () => this._cliente.anterior(),
            reproducirPausar: () => this._cliente.reproducirPausar(),
            siguiente: () => this._cliente.siguiente(),
        });
        this.menu.addMenuItem(this._itemControles);

        /* Aviso de que no hay nada, con el atajo para abrir Spotify. */
        this._itemVacio = new PopupMenu.PopupMenuItem(_('No hay nada sonando'), {
            reactive: false,
            style_class: 'spotify-aviso',
        });
        this.menu.addMenuItem(this._itemVacio);

        this._itemAbrir = new PopupMenu.PopupImageMenuItem(
            _('Abrir Spotify'), 'audio-x-generic-symbolic');
        this._itemAbrir.connect('activate', () => this._abrirSpotify());
        this.menu.addMenuItem(this._itemAbrir);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._itemEnlace = new PopupMenu.PopupImageMenuItem(
            _('Copiar el enlace de la canción'), 'edit-copy-symbolic');
        this._itemEnlace.connect('activate', () => this._copiarEnlace());
        this.menu.addMenuItem(this._itemEnlace);

        const prefs = new PopupMenu.PopupImageMenuItem(
            _('Preferencias'), 'preferences-system-symbolic');
        prefs.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefs);
    }

    /**
     * Crea una de las etiquetas de la cabecera.
     *
     * @param {string} clase clase de estilo
     * @returns {St.Label} etiqueta que se corta con puntos suspensivos
     */
    _etiqueta(clase) {
        const etiqueta = new St.Label({text: '', style_class: clase});
        // El ancho lo fija la hoja de estilos; los títulos largos se cortan en
        // vez de estirar el menú media pantalla.
        etiqueta.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        return etiqueta;
    }

    /* ---------------------------- Pintado ------------------------------ */

    /**
     * Pone al día el panel y el menú con lo que dice el reproductor.
     */
    _refrescar() {
        if (this._destruido)
            return;

        const pista = this._cliente.pista;
        const hayPista = this._cliente.hayReproductor && pista !== null;

        this._pintarPanel(pista, hayPista);
        this._pintarMenu(pista, hayPista);
    }

    /**
     * Pinta el icono y el texto de la barra superior.
     *
     * @param {object|null} pista canción cargada, si la hay
     * @param {boolean} hayPista si hay algo que enseñar
     */
    _pintarPanel(pista, hayPista) {
        const parado = !hayPista || this._cliente.estado === ESTADO.PARADO;

        // Sin nada sonando el indicador estorba: por omisión se quita de la
        // barra y vuelve solo cuando hay música.
        this.visible = !parado || !this._settings.get_boolean('hide-when-stopped');

        if (this._settings.get_boolean('icon-shows-state') && hayPista) {
            this._icono.icon_name = this._cliente.sonando
                ? 'media-playback-start-symbolic'
                : 'media-playback-pause-symbolic';
        } else {
            this._icono.icon_name = this._settings.get_string('panel-icon');
        }

        const texto = hayPista && this._settings.get_boolean('show-panel-text')
            ? this._recortar(this._formatear(this._settings.get_string('panel-format'), pista))
            : '';
        this._etiquetaPanel.text = texto;
        this._etiquetaPanel.visible = texto !== '';

        this.accessible_name = hayPista
            ? `${this._cliente.reproductor}: ${pista.artista} — ${pista.titulo}`
            : this._cliente.reproductor || 'Spotify';
    }

    /**
     * Pinta el interior del menú.
     *
     * @param {object|null} pista canción cargada, si la hay
     * @param {boolean} hayPista si hay algo que enseñar
     */
    _pintarMenu(pista, hayPista) {
        this._itemPista.visible = hayPista;
        this._itemControles.visible = hayPista;
        this._itemProgreso.visible = hayPista && this._settings.get_boolean('show-position');
        this._itemVacio.visible = !hayPista;
        this._itemEnlace.visible = hayPista && pista.enlace !== '';

        // Solo tiene sentido ofrecer abrirlo si no está ya abierto y el sistema
        // sabe cómo hacerlo.
        this._itemAbrir.visible = !this._cliente.hayReproductor && this._appSpotify() !== null;

        if (!hayPista) {
            this._itemVacio.label.text = this._cliente.hayReproductor
                ? `${this._cliente.reproductor} ${_('no tiene nada cargado')}`
                : _('Spotify no está abierto');
            this._pintarCaratula(null);
            this._pararReloj();
            return;
        }

        this._titulo.text = pista.titulo || _('Sin título');
        this._artista.text = pista.artista;
        this._artista.visible = pista.artista !== '';
        this._album.text = pista.album;
        this._album.visible = pista.album !== '';

        this._itemControles.fijar({
            sonando: this._cliente.sonando,
            puedeAnterior: this._cliente.puedeAnterior,
            puedeReproducir: this._cliente.puedeReproducir,
            puedeSiguiente: this._cliente.puedeSiguiente,
        });

        this._pintarCaratula(pista);

        // Al cambiar de canción la barra vuelve al principio sin esperar a la
        // próxima consulta, que puede tardar hasta un segundo.
        if (this._itemProgreso.visible) {
            this._itemProgreso.fijar(0, pista.duracion, this._cliente.puedeBuscar);
            if (this.menu.isOpen)
                this._arrancarReloj();
        }
    }

    /**
     * Pone la portada del disco, bajándola si hace falta.
     *
     * @param {object|null} pista canción cargada, si la hay
     */
    _pintarCaratula(pista) {
        const mostrar = this._settings.get_boolean('show-art');
        this._caratula.visible = mostrar;
        if (!mostrar)
            return;

        const url = pista?.caratula ?? '';
        if (url === this._urlCaratula)
            return;

        // Mientras llega la nueva, el hueco no se queda con la portada de la
        // canción anterior, que sería una mentira pequeña pero fea.
        this._urlCaratula = url;
        this._caratula.gicon = null;
        this._caratula.icon_name = 'audio-x-generic-symbolic';
        if (url === '')
            return;

        this._cache.rutaDe(url)
            .then(ruta => {
                // Puede haber cambiado la canción mientras se bajaba.
                if (this._destruido || ruta === null || this._urlCaratula !== url)
                    return;
                this._caratula.gicon = Gio.FileIcon.new(Gio.File.new_for_path(ruta));
            })
            .catch(e => {
                if (!this._destruido)
                    console.error(`[spotify-menu] Portada: ${e.message}`);
            });
    }

    /**
     * Aplica la plantilla del panel a la canción.
     *
     * @param {string} plantilla texto con {titulo}, {artista} y {album}
     * @param {object} pista canción cargada
     * @returns {string} texto ya montado
     */
    _formatear(plantilla, pista) {
        const valores = {
            titulo: pista.titulo,
            artista: pista.artista,
            album: pista.album,
        };
        return plantilla
            .replace(/\{(titulo|artista|album)\}/g, (_todo, clave) => valores[clave])
            .trim();
    }

    /**
     * Corta el texto del panel para que no se coma la barra.
     *
     * @param {string} texto texto ya montado
     * @returns {string} texto recortado
     */
    _recortar(texto) {
        const maximo = this._settings.get_int('panel-max-chars');
        // Se cuentan caracteres, no bytes: los títulos vienen con acentos y con
        // alfabetos de todas partes.
        const letras = [...texto];
        return letras.length > maximo
            ? `${letras.slice(0, maximo).join('').trimEnd()}…`
            : texto;
    }

    /* ---------------------------- Posición ----------------------------- */

    /**
     * Empieza a preguntar por dónde va la canción.
     */
    _arrancarReloj() {
        this._pararReloj();

        if (!this._cliente.hayReproductor || !this._settings.get_boolean('show-position'))
            return;

        this._preguntarPosicion();
        this._idPosicion = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, INTERVALO_POSICION_MS, () => {
                this._preguntarPosicion();
                return GLib.SOURCE_CONTINUE;
            });
    }

    /**
     * Deja de preguntar.
     */
    _pararReloj() {
        if (this._idPosicion !== 0) {
            GLib.source_remove(this._idPosicion);
            this._idPosicion = 0;
        }
    }

    /**
     * Pregunta la posición y mueve la barra.
     */
    _preguntarPosicion() {
        // Con la barra en la mano no se le lleva la contraria al usuario.
        if (this._itemProgreso.arrastrando)
            return;

        this._cliente.posicion().then(posicion => {
            if (this._destruido || posicion === null || this._itemProgreso.arrastrando)
                return;
            const pista = this._cliente.pista;
            if (pista === null)
                return;
            this._itemProgreso.fijar(posicion, pista.duracion, this._cliente.puedeBuscar);
        });
    }

    /* ----------------------------- Acciones ---------------------------- */

    /**
     * Aplicación de Spotify instalada, si la hay.
     *
     * @returns {Shell.App|null} aplicación, o null si no está instalada
     */
    _appSpotify() {
        const sistema = Shell.AppSystem.get_default();
        const entrada = this._cliente.entradaEscritorio;
        return (entrada !== '' ? sistema.lookup_app(`${entrada}.desktop`) : null) ??
            sistema.lookup_app(ESCRITORIO_SPOTIFY);
    }

    /**
     * Trae al frente la ventana del reproductor.
     */
    _irAlReproductor() {
        // Activar la aplicación funciona mejor que Raise(): el shell sabe en
        // qué escritorio está su ventana y no choca con la protección contra
        // robos de foco.
        const app = this._appSpotify();
        if (app !== null && app.get_n_windows() > 0)
            app.activate();
        else
            this._cliente.elevar();
    }

    /**
     * Abre Spotify cuando no está en marcha.
     */
    _abrirSpotify() {
        const app = this._appSpotify();
        if (app === null) {
            Main.notifyError('Spotify', _('No encuentro Spotify instalado en este equipo'));
            return;
        }
        app.activate();
    }

    /**
     * Copia al portapapeles el enlace de la canción.
     */
    _copiarEnlace() {
        const pista = this._cliente.pista;
        if (pista === null || pista.enlace === '')
            return;

        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, pista.enlace);
        Main.notify('Spotify', `${_('Enlace copiado')}: ${pista.titulo}`);
    }

    /* ------------------------- Ratón en el panel ------------------------ */

    /**
     * El botón central pausa sin abrir el menú; el resto abre el menú, como
     * hace cualquier indicador.
     *
     * @param {Clutter.Event} evento evento recibido
     * @returns {boolean} si el evento se da por atendido
     */
    vfunc_event(evento) {
        if (evento.type() === Clutter.EventType.BUTTON_PRESS &&
            evento.get_button() === Clutter.BUTTON_MIDDLE &&
            this._settings.get_boolean('middle-click-plays')) {
            this._cliente.reproducirPausar();
            return Clutter.EVENT_STOP;
        }

        return super.vfunc_event(evento);
    }

    /**
     * Cambia de canción con la rueda del ratón, si está activado.
     *
     * @param {Clutter.Event} evento evento de desplazamiento
     * @returns {boolean} si el evento se da por atendido
     */
    _alDesplazar(evento) {
        if (!this._settings.get_boolean('scroll-changes-track') || !this._cliente.hayReproductor)
            return Clutter.EVENT_PROPAGATE;

        let pasos = 0;
        switch (evento.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
            pasos = -1;
            break;
        case Clutter.ScrollDirection.DOWN:
            pasos = 1;
            break;
        case Clutter.ScrollDirection.SMOOTH: {
            // Un ratón de precisión manda muchos avisos pequeños: se van
            // sumando hasta completar un paso.
            const [, dy] = evento.get_scroll_delta();
            this._acumuladoRueda += dy;
            if (Math.abs(this._acumuladoRueda) < PASO_RUEDA)
                return Clutter.EVENT_STOP;
            pasos = Math.sign(this._acumuladoRueda);
            this._acumuladoRueda = 0;
            break;
        }
        default:
            return Clutter.EVENT_PROPAGATE;
        }

        if (pasos > 0)
            this._cliente.siguiente();
        else
            this._cliente.anterior();

        return Clutter.EVENT_STOP;
    }

    /* ---------------------------- Limpieza ----------------------------- */

    /**
     * Libera todo. Se llama desde disable().
     */
    destroy() {
        this._destruido = true;

        this._pararReloj();

        this._cliente.destruir();
        this._cliente = null;
        this._cache.destruir();
        this._cache = null;

        if (this._idAbrir) {
            this.menu.disconnect(this._idAbrir);
            this._idAbrir = 0;
        }

        for (const id of this._idsSettings)
            this._settings.disconnect(id);
        this._idsSettings = [];

        this._settings = null;
        this._extension = null;

        super.destroy();
    }
});

/* -------------------------------------------------------------------------
 * Punto de entrada de la extensión (API moderna de GNOME 45+)
 * ------------------------------------------------------------------------- */
export default class SpotifyMenuExtension extends Extension {
    /**
     * Crea el indicador y lo añade al panel.
     */
    enable() {
        this._indicador = new IndicadorSpotify(this);
        // A la derecha del reloj empieza el área de estado; el indicador va al
        // principio de ella, junto a los demás menús de este repositorio.
        Main.panel.addToStatusArea(this.uuid, this._indicador, 1, 'right');
    }

    /**
     * Destruye el indicador y, con él, todos sus recursos.
     */
    disable() {
        this._indicador?.destroy();
        this._indicador = null;
    }
}

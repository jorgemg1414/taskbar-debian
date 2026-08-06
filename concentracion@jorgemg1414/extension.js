/*
 * extension.js — Concentración para GNOME Shell 48 (ESM).
 *
 * Un interruptor en la barra que apaga de golpe lo que interrumpe: activa No
 * molestar, pausa lo que esté sonando y esconde la dock. Al cumplirse el tiempo
 * lo deja todo como estaba.
 *
 * Nada de esto es suyo: son ajustes de GNOME, de Dash to Dock y llamadas MPRIS
 * a los reproductores. Por eso lo importante aquí no es encenderlo, sino
 * poder apagarlo: antes de tocar nada se apunta cómo estaba, y eso se guarda en
 * GSettings —no en memoria— para que un reinicio del shell en mitad de una
 * sesión no te deje el escritorio en silencio para siempre.
 *
 * Y por lo mismo, al restaurar solo se devuelve lo que siga como lo dejamos: si
 * has tocado No molestar a mano durante la sesión, manda lo tuyo.
 *
 * Todo lo que se crea aquí (indicador, temporizador, cancelable y señales) se
 * destruye en disable(), como exige GNOME.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {pausarReproductores, reanudarReproductores} from './mpris.js';
import {SitioEnLaBarra} from './barra.js';

// Los botones de duración del menú, en minutos.
const DURACIONES = [25, 50, 90];

// Ajuste de GNOME que enseña o calla los avisos. Es el mismo que mueve el
// interruptor de «No molestar» del calendario.
const ESQUEMA_AVISOS = 'org.gnome.desktop.notifications';
const CLAVE_AVISOS = 'show-banners';

// Dash to Dock, si está. «manualhide» la quita del escritorio del todo, no solo
// mientras hay ventanas encima.
const UUID_DOCK = 'dash-to-dock@micxgx.gmail.com';
const ESQUEMA_DOCK = 'org.gnome.shell.extensions.dash-to-dock';
const CLAVE_DOCK = 'manualhide';

/**
 * Ajustes de Dash to Dock, si la extensión está instalada.
 *
 * Su esquema no está en el sistema, sino dentro de su propia carpeta, así que
 * hay que buscarlo ahí cuando no aparece por las buenas.
 *
 * @returns {Gio.Settings|null} ajustes de la dock, o null si no está
 */
function ajustesDeDock() {
    const porDefecto = Gio.SettingsSchemaSource.get_default();
    if (porDefecto?.lookup(ESQUEMA_DOCK, true))
        return new Gio.Settings({schema_id: ESQUEMA_DOCK});

    const carpeta = GLib.build_filenamev([
        GLib.get_user_data_dir(), 'gnome-shell', 'extensions', UUID_DOCK, 'schemas',
    ]);

    try {
        const fuente = Gio.SettingsSchemaSource.new_from_directory(carpeta, porDefecto, false);
        const esquema = fuente.lookup(ESQUEMA_DOCK, false);
        return esquema ? new Gio.Settings({settings_schema: esquema}) : null;
    } catch {
        // No está instalada, o su esquema no está compilado: se sigue sin dock.
        return null;
    }
}

/**
 * Escribe los minutos que quedan como se leen de un vistazo.
 *
 * @param {number} segundos tiempo restante
 * @returns {string} texto para la barra
 */
function formatearRestante(segundos) {
    // Se redondea hacia arriba: mientras quede algo de un minuto, ese minuto
    // todavía cuenta. Así una sesión de 50 empieza marcando 50 y no 49.
    if (segundos >= 60)
        return `${Math.ceil(segundos / 60)} min`;
    // El último minuto se cuenta en segundos: es cuando se mira.
    return `${Math.max(0, Math.ceil(segundos))} s`;
}

/* -------------------------------------------------------------------------
 * Fila con los botones de duración
 * ------------------------------------------------------------------------- */
const ItemDuraciones = GObject.registerClass(
class ItemDuraciones extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {Function} alElegir se llama con los minutos elegidos (0 = sin límite)
     */
    _init(alElegir) {
        super._init({activate: false, hover: false, can_focus: false});

        const fila = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'concentracion-duraciones',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(fila);

        for (const minutos of DURACIONES)
            fila.add_child(this._boton(`${minutos} min`, minutos, alElegir));

        // Sin límite: para cuando no sabes cuánto vas a estar, pero sí que no
        // quieres que te molesten.
        fila.add_child(this._boton(_('Sin límite'), 0, alElegir));
    }

    /**
     * @param {string} texto etiqueta del botón
     * @param {number} minutos duración que arranca
     * @param {Function} alElegir qué hacer al pulsarlo
     * @returns {St.Button} botón listo para añadir
     */
    _boton(texto, minutos, alElegir) {
        const boton = new St.Button({
            label: texto,
            style_class: 'concentracion-duracion',
            can_focus: true,
        });
        boton.connect('clicked', () => alElegir(minutos));
        return boton;
    }
});

/* -------------------------------------------------------------------------
 * Indicador del panel
 * ------------------------------------------------------------------------- */
const IndicadorConcentracion = GObject.registerClass(
class IndicadorConcentracion extends PanelMenu.Button {
    /**
     * @param {Extension} extension instancia de la extensión (settings, openPreferences)
     */
    _init(extension) {
        super._init(0.5, _('Concentración'));

        this._extension = extension;
        this._settings = extension.getSettings();
        this._avisos = new Gio.Settings({schema_id: ESQUEMA_AVISOS});
        this._dock = ajustesDeDock();
        this._cancellable = new Gio.Cancellable();
        this._idsSettings = [];
        this._idReloj = 0;
        this._destruido = false;

        // Lo que hay que deshacer al terminar. Vive también en GSettings, por si
        // el shell se va antes de que termine la sesión.
        this._sesion = null;

        const caja = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'panel-status-menu-box',
        });
        this._icono = new St.Icon({
            icon_name: this._settings.get_string('panel-icon'),
            style_class: 'system-status-icon',
        });
        this._etiqueta = new St.Label({
            text: '',
            style_class: 'concentracion-restante',
            y_align: Clutter.ActorAlign.CENTER,
        });
        caja.add_child(this._icono);
        caja.add_child(this._etiqueta);
        this.add_child(caja);

        this._construirMenu();
        this._conectarSettings();
        this._recuperarSesion();
        this._pintar();
    }

    /**
     * Reacciona a los cambios de configuración sin recargar el shell.
     */
    _conectarSettings() {
        const conectar = (clave, cb) =>
            this._idsSettings.push(this._settings.connect(`changed::${clave}`, cb));

        conectar('panel-icon', () =>
            (this._icono.icon_name = this._settings.get_string('panel-icon')));
        conectar('show-countdown', () => {
            this._pintar();
            if (this.activa)
                this._arrancarReloj();
        });
    }

    /* ------------------------------ Menú ------------------------------- */

    /**
     * Monta el menú una sola vez; luego solo cambia lo que hay dentro.
     */
    _construirMenu() {
        this._itemEstado = new PopupMenu.PopupMenuItem('', {
            reactive: false,
            style_class: 'concentracion-estado',
        });
        this.menu.addMenuItem(this._itemEstado);

        this._itemDuraciones = new ItemDuraciones(minutos => {
            this.menu.close();
            this.empezar(minutos);
        });
        this.menu.addMenuItem(this._itemDuraciones);

        this._itemTerminar = new PopupMenu.PopupImageMenuItem(
            _('Terminar ahora'), 'media-playback-stop-symbolic');
        this._itemTerminar.connect('activate', () => this.terminar({avisar: false}));
        this.menu.addMenuItem(this._itemTerminar);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Qué apaga la concentración. Cambiarlos con una sesión en marcha aplica
        // o deshace esa parte al momento, que es lo que uno espera al tocarlos.
        this._interruptores = [
            this._interruptor('do-not-disturb', _('No molestar')),
            this._interruptor('pause-music', _('Pausar la música')),
            this._interruptor('hide-dock', _('Esconder la dock')),
        ];

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const prefs = new PopupMenu.PopupImageMenuItem(
            _('Preferencias'), 'preferences-system-symbolic');
        prefs.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefs);
    }

    /**
     * Añade al menú uno de los interruptores.
     *
     * @param {string} clave ajuste que gobierna
     * @param {string} texto etiqueta
     * @returns {PopupMenu.PopupSwitchMenuItem} elemento añadido
     */
    _interruptor(clave, texto) {
        const item = new PopupMenu.PopupSwitchMenuItem(
            texto, this._settings.get_boolean(clave));

        item.connect('toggled', (_item, activo) => {
            this._settings.set_boolean(clave, activo);
            if (this.activa)
                this._aplicarPieza(clave, activo);
        });
        this._idsSettings.push(this._settings.connect(`changed::${clave}`, () =>
            item.setToggleState(this._settings.get_boolean(clave))));

        this.menu.addMenuItem(item);
        return item;
    }

    /* ---------------------------- Sesión ------------------------------- */

    /** @returns {boolean} si hay una sesión de concentración en marcha */
    get activa() {
        return this._sesion !== null;
    }

    /**
     * Segundos que quedan, o null si la sesión no tiene límite.
     *
     * @returns {number|null} tiempo restante
     */
    get restante() {
        if (!this.activa || this._sesion.fin === 0)
            return null;
        return Math.max(0, (this._sesion.fin - Date.now()) / 1000);
    }

    /**
     * Empieza una sesión.
     *
     * @param {number} minutos duración, o 0 para no ponerle límite
     */
    empezar(minutos) {
        if (this.activa)
            this.terminar({avisar: false});

        this._sesion = {
            fin: minutos > 0 ? Date.now() + minutos * 60000 : 0,
            minutos,
            // Lo de antes se apunta pieza a pieza al aplicarlas.
            avisos: null,
            dock: null,
            reproductores: [],
        };

        for (const clave of ['do-not-disturb', 'pause-music', 'hide-dock']) {
            if (this._settings.get_boolean(clave))
                this._aplicarPieza(clave, true);
        }

        this._guardarSesion();
        this._arrancarReloj();
        this._pintar();
    }

    /**
     * Termina la sesión y devuelve el escritorio a como estaba.
     *
     * @param {object} opciones qué hacer al terminar
     * @param {boolean} opciones.avisar si se manda la notificación
     */
    terminar({avisar}) {
        if (!this.activa)
            return;

        const minutos = this._sesion.minutos;

        for (const clave of ['do-not-disturb', 'pause-music', 'hide-dock'])
            this._aplicarPieza(clave, false);

        this._sesion = null;
        this._settings.set_string('saved-state', '');
        this._pararReloj();
        this._pintar();

        if (avisar && this._settings.get_boolean('notify-when-done')) {
            Main.notify(_('Concentración'),
                minutos > 0
                    ? `${_('Se acabaron los')} ${minutos} ${_('minutos')}`
                    : _('Sesión terminada'));
        }
    }

    /**
     * Aplica o deshace una de las piezas de la concentración.
     *
     * @param {string} clave ajuste que la nombra
     * @param {boolean} activar true para aplicarla, false para deshacerla
     */
    _aplicarPieza(clave, activar) {
        switch (clave) {
        case 'do-not-disturb':
            this._piezaAvisos(activar);
            break;
        case 'pause-music':
            this._piezaMusica(activar);
            break;
        case 'hide-dock':
            this._piezaDock(activar);
            break;
        }
        this._guardarSesion();
    }

    /**
     * No molestar.
     *
     * @param {boolean} activar true para silenciar, false para devolverlo
     */
    _piezaAvisos(activar) {
        if (activar) {
            if (this._sesion.avisos !== null)
                return;
            this._sesion.avisos = this._avisos.get_boolean(CLAVE_AVISOS);
            this._avisos.set_boolean(CLAVE_AVISOS, false);
            return;
        }

        if (this._sesion.avisos === null)
            return;
        // Si lo has vuelto a encender tú durante la sesión, manda lo tuyo.
        if (this._avisos.get_boolean(CLAVE_AVISOS) === false)
            this._avisos.set_boolean(CLAVE_AVISOS, this._sesion.avisos);
        this._sesion.avisos = null;
    }

    /**
     * La música.
     *
     * @param {boolean} activar true para pausar, false para devolverla
     */
    _piezaMusica(activar) {
        if (activar) {
            pausarReproductores(this._cancellable)
                .then(nombres => {
                    if (this._destruido || !this.activa)
                        return;
                    this._sesion.reproductores = nombres;
                    this._guardarSesion();
                })
                .catch(e => console.error(`[concentracion] Al pausar: ${e.message}`));
            return;
        }

        const nombres = this._sesion.reproductores;
        this._sesion.reproductores = [];
        if (nombres.length === 0 || !this._settings.get_boolean('resume-music'))
            return;

        reanudarReproductores(nombres, this._cancellable)
            .catch(e => console.error(`[concentracion] Al reanudar: ${e.message}`));
    }

    /**
     * La dock.
     *
     * @param {boolean} activar true para esconderla, false para devolverla
     */
    _piezaDock(activar) {
        if (this._dock === null)
            return;

        if (activar) {
            if (this._sesion.dock !== null)
                return;
            this._sesion.dock = this._dock.get_boolean(CLAVE_DOCK);
            this._dock.set_boolean(CLAVE_DOCK, true);
            return;
        }

        if (this._sesion.dock === null)
            return;
        if (this._dock.get_boolean(CLAVE_DOCK) === true)
            this._dock.set_boolean(CLAVE_DOCK, this._sesion.dock);
        this._sesion.dock = null;
    }

    /* ------------------- Sobrevivir a un reinicio ---------------------- */

    /**
     * Deja constancia de la sesión en los ajustes.
     */
    _guardarSesion() {
        this._settings.set_string('saved-state',
            this._sesion === null ? '' : JSON.stringify(this._sesion));
    }

    /**
     * Retoma —o deshace— la sesión que hubiera al arrancar.
     *
     * Si el shell se reinició en mitad de una sesión, lo que se cambió sigue
     * cambiado: o se sigue contando hasta el final, o se devuelve todo.
     */
    _recuperarSesion() {
        const guardado = this._settings.get_string('saved-state');
        if (guardado === '')
            return;

        let sesion;
        try {
            sesion = JSON.parse(guardado);
        } catch {
            // Un valor a mano que no se entiende: se tira y se sigue.
            this._settings.set_string('saved-state', '');
            return;
        }

        this._sesion = {
            fin: sesion.fin ?? 0,
            minutos: sesion.minutos ?? 0,
            avisos: sesion.avisos ?? null,
            dock: sesion.dock ?? null,
            // La música no se retoma sola tras un reinicio: los reproductores
            // que había ya no existen, y sus nombres de bus tampoco.
            reproductores: [],
        };

        if (this._sesion.fin !== 0 && this._sesion.fin <= Date.now()) {
            // El plazo se cumplió con el shell apagado: se deshace y ya está.
            this.terminar({avisar: false});
            return;
        }

        this._arrancarReloj();
    }

    /* ---------------------------- Pintado ------------------------------ */

    /**
     * Pone al día la barra y el menú.
     */
    _pintar() {
        if (this._destruido)
            return;

        const restante = this.restante;

        if (this.activa)
            this.add_style_class_name('concentracion-activa');
        else
            this.remove_style_class_name('concentracion-activa');

        const texto = this.activa && restante !== null &&
            this._settings.get_boolean('show-countdown')
            ? formatearRestante(restante)
            : '';
        this._etiqueta.text = texto;
        this._etiqueta.visible = texto !== '';

        if (!this.activa)
            this._itemEstado.label.text = _('Sin concentración');
        else if (restante === null)
            this._itemEstado.label.text = _('Concentrado, sin límite');
        else
            this._itemEstado.label.text = `${_('Concentrado')} · ${formatearRestante(restante)}`;

        this._itemDuraciones.visible = !this.activa;
        this._itemTerminar.visible = this.activa;

        this.accessible_name = this._itemEstado.label.text;
    }

    /* --------------------------- Cuenta atrás -------------------------- */

    /**
     * Arranca la cuenta atrás de la sesión.
     */
    _arrancarReloj() {
        this._pararReloj();

        const restante = this.restante;
        if (restante === null)
            return;

        // Con la cuenta a la vista hace falta un latido por segundo; sin ella,
        // basta con despertarse una vez, al final.
        if (this._settings.get_boolean('show-countdown')) {
            this._idReloj = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                if (this.restante <= 0) {
                    this._idReloj = 0;
                    this.terminar({avisar: true});
                    return GLib.SOURCE_REMOVE;
                }
                this._pintar();
                return GLib.SOURCE_CONTINUE;
            });
        } else {
            this._idReloj = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT, Math.max(1, Math.ceil(restante)), () => {
                    this._idReloj = 0;
                    this.terminar({avisar: true});
                    return GLib.SOURCE_REMOVE;
                });
        }
    }

    /**
     * Para la cuenta atrás.
     */
    _pararReloj() {
        if (this._idReloj !== 0) {
            GLib.source_remove(this._idReloj);
            this._idReloj = 0;
        }
    }

    /* ------------------------- Ratón en el panel ----------------------- */

    /**
     * El botón central empieza o termina una sesión sin abrir el menú.
     *
     * @param {Clutter.Event} evento evento recibido
     * @returns {boolean} si el evento se da por atendido
     */
    vfunc_event(evento) {
        if (evento.type() === Clutter.EventType.BUTTON_PRESS &&
            evento.get_button() === Clutter.BUTTON_MIDDLE) {
            if (this.activa)
                this.terminar({avisar: false});
            else
                this.empezar(this._settings.get_int('default-minutes'));
            return Clutter.EVENT_STOP;
        }

        return super.vfunc_event(evento);
    }

    /* ---------------------------- Limpieza ----------------------------- */

    /**
     * Libera todo. Se llama desde disable().
     *
     * La sesión no se termina aquí a propósito: desactivar la extensión o
     * cerrar sesión no es «he acabado de concentrarme», y lo guardado en los
     * ajustes deja deshacerlo al volver.
     */
    destroy() {
        this._destruido = true;
        this._cancellable.cancel();
        this._pararReloj();

        for (const id of this._idsSettings)
            this._settings.disconnect(id);
        this._idsSettings = [];

        this._sesion = null;
        this._dock = null;
        this._avisos = null;
        this._settings = null;
        this._extension = null;

        super.destroy();
    }
});

/* -------------------------------------------------------------------------
 * Punto de entrada de la extensión (API moderna de GNOME 45+)
 * ------------------------------------------------------------------------- */
export default class ConcentracionExtension extends Extension {
    /**
     * Crea el indicador y lo pone en la barra, donde digan los ajustes.
     */
    enable() {
        this._sitio = new SitioEnLaBarra({
            extension: this,
            crear: () => new IndicadorConcentracion(this),
        });
    }

    /**
     * Destruye el indicador y, con él, todos sus recursos.
     */
    disable() {
        this._sitio?.destruir();
        this._sitio = null;
    }
}

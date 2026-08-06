/*
 * extension.js — Wake on LAN para GNOME Shell 48 (ESM).
 *
 * Indicador en la barra superior con los equipos que puedes encender a
 * distancia. Al pulsar uno se manda el paquete mágico por UDP.
 *
 * El paquete no tiene respuesta: que salga no dice nada de si el equipo
 * arrancó. Por eso los equipos con una «sonda» configurada —una dirección
 * TCP suya— se sondean al abrir el menú, para pintar el punto verde o rojo, y
 * se siguen sondeando después de mandarles el paquete hasta que responden.
 *
 * Todo lo que se crea aquí (indicador, cancelables y señales) se destruye en
 * disable(), como exige GNOME.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {despertar, leerEquipos, formatearMac, parsearSonda, CacheMacs} from './wol.js';
import {ComprobadorPuertos, ESTADO, esperarArranque} from './checker.js';
import {SitioEnLaBarra} from './barra.js';

// Segundos entre sondeo y sondeo mientras se espera a que un equipo arranque.
// Un ordenador tarda como poco unas decenas de segundos en levantar la red:
// preguntar más a menudo no lo adelanta.
const INTERVALO_ARRANQUE_S = 5;

/* -------------------------------------------------------------------------
 * Elemento de menú de un equipo: punto de estado + nombre + MAC
 * ------------------------------------------------------------------------- */
const ItemEquipo = GObject.registerClass(
class ItemEquipo extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {object} equipo equipo a representar
     * @param {object} opciones qué partes de la fila se pintan
     * @param {boolean} opciones.mostrarMac si se muestra la dirección física
     * @param {boolean} opciones.comprobable si el equipo tiene sonda y se comprueba
     */
    _init(equipo, {mostrarMac, comprobable, mac}) {
        super._init();

        this.equipo = equipo;

        // Con sonda, un punto de estado como el de los demás menús; sin ella no
        // hay nada que saber del equipo, así que se deja el icono de siempre.
        if (comprobable) {
            this._punto = new St.Widget({
                style_class: 'wol-punto wol-punto-desconocido',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._punto);
        } else {
            this.add_child(new St.Icon({
                icon_name: 'system-run-symbolic',
                style_class: 'popup-menu-icon',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }

        this._etiqueta = new St.Label({
            text: equipo.nombre,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._etiqueta);
        // Necesario para que el lector de pantalla anuncie el elemento.
        this.label_actor = this._etiqueta;

        if (mostrarMac) {
            // Puede venir de los ajustes o haberse aprendido de la tabla ARP:
            // desde aquí es lo mismo, la que se va a usar.
            this.add_child(new St.Label({
                text: formatearMac(mac) ?? _('sin MAC'),
                style_class: 'wol-mac',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
    }

    /**
     * Cambia el color del punto según el estado del equipo.
     *
     * @param {string} estado valor de ESTADO
     */
    fijarEstado(estado) {
        const clases = {
            [ESTADO.ARRIBA]: 'wol-punto wol-punto-arriba',
            [ESTADO.ABAJO]: 'wol-punto wol-punto-abajo',
            [ESTADO.COMPROBANDO]: 'wol-punto wol-punto-comprobando',
            [ESTADO.DESCONOCIDO]: 'wol-punto wol-punto-desconocido',
        };
        const textos = {
            [ESTADO.ARRIBA]: _('encendido'),
            [ESTADO.ABAJO]: _('sin respuesta'),
            [ESTADO.COMPROBANDO]: _('comprobando…'),
            [ESTADO.DESCONOCIDO]: _('estado desconocido'),
        };

        if (this._punto)
            this._punto.style_class = clases[estado] ?? clases[ESTADO.DESCONOCIDO];

        this.accessible_name = this._punto
            ? `${this.equipo.nombre} — ${textos[estado] ?? ''}`
            : this.equipo.nombre;
    }
});

/* -------------------------------------------------------------------------
 * Indicador del panel
 * ------------------------------------------------------------------------- */
const IndicadorWol = GObject.registerClass(
class IndicadorWol extends PanelMenu.Button {
    /**
     * @param {Extension} extension instancia de la extensión (settings, openPreferences)
     */
    _init(extension) {
        super._init(0.5, 'Wake on LAN');

        this._extension = extension;
        this._settings = extension.getSettings();
        this._idsSettings = [];
        this._equipos = [];
        this._items = new Map();     // id de equipo -> ItemEquipo
        this._esperando = new Set(); // ids con un arranque en curso
        this._cancellable = new Gio.Cancellable();
        this._destruido = false;

        this._icono = new St.Icon({
            icon_name: this._settings.get_string('panel-icon'),
            style_class: 'system-status-icon',
        });
        this.add_child(this._icono);

        this._macs = new CacheMacs(this._settings, 'wol-menu');

        this._comprobador = new ComprobadorPuertos({
            timeout: this._settings.get_int('check-timeout'),
            alCambiar: (id, estado) => {
                this._items.get(id)?.fijarEstado(estado);
                // Un equipo que acaba de responder tiene su MAC recién puesta
                // en la tabla ARP: es el momento de apuntarla.
                if (estado === ESTADO.ARRIBA)
                    this._macs.programar(() => this._ipsQueResponden());
            },
        });

        // El estado se consulta al abrir el menú y se abandona al cerrarlo: con
        // el menú cerrado no se toca la red.
        this._idAbrir = this.menu.connect('open-state-changed', (_menu, abierto) => {
            if (abierto)
                this._comprobarTodos();
            else
                this._comprobador.cancelarPendientes();
        });

        this._conectarSettings();
        this._reconstruirMenu();
    }

    /**
     * Reacciona a los cambios de configuración sin recargar el shell.
     */
    _conectarSettings() {
        const conectar = (clave, cb) =>
            this._idsSettings.push(this._settings.connect(`changed::${clave}`, cb));

        conectar('equipos', () => this._reconstruirMenu());
        conectar('show-mac', () => this._reconstruirMenu());
        conectar('enable-checks', () => {
            this._reconstruirMenu();
            if (this.menu.isOpen)
                this._comprobarTodos();
        });
        conectar('check-timeout', () =>
            (this._comprobador.timeout = this._settings.get_int('check-timeout')));
        conectar('panel-icon', () =>
            (this._icono.icon_name = this._settings.get_string('panel-icon')));
    }

    /* --------------------------- Sondeo ----------------------------- */

    /**
     * Destino con el que se comprueba si un equipo está encendido.
     *
     * @param {object} equipo equipo del menú
     * @returns {{id: string, host: string, port: number}|null} conexión a sondear
     */
    _sondaDe(equipo) {
        if (!this._settings.get_boolean('enable-checks'))
            return null;

        const sonda = parsearSonda(equipo.sonda);
        return sonda ? {id: equipo.id, ...sonda} : null;
    }

    /**
     * Equipos que se pueden comprobar ahora mismo.
     *
     * @returns {object[]} conexiones para el comprobador
     */
    _sondeables() {
        return this._equipos.map(e => this._sondaDe(e)).filter(s => s !== null);
    }

    /**
     * Comprueba de una vez todos los equipos que tienen sonda.
     */
    _comprobarTodos() {
        this._comprobador.comprobarTodas(this._sondeables());
    }

    /**
     * Direcciones de los equipos que están respondiendo ahora mismo, que son
     * los únicos de los que se puede aprender la MAC.
     *
     * @returns {string[]} direcciones sondeadas con éxito
     */
    _ipsQueResponden() {
        return this._sondeables()
            .filter(s => this._comprobador.estadoDe(s.id) === ESTADO.ARRIBA)
            .map(s => s.host);
    }

    /**
     * MAC con la que se enciende un equipo: la que hayas escrito, y si no, la
     * que se haya aprendido de la tabla ARP mientras respondía.
     *
     * @param {object} equipo equipo del menú
     * @returns {string} MAC, o cadena vacía si todavía no se sabe ninguna
     */
    _macDe(equipo) {
        if (equipo.mac)
            return equipo.mac;

        const sonda = parsearSonda(equipo.sonda);
        return sonda ? this._macs.macDe(sonda.host) : '';
    }

    /* ----------------------------- Menú ----------------------------- */

    /**
     * Rehace el menú a partir de la lista de equipos guardada.
     */
    _reconstruirMenu() {
        this.menu.removeAll();
        this._items.clear();

        // El identificador tiene que sobrevivir a esta reconstrucción: es lo
        // que ata el estado ya conocido con su fila. Sale de lo que define al
        // equipo, no de su posición en la lista.
        this._equipos = leerEquipos(this._settings).map(e => ({
            ...e,
            id: JSON.stringify([e.nombre, e.mac, e.sonda]),
        }));

        const mostrarMac = this._settings.get_boolean('show-mac');

        if (this._equipos.length === 0) {
            const aviso = new PopupMenu.PopupMenuItem(
                _('No hay equipos configurados'),
                {reactive: false, style_class: 'wol-aviso'});
            this.menu.addMenuItem(aviso);
        }

        for (const equipo of this._equipos) {
            const comprobable = this._sondaDe(equipo) !== null;
            const item = new ItemEquipo(equipo, {
                mostrarMac,
                comprobable,
                mac: this._macDe(equipo),
            });

            if (comprobable) {
                item.fijarEstado(this._esperando.has(equipo.id)
                    ? ESTADO.COMPROBANDO
                    : this._comprobador.estadoDe(equipo.id));
            }

            item.connect('activate', () => this._despertar(equipo));
            this.menu.addMenuItem(item);
            this._items.set(equipo.id, item);
        }

        // Se olvidan los estados de equipos que ya no existen.
        this._comprobador.podar(new Set(this._equipos.map(e => e.id)));

        // Con varios equipos, encenderlos todos de una es lo normal al llegar.
        if (this._equipos.length > 1) {
            const todos = new PopupMenu.PopupImageMenuItem(
                _('Encender todos'), 'media-playlist-repeat-symbolic');
            todos.connect('activate', () => this._despertarTodos());
            this.menu.addMenuItem(todos);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const prefs = new PopupMenu.PopupImageMenuItem(
            _('Preferencias'), 'preferences-system-symbolic');
        prefs.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefs);

        if (this.menu.isOpen)
            this._comprobarTodos();
    }

    /* --------------------------- Encendido --------------------------- */

    /**
     * Manda el paquete mágico a un equipo y avisa del resultado.
     *
     * @param {object} equipo equipo a despertar
     */
    _despertar(equipo) {
        const mac = this._macDe(equipo);
        if (!mac) {
            // Pasa con un equipo importado que todavía no se ha visto encendido.
            Main.notifyError('Wake on LAN',
                `${_('Todavía no se sabe la MAC de')} «${equipo.nombre}». ${_('Se aprende sola la próxima vez que responda; o escríbela en las preferencias.')}`);
            return;
        }

        despertar({...equipo, mac}, this._cancellable)
            .then(error => {
                if (this._destruido)
                    return;

                if (error) {
                    Main.notifyError('Wake on LAN',
                        `${_('No se pudo despertar')} «${equipo.nombre}»: ${error}`);
                    return;
                }

                const sonda = this._sondaDe(equipo);
                const limite = this._settings.get_int('boot-timeout');

                // Sin sonda, lo único que se puede afirmar es que el paquete
                // salió: el protocolo no tiene respuesta. Si ya se está
                // esperando a este equipo, tampoco hay nada nuevo que contar.
                if (!sonda || limite <= 0 || this._esperando.has(equipo.id)) {
                    Main.notify('Wake on LAN',
                        `${_('Paquete enviado a')} «${equipo.nombre}»`);
                    return;
                }

                Main.notify('Wake on LAN',
                    `${_('Paquete enviado a')} «${equipo.nombre}». ${_('Esperando a que arranque…')}`);

                this._esperarArranque(equipo, sonda, limite)
                    .then(segundos => {
                        if (this._destruido)
                            return;
                        if (segundos === null) {
                            Main.notifyError('Wake on LAN',
                                `«${equipo.nombre}» ${_('sigue sin responder tras')} ${limite} s`);
                        } else {
                            Main.notify('Wake on LAN',
                                `«${equipo.nombre}» ${_('ya responde')} (${segundos} s)`);
                        }
                    });
            })
            .catch(e => {
                if (!this._destruido)
                    console.error(`[wol-menu] Fallo al despertar: ${e.message}`);
            });
    }

    /**
     * Sondea un equipo hasta que responde, dejando su punto en amarillo
     * mientras tanto.
     *
     * @param {object} equipo equipo que se está encendiendo
     * @param {object} sonda destino del sondeo
     * @param {number} limite segundos que se espera como mucho
     * @returns {Promise<number|null>} segundos que tardó, o null si no arrancó
     */
    async _esperarArranque(equipo, sonda, limite) {
        this._esperando.add(equipo.id);
        this._items.get(equipo.id)?.fijarEstado(ESTADO.COMPROBANDO);

        try {
            return await esperarArranque(
                sonda,
                {
                    timeout: this._settings.get_int('check-timeout'),
                    intervalo: INTERVALO_ARRANQUE_S,
                    limite,
                },
                this._cancellable);
        } finally {
            this._esperando.delete(equipo.id);
            // El estado real lo vuelve a fijar el comprobador, que es quien lo
            // guarda para cuando se reconstruya el menú.
            if (!this._destruido)
                this._comprobador.comprobar(sonda);
        }
    }

    /**
     * Manda el paquete a todos los equipos y resume el resultado.
     */
    _despertarTodos() {
        // Los que todavía no tienen MAC no se pueden despertar, pero tampoco
        // deben hacer fracasar al resto: se cuentan aparte.
        const total = this._equipos.length;
        const despertables = this._equipos
            .map(e => ({equipo: e, mac: this._macDe(e)}))
            .filter(({mac}) => mac !== '');
        const equipos = despertables.map(({equipo}) => equipo);
        const sinMac = total - equipos.length;

        if (equipos.length === 0) {
            Main.notifyError('Wake on LAN',
                _('Ningún equipo tiene MAC conocida todavía'));
            return;
        }

        Promise.all(despertables.map(
            ({equipo, mac}) => despertar({...equipo, mac}, this._cancellable)))
            .then(errores => {
                if (this._destruido)
                    return;

                const fallidos = errores.filter(e => e !== null).length + sinMac;
                if (fallidos > 0) {
                    Main.notifyError('Wake on LAN',
                        `${fallidos} ${_('de')} ${total} ${_('fallaron')}`);
                    return;
                }

                const limite = this._settings.get_int('boot-timeout');
                const esperables = equipos
                    .map(e => ({equipo: e, sonda: this._sondaDe(e)}))
                    .filter(({equipo, sonda}) =>
                        sonda !== null && !this._esperando.has(equipo.id));

                if (limite <= 0 || esperables.length === 0) {
                    Main.notify('Wake on LAN',
                        `${_('Paquete enviado a')} ${equipos.length} ${_('equipos')}`);
                    return;
                }

                Main.notify('Wake on LAN',
                    `${_('Paquete enviado a')} ${equipos.length} ${_('equipos')}. ${_('Esperando a que arranquen…')}`);

                Promise.all(esperables.map(({equipo, sonda}) =>
                    this._esperarArranque(equipo, sonda, limite)))
                    .then(resultados => {
                        if (this._destruido)
                            return;
                        const arrancados = resultados.filter(r => r !== null).length;
                        const texto = `${arrancados} ${_('de')} ${esperables.length} ${_('responden')}`;
                        if (arrancados === esperables.length)
                            Main.notify('Wake on LAN', texto);
                        else
                            Main.notifyError('Wake on LAN', texto);
                    });
            })
            .catch(e => {
                if (!this._destruido)
                    console.error(`[wol-menu] Fallo al despertar: ${e.message}`);
            });
    }

    /* --------------------------- Limpieza ---------------------------- */

    /**
     * Libera todo. Se llama desde disable().
     */
    destroy() {
        this._destruido = true;

        // Corta también las esperas de arranque en curso, que pueden llevar
        // minutos por delante.
        this._cancellable.cancel();

        this._comprobador.destruir();
        this._comprobador = null;
        this._macs.destruir();
        this._macs = null;

        if (this._idAbrir) {
            this.menu.disconnect(this._idAbrir);
            this._idAbrir = 0;
        }

        for (const id of this._idsSettings)
            this._settings.disconnect(id);
        this._idsSettings = [];

        this._items.clear();
        this._esperando.clear();
        this._equipos = [];
        this._settings = null;
        this._extension = null;

        super.destroy();
    }
});

/* -------------------------------------------------------------------------
 * Punto de entrada de la extensión (API moderna de GNOME 45+)
 * ------------------------------------------------------------------------- */
export default class WolMenuExtension extends Extension {
    /**
     * Crea el indicador y lo pone en la barra, donde digan los ajustes.
     */
    enable() {
        this._sitio = new SitioEnLaBarra({
            extension: this,
            crear: () => new IndicadorWol(this),
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

/*
 * extension.js — Wake on LAN para GNOME Shell 48 (ESM).
 *
 * Indicador en la barra superior con los equipos que puedes encender a
 * distancia. Al pulsar uno se manda el paquete mágico por UDP.
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

import {despertar, leerEquipos, formatearMac} from './wol.js';

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
        this._cancellable = new Gio.Cancellable();
        this._destruido = false;

        this._icono = new St.Icon({
            icon_name: this._settings.get_string('panel-icon'),
            style_class: 'system-status-icon',
        });
        this.add_child(this._icono);

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
        conectar('panel-icon', () =>
            (this._icono.icon_name = this._settings.get_string('panel-icon')));
    }

    /* ----------------------------- Menú ----------------------------- */

    /**
     * Rehace el menú a partir de la lista de equipos guardada.
     */
    _reconstruirMenu() {
        this.menu.removeAll();

        const equipos = leerEquipos(this._settings);
        const mostrarMac = this._settings.get_boolean('show-mac');

        if (equipos.length === 0) {
            const aviso = new PopupMenu.PopupMenuItem(
                _('No hay equipos configurados'),
                {reactive: false, style_class: 'wol-aviso'});
            this.menu.addMenuItem(aviso);
        }

        for (const equipo of equipos) {
            const item = new PopupMenu.PopupImageMenuItem(
                equipo.nombre, 'system-run-symbolic');

            if (mostrarMac) {
                const mac = new St.Label({
                    text: formatearMac(equipo.mac) ?? equipo.mac,
                    style_class: 'wol-mac',
                    x_expand: true,
                    x_align: Clutter.ActorAlign.END,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                item.add_child(mac);
            }

            item.connect('activate', () => this._despertar(equipo));
            this.menu.addMenuItem(item);
        }

        // Con varios equipos, encenderlos todos de una es lo normal al llegar.
        if (equipos.length > 1) {
            const todos = new PopupMenu.PopupImageMenuItem(
                _('Encender todos'), 'media-playlist-repeat-symbolic');
            todos.connect('activate', () => this._despertarTodos(equipos));
            this.menu.addMenuItem(todos);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const prefs = new PopupMenu.PopupImageMenuItem(
            _('Preferencias'), 'preferences-system-symbolic');
        prefs.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefs);
    }

    /* --------------------------- Encendido --------------------------- */

    /**
     * Manda el paquete mágico a un equipo y avisa del resultado.
     *
     * @param {object} equipo equipo a despertar
     */
    _despertar(equipo) {
        despertar(equipo, this._cancellable)
            .then(error => {
                if (this._destruido)
                    return;
                if (error) {
                    Main.notifyError('Wake on LAN',
                        `${_('No se pudo despertar')} «${equipo.nombre}»: ${error}`);
                } else {
                    // El paquete es unidireccional: que salga no garantiza que
                    // el equipo arranque, así que se dice exactamente eso.
                    Main.notify('Wake on LAN',
                        `${_('Paquete enviado a')} «${equipo.nombre}»`);
                }
            })
            .catch(e => {
                if (!this._destruido)
                    console.error(`[wol-menu] Fallo al despertar: ${e.message}`);
            });
    }

    /**
     * Manda el paquete a todos los equipos y resume el resultado.
     *
     * @param {object[]} equipos equipos a despertar
     */
    _despertarTodos(equipos) {
        Promise.all(equipos.map(e => despertar(e, this._cancellable)))
            .then(errores => {
                if (this._destruido)
                    return;

                const fallidos = errores.filter(e => e !== null).length;
                if (fallidos === 0) {
                    Main.notify('Wake on LAN',
                        `${_('Paquete enviado a')} ${equipos.length} ${_('equipos')}`);
                } else {
                    Main.notifyError('Wake on LAN',
                        `${fallidos} ${_('de')} ${equipos.length} ${_('fallaron')}`);
                }
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

        this._cancellable.cancel();

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
export default class WolMenuExtension extends Extension {
    /**
     * Crea el indicador y lo añade al panel.
     */
    enable() {
        this._indicador = new IndicadorWol(this);
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

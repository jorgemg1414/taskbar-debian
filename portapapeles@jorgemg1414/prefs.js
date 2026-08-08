/*
 * prefs.js — Ventana de preferencias (GNOME 45+ / libadwaita).
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {anadirFilasDeSitio} from './barraprefs.js';

export default class PortapapelesPreferences extends ExtensionPreferences {
    /**
     * Construye la interfaz de preferencias.
     *
     * @param {Adw.PreferencesWindow} window ventana proporcionada por el shell
     */
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const pagina = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(pagina);

        /* ---------------------------- El menú --------------------------- */
        const grupoMenu = new Adw.PreferencesGroup({
            title: _('Lo que sale en el menú'),
            description: _('El historial es el de CopyQ, no uno aparte: lo que se ve aquí ' +
                'es lo mismo que en su ventana, y sigue estando aunque desactives la ' +
                'extensión.'),
        });
        pagina.add(grupoMenu);

        const filaCuantos = new Adw.SpinRow({
            title: _('Elementos en el menú'),
            subtitle: _('CopyQ guarda muchos más. Cuantos más se pidan, más tarda el menú ' +
                'en abrirse.'),
            adjustment: new Gtk.Adjustment({
                lower: 5, upper: 200, step_increment: 1, page_increment: 10,
            }),
        });
        settings.bind('max-items', filaCuantos, 'value', Gio.SettingsBindFlags.DEFAULT);
        grupoMenu.add(filaCuantos);

        const filaPegar = new Adw.SwitchRow({
            title: _('Pegar al elegir'),
            subtitle: _('Manda un Ctrl+V a la ventana que tuvieras delante. Depende de que ' +
                'el foco haya vuelto a ella, así que no se porta igual en todas partes. ' +
                'Sin esto, el elemento se queda en el portapapeles y lo pegas tú.'),
        });
        settings.bind('paste-on-select', filaPegar, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoMenu.add(filaPegar);

        /* --------------------------- Buscador --------------------------- */
        const grupoBuscador = new Adw.PreferencesGroup({title: _('Buscador')});
        pagina.add(grupoBuscador);

        const filaBuscador = new Adw.SwitchRow({
            title: _('Buscador en el menú'),
            subtitle: _('Busca en el texto entero del elemento, no solo en la línea que se ve.'),
        });
        settings.bind('enable-search', filaBuscador, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoBuscador.add(filaBuscador);

        const filaUmbral = new Adw.SpinRow({
            title: _('Mostrarlo a partir de'),
            subtitle: _('Elementos necesarios para que aparezca el buscador.'),
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 200, step_increment: 1, page_increment: 5,
            }),
        });
        settings.bind('search-threshold', filaUmbral, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-search', filaUmbral, 'sensitive', Gio.SettingsBindFlags.GET);
        grupoBuscador.add(filaUmbral);

        /* -------------------------- Apariencia -------------------------- */
        const grupoAspecto = new Adw.PreferencesGroup({title: _('Apariencia')});
        pagina.add(grupoAspecto);

        const filaIcono = new Adw.EntryRow({title: _('Icono del panel')});
        settings.bind('panel-icon', filaIcono, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoAspecto.add(filaIcono);

        /* ------------------------ Sitio en la barra --------------------- */
        const grupoSitio = new Adw.PreferencesGroup({
            title: _('Barra superior'),
            description: _('GNOME no deja reordenar la barra: el sitio lo pide cada ' +
                'extensión al ponerse. Aquí se elige el de esta.'),
        });
        pagina.add(grupoSitio);
        anadirFilasDeSitio(grupoSitio, settings, _);
    }
}

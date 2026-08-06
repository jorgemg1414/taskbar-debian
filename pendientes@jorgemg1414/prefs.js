/*
 * prefs.js — Ventana de preferencias (GNOME 45+ / libadwaita).
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {anadirFilasDeSitio} from './barraprefs.js';

export default class PendientesPreferences extends ExtensionPreferences {
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

        /* --------------------------- Archivo ---------------------------- */
        const grupoArchivo = new Adw.PreferencesGroup({
            title: _('De dónde salen las tareas'),
            description: _('Las líneas con casilla —«- [ ] algo»— de tus archivos Markdown, ' +
                'agrupadas por el encabezado que tengan encima. Si pones una carpeta, se leen ' +
                'todos sus .md, .markdown y .txt, sin entrar en subcarpetas.'),
        });
        pagina.add(grupoArchivo);

        const filaRuta = new Adw.EntryRow({title: _('Archivo o carpeta')});
        settings.bind('ruta', filaRuta, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoArchivo.add(filaRuta);

        const filaHechas = new Adw.SwitchRow({
            title: _('Mostrar también las hechas'),
            subtitle: _('Salen tachadas al final de su grupo. Sin esto, el menú es solo ' +
                'para lo que queda.'),
        });
        settings.bind('mostrar-hechas', filaHechas, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoArchivo.add(filaHechas);

        const filaEditor = new Adw.EntryRow({title: _('Comando para abrir el archivo')});
        filaEditor.set_tooltip_text(
            _('Se sustituye %f por la ruta. Vacío prueba gnome-text-editor, gedit, kate y xdg-open.'));
        settings.bind('editor-command', filaEditor, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoArchivo.add(filaEditor);

        /* -------------------------- Apariencia -------------------------- */
        const grupoAspecto = new Adw.PreferencesGroup({title: _('Apariencia')});
        pagina.add(grupoAspecto);

        const filaBuscador = new Adw.SwitchRow({
            title: _('Buscador en el menú'),
            subtitle: _('Filtra escribiendo parte del texto, del encabezado o del archivo.'),
        });
        settings.bind('enable-search', filaBuscador, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoAspecto.add(filaBuscador);

        const filaUmbral = new Adw.SpinRow({
            title: _('Mostrarlo a partir de'),
            subtitle: _('Tareas necesarias para que aparezca el buscador.'),
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 200, step_increment: 1, page_increment: 5,
            }),
        });
        settings.bind('search-threshold', filaUmbral, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-search', filaUmbral, 'sensitive', Gio.SettingsBindFlags.GET);
        grupoAspecto.add(filaUmbral);

        const filaInsignia = new Adw.SwitchRow({
            title: _('Contador en el panel'),
            subtitle: _('Cuántas tareas quedan, junto al icono.'),
        });
        settings.bind('panel-badge', filaInsignia, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoAspecto.add(filaInsignia);

        const filaIcono = new Adw.EntryRow({title: _('Icono del panel')});
        settings.bind('panel-icon', filaIcono, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoAspecto.add(filaIcono);

        /* ------------------------ Sitio en la barra -------------------- */
        const grupoSitio = new Adw.PreferencesGroup({
            title: _('Barra superior'),
            description: _('GNOME no deja reordenar la barra: el sitio lo pide cada ' +
                'extensión al ponerse. Aquí se elige el de esta.'),
        });
        pagina.add(grupoSitio);
        anadirFilasDeSitio(grupoSitio, settings, _);
    }
}

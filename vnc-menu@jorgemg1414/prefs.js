/*
 * prefs.js — Ventana de preferencias (GNOME 45+ / libadwaita).
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class VncMenuPreferences extends ExtensionPreferences {
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

        /* ------------------------- Conexiones ------------------------- */
        const grupoCarpeta = new Adw.PreferencesGroup({
            title: _('Conexiones'),
            description: _('Carpeta donde están tus archivos .vnc y .remmina.'),
        });
        pagina.add(grupoCarpeta);

        const filaCarpeta = new Adw.EntryRow({title: _('Carpeta')});
        settings.bind('connections-dir', filaCarpeta, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoCarpeta.add(filaCarpeta);

        const filaHost = new Adw.SwitchRow({
            title: _('Mostrar host y puerto'),
            subtitle: _('Añade «host:puerto» a la derecha del nombre.'),
        });
        settings.bind('show-host', filaHost, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoCarpeta.add(filaHost);

        const filaIcono = new Adw.EntryRow({title: _('Icono del panel')});
        settings.bind('panel-icon', filaIcono, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoCarpeta.add(filaIcono);

        const filaInsignia = new Adw.SwitchRow({
            title: _('Contador de caídas en el panel'),
            subtitle: _('Cuántas conexiones no responden, junto al icono. Con el menú ' +
                'cerrado solo se actualiza si activas las comprobaciones en segundo plano.'),
        });
        settings.bind('panel-badge', filaInsignia, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoCarpeta.add(filaInsignia);

        const filaBuscador = new Adw.SwitchRow({
            title: _('Buscador en el menú'),
            subtitle: _('Filtra las conexiones al escribir. Intro conecta con la primera.'),
        });
        settings.bind('enable-search', filaBuscador, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoCarpeta.add(filaBuscador);

        const filaUmbral = new Adw.SpinRow({
            title: _('Mostrarlo a partir de'),
            subtitle: _('Número de conexiones necesarias para que aparezca el buscador.'),
            adjustment: new Gtk.Adjustment({lower: 0, upper: 500, step_increment: 1, page_increment: 10}),
        });
        settings.bind('search-threshold', filaUmbral, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-search', filaUmbral, 'sensitive', Gio.SettingsBindFlags.GET);
        grupoCarpeta.add(filaUmbral);

        /* -------------------------- Comandos -------------------------- */
        const grupoComandos = new Adw.PreferencesGroup({
            title: _('Comandos'),
            description: _('Marcadores: %h host, %p puerto, %u usuario, %n nombre, %f ruta del archivo. ' +
                'Si el programa no está instalado se prueban alternativas (vncviewer, xtigervncviewer).'),
        });
        pagina.add(grupoComandos);

        const filaVnc = new Adw.EntryRow({title: _('Archivos .vnc')});
        settings.bind('vnc-command', filaVnc, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoComandos.add(filaVnc);

        const filaRemmina = new Adw.EntryRow({title: _('Archivos .remmina')});
        settings.bind('remmina-command', filaRemmina, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoComandos.add(filaRemmina);

        const filaGestor = new Adw.EntryRow({title: _('Abrir carpeta')});
        settings.bind('file-manager-command', filaGestor, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoComandos.add(filaGestor);

        /* ---------------------- Disponibilidad ------------------------ */
        const grupoChecks = new Adw.PreferencesGroup({
            title: _('Disponibilidad'),
            description: _('Punto verde o rojo según si el puerto responde. Solo se ' +
                'consulta la red mientras el menú está abierto, salvo que actives ' +
                'las comprobaciones en segundo plano.'),
        });
        pagina.add(grupoChecks);

        const filaActivar = new Adw.SwitchRow({title: _('Comprobar disponibilidad')});
        settings.bind('enable-checks', filaActivar, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoChecks.add(filaActivar);

        const filaIntervalo = new Adw.SpinRow({
            title: _('Refresco con el menú abierto'),
            subtitle: _('Segundos entre comprobaciones mientras miras el menú.'),
            adjustment: new Gtk.Adjustment({lower: 10, upper: 3600, step_increment: 10, page_increment: 60}),
        });
        settings.bind('check-interval', filaIntervalo, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-checks', filaIntervalo, 'sensitive', Gio.SettingsBindFlags.GET);
        grupoChecks.add(filaIntervalo);

        const filaFondo = new Adw.SpinRow({
            title: _('Comprobar en segundo plano'),
            subtitle: _('Segundos entre comprobaciones con el menú cerrado. 0 las desactiva.'),
            adjustment: new Gtk.Adjustment({lower: 0, upper: 86400, step_increment: 60, page_increment: 300}),
        });
        settings.bind('background-check-interval', filaFondo, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-checks', filaFondo, 'sensitive', Gio.SettingsBindFlags.GET);
        grupoChecks.add(filaFondo);

        const filaTimeout = new Adw.SpinRow({
            title: _('Tiempo de espera'),
            subtitle: _('Segundos antes de dar un host por caído.'),
            adjustment: new Gtk.Adjustment({lower: 1, upper: 30, step_increment: 1, page_increment: 5}),
        });
        settings.bind('check-timeout', filaTimeout, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-checks', filaTimeout, 'sensitive', Gio.SettingsBindFlags.GET);
        grupoChecks.add(filaTimeout);
    }
}

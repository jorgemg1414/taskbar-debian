/*
 * prefs.js — Ventana de preferencias (GNOME 45+ / libadwaita).
 *
 * Dos cosas: qué apaga la concentración y cómo se ve el indicador.
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {anadirFilasDeSitio} from './barraprefs.js';

export default class ConcentracionPreferences extends ExtensionPreferences {
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

        /* ------------------------ Qué se apaga ------------------------- */
        const grupoApagar = new Adw.PreferencesGroup({
            title: _('Qué se apaga'),
            description: _('Todo esto se devuelve a como estaba al terminar la sesión. ' +
                'Y solo lo que siga como lo dejó la extensión: si lo cambias tú por el ' +
                'camino, manda lo tuyo.'),
        });
        pagina.add(grupoApagar);

        const filaAvisos = new Adw.SwitchRow({
            title: _('No molestar'),
            subtitle: _('Las notificaciones no se pierden: esperan en el calendario.'),
        });
        settings.bind('do-not-disturb', filaAvisos, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoApagar.add(filaAvisos);

        const filaMusica = new Adw.SwitchRow({
            title: _('Pausar la música'),
            subtitle: _('Cualquier reproductor que hable MPRIS. Lo que ya estaba en ' +
                'pausa no se toca.'),
        });
        settings.bind('pause-music', filaMusica, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoApagar.add(filaMusica);

        const filaReanudar = new Adw.SwitchRow({
            title: _('Devolver la música al terminar'),
            subtitle: _('Solo lo que se pausó al empezar.'),
        });
        settings.bind('resume-music', filaReanudar, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('pause-music', filaReanudar, 'sensitive', Gio.SettingsBindFlags.GET);
        grupoApagar.add(filaReanudar);

        const filaDock = new Adw.SwitchRow({
            title: _('Esconder la dock'),
            subtitle: _('La de Dash to Dock, del todo, para que no asome al llevar el ' +
                'ratón al borde. Sin esa extensión no hace nada.'),
        });
        settings.bind('hide-dock', filaDock, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoApagar.add(filaDock);

        /* -------------------------- Sesiones --------------------------- */
        const grupoSesiones = new Adw.PreferencesGroup({
            title: _('Sesiones'),
            description: _('En el menú hay botones de 25, 50 y 90 minutos, y uno sin ' +
                'límite.'),
        });
        pagina.add(grupoSesiones);

        const filaDuracion = new Adw.SpinRow({
            title: _('Duración del atajo'),
            subtitle: _('Minutos que dura una sesión empezada con el botón central del ' +
                'ratón sobre el indicador.'),
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 480, step_increment: 5, page_increment: 15,
            }),
        });
        settings.bind('default-minutes', filaDuracion, 'value', Gio.SettingsBindFlags.DEFAULT);
        grupoSesiones.add(filaDuracion);

        const filaAvisar = new Adw.SwitchRow({
            title: _('Avisar al terminar'),
            subtitle: _('Terminar a mano no avisa: ya estabas mirando.'),
        });
        settings.bind('notify-when-done', filaAvisar, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoSesiones.add(filaAvisar);

        /* --------------------------- Barra ----------------------------- */
        const grupoBarra = new Adw.PreferencesGroup({title: _('Barra superior')});
        pagina.add(grupoBarra);

        const filaCuenta = new Adw.SwitchRow({
            title: _('Mostrar el tiempo que queda'),
            subtitle: _('Sin esto el indicador solo cambia de color, y no se mira la ' +
                'hora cada segundo.'),
        });
        settings.bind('show-countdown', filaCuenta, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoBarra.add(filaCuenta);

        const filaIcono = new Adw.EntryRow({title: _('Icono del panel')});
        settings.bind('panel-icon', filaIcono, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoBarra.add(filaIcono);

        anadirFilasDeSitio(grupoBarra, settings, _);
    }
}

/*
 * prefs.js — Ventana de preferencias (GNOME 45+ / libadwaita).
 *
 * Son cuatro cosas: a quién se sigue, qué se ve en la barra, qué se ve en el
 * menú y qué hace el ratón por encima del indicador.
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SpotifyMenuPreferences extends ExtensionPreferences {
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

        /* ------------------------ Reproductor -------------------------- */
        const grupoReproductor = new Adw.PreferencesGroup({
            title: _('Reproductor'),
            description: _('Lo que suena se lo cuenta el propio programa al escritorio ' +
                'por D-Bus (MPRIS). No hay ninguna cuenta que enlazar ni ninguna clave ' +
                'que guardar.'),
        });
        pagina.add(grupoReproductor);

        const filaCualquiera = new Adw.SwitchRow({
            title: _('Seguir a cualquier reproductor'),
            subtitle: _('Cuando Spotify no está abierto, enseña lo que reproduzca ' +
                'otro programa: el navegador, un reproductor de vídeo…'),
        });
        settings.bind('any-player', filaCualquiera, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoReproductor.add(filaCualquiera);

        /* --------------------------- Barra ----------------------------- */
        const grupoBarra = new Adw.PreferencesGroup({
            title: _('Barra superior'),
        });
        pagina.add(grupoBarra);

        const filaTexto = new Adw.SwitchRow({
            title: _('Mostrar el texto'),
            subtitle: _('Sin él queda solo el icono, y la canción se lee en el menú.'),
        });
        settings.bind('show-panel-text', filaTexto, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoBarra.add(filaTexto);

        const filaFormato = new Adw.EntryRow({title: _('Formato del texto')});
        filaFormato.set_tooltip_text(
            _('Se sustituyen {titulo}, {artista} y {album} por lo que diga el reproductor.'));
        settings.bind('panel-format', filaFormato, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoBarra.add(filaFormato);

        const filaLargo = new Adw.SpinRow({
            title: _('Longitud máxima'),
            subtitle: _('Caracteres antes de cortar con puntos suspensivos.'),
            adjustment: new Gtk.Adjustment({
                lower: 8, upper: 80, step_increment: 1, page_increment: 5,
            }),
        });
        settings.bind('panel-max-chars', filaLargo, 'value', Gio.SettingsBindFlags.DEFAULT);
        grupoBarra.add(filaLargo);

        const filaControles = new Adw.SwitchRow({
            title: _('Mostrar los controles'),
            subtitle: _('Anterior, reproducir/pausar y siguiente en la barra misma. ' +
                'Pulsarlos no abre el menú.'),
        });
        settings.bind('show-panel-controls', filaControles, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoBarra.add(filaControles);

        const filaOcultar = new Adw.SwitchRow({
            title: _('Ocultar cuando no suena nada'),
            subtitle: _('El indicador vuelve solo en cuanto hay música.'),
        });
        settings.bind('hide-when-stopped', filaOcultar, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoBarra.add(filaOcultar);

        const filaEstado = new Adw.SwitchRow({
            title: _('El icono dice si está sonando'),
            subtitle: _('Alterna entre el icono de reproducir y el de pausa. No se ' +
                'aplica con los controles puestos: el botón ya dice el estado.'),
        });
        settings.bind('icon-shows-state', filaEstado, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoBarra.add(filaEstado);

        const filaIcono = new Adw.EntryRow({title: _('Icono del panel')});
        filaIcono.set_tooltip_text(
            _('Nombre del icono simbólico que se usa cuando no lo sustituye el estado.'));
        settings.bind('panel-icon', filaIcono, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoBarra.add(filaIcono);

        /* ---------------------------- Menú ----------------------------- */
        const grupoMenu = new Adw.PreferencesGroup({title: _('Menú')});
        pagina.add(grupoMenu);

        const filaPortada = new Adw.SwitchRow({
            title: _('Mostrar la portada'),
            subtitle: _('Es lo único que sale a la red: se baja de la dirección que ' +
                'publica el reproductor y se guarda en ~/.cache.'),
        });
        settings.bind('show-art', filaPortada, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoMenu.add(filaPortada);

        const filaProgreso = new Adw.SwitchRow({
            title: _('Mostrar por dónde va'),
            subtitle: _('Barra de progreso con el tiempo transcurrido y el total. ' +
                'Se consulta una vez por segundo, y solo con el menú abierto.'),
        });
        settings.bind('show-position', filaProgreso, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoMenu.add(filaProgreso);

        /* ---------------------------- Ratón ---------------------------- */
        const grupoRaton = new Adw.PreferencesGroup({
            title: _('Ratón'),
            description: _('Atajos sobre el indicador, sin abrir el menú.'),
        });
        pagina.add(grupoRaton);

        const filaCentral = new Adw.SwitchRow({
            title: _('El botón central reproduce o pausa'),
        });
        settings.bind('middle-click-plays', filaCentral, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoRaton.add(filaCentral);

        const filaRueda = new Adw.SwitchRow({
            title: _('La rueda cambia de canción'),
            subtitle: _('Cómodo, pero es fácil rozarlo sin querer al pasar el ratón ' +
                'por la barra.'),
        });
        settings.bind('scroll-changes-track', filaRueda, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoRaton.add(filaRueda);
    }
}

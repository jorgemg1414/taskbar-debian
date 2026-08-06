/*
 * prefs.js — Ventana de preferencias (GNOME 45+ / libadwaita).
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {anadirFilasDeSitio} from './barraprefs.js';

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

        const filaSesiones = new Adw.SwitchRow({
            title: _('Sesiones abiertas'),
            subtitle: _('Lista arriba del menú las ventanas VNC ya abiertas; ' +
                'al pulsar una se trae su ventana al frente.'),
        });
        settings.bind('show-sessions', filaSesiones, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoCarpeta.add(filaSesiones);

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

        /* ------------------------- Encendido --------------------------- */
        const grupoWol = new Adw.PreferencesGroup({
            title: _('Encendido'),
            description: _('Cuando una conexión no responde, el clic derecho ofrece ' +
                '«Encender» si se le conoce la MAC. Un archivo .vnc no la lleva, así ' +
                'que sale de los equipos que tengas en la extensión Wake on LAN ' +
                '—emparejando por nombre o por host— o de la tabla ARP.'),
        });
        pagina.add(grupoWol);

        const filaWol = new Adw.SwitchRow({
            title: _('Encender desde el menú'),
            subtitle: _('El paquete mágico se manda igual que en la extensión Wake on LAN.'),
        });
        settings.bind('enable-wol', filaWol, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoWol.add(filaWol);

        const filaAprender = new Adw.SwitchRow({
            title: _('Aprender la MAC sola'),
            subtitle: _('Mientras una conexión responde, se apunta la MAC de su equipo ' +
                'de la tabla ARP del sistema para poder encenderlo cuando no responda. ' +
                'Solo vale para equipos del mismo segmento de red.'),
        });
        settings.bind('learn-macs', filaAprender, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-wol', filaAprender, 'sensitive', Gio.SettingsBindFlags.GET);
        grupoWol.add(filaAprender);

        // Cuántas hay ahora mismo. Se lee al abrir la ventana; el botón la
        // deja a cero y actualiza el texto sin tener que reabrirla.
        const filaOlvidar = new Adw.ActionRow({title: _('MAC aprendidas')});
        const etiquetaMacs = new Gtk.Label({css_classes: ['dim-label']});
        const contarMacs = () =>
            (etiquetaMacs.label = String(settings.get_strv('macs-aprendidas').length));
        contarMacs();

        const botonOlvidar = new Gtk.Button({
            label: _('Olvidar'),
            valign: Gtk.Align.CENTER,
        });
        botonOlvidar.connect('clicked', () => {
            settings.set_strv('macs-aprendidas', []);
            contarMacs();
        });

        filaOlvidar.add_suffix(etiquetaMacs);
        filaOlvidar.add_suffix(botonOlvidar);
        grupoWol.add(filaOlvidar);

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

        const filaLatencia = new Adw.SwitchRow({
            title: _('Mostrar la latencia'),
            subtitle: _('Milisegundos que tarda el host en responder, junto a cada conexión.'),
        });
        settings.bind('show-latency', filaLatencia, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-checks', filaLatencia, 'sensitive', Gio.SettingsBindFlags.GET);
        grupoChecks.add(filaLatencia);

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

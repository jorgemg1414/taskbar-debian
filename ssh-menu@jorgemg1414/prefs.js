/*
 * prefs.js — Ventana de preferencias (GNOME 45+ / libadwaita).
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {anadirFilasDeSitio} from './barraprefs.js';

export default class SshMenuPreferences extends ExtensionPreferences {
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

        /* --------------------------- Equipos --------------------------- */
        const grupoEquipos = new Adw.PreferencesGroup({
            title: _('Equipos'),
            description: _('Se leen los bloques «Host» de tu configuración de SSH, ' +
                'siguiendo las directivas Include. Los comentarios «# Grupo: NOMBRE» ' +
                'agrupan los bloques que vienen detrás.'),
        });
        pagina.add(grupoEquipos);

        const filaConfig = new Adw.EntryRow({title: _('Archivo de configuración')});
        settings.bind('config-path', filaConfig, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoEquipos.add(filaConfig);

        const filaDestino = new Adw.SwitchRow({
            title: _('Mostrar usuario@host'),
            subtitle: _('Añade el destino real a la derecha del alias, con el puerto si no es el 22.'),
        });
        settings.bind('show-target', filaDestino, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoEquipos.add(filaDestino);

        const filaIcono = new Adw.EntryRow({title: _('Icono del panel')});
        settings.bind('panel-icon', filaIcono, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoEquipos.add(filaIcono);

        const filaInsignia = new Adw.SwitchRow({
            title: _('Contador de caídos en el panel'),
            subtitle: _('Cuántos equipos no responden, junto al icono. Con el menú ' +
                'cerrado solo se actualiza si activas las comprobaciones en segundo plano.'),
        });
        settings.bind('panel-badge', filaInsignia, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoEquipos.add(filaInsignia);

        const filaBuscador = new Adw.SwitchRow({
            title: _('Buscador en el menú'),
            subtitle: _('Filtra los equipos al escribir. Intro abre la sesión con el primero.'),
        });
        settings.bind('enable-search', filaBuscador, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoEquipos.add(filaBuscador);

        const filaUmbral = new Adw.SpinRow({
            title: _('Mostrarlo a partir de'),
            subtitle: _('Número de equipos necesarios para que aparezca el buscador.'),
            adjustment: new Gtk.Adjustment({lower: 0, upper: 500, step_increment: 1, page_increment: 10}),
        });
        settings.bind('search-threshold', filaUmbral, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-search', filaUmbral, 'sensitive', Gio.SettingsBindFlags.GET);
        grupoEquipos.add(filaUmbral);

        /* ---------------------------- SFTP ----------------------------- */
        const grupoSftp = new Adw.PreferencesGroup({
            title: _('SFTP'),
            description: _('Cada equipo lleva dos botones a la derecha: la carpeta abre ' +
                'la máquina en el gestor de archivos y las flechas abren una sesión de ' +
                'sftp en una terminal, con sus get y put. Quien monta y quien pide la ' +
                'contraseña del modo gráfico es el gestor de archivos: la extensión no ' +
                'toca credenciales.'),
        });
        pagina.add(grupoSftp);

        const filaBotonSftp = new Adw.SwitchRow({
            title: _('Botón del gestor de archivos'),
            subtitle: _('Abre la carpeta remota en Archivos. Con el botón oculto sigue funcionando Ctrl+clic.'),
        });
        settings.bind('show-sftp', filaBotonSftp, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoSftp.add(filaBotonSftp);

        const filaBotonSftpTerminal = new Adw.SwitchRow({
            title: _('Botón de sftp en terminal'),
            subtitle: _('Abre «sftp <alias>» para mover archivos con get y put. ' +
                'Con el botón oculto sigue funcionando Mayús+clic.'),
        });
        settings.bind('show-sftp-terminal', filaBotonSftpTerminal, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoSftp.add(filaBotonSftpTerminal);

        const filaMontajes = new Adw.SwitchRow({
            title: _('Carpetas montadas'),
            subtitle: _('Lista arriba del menú las carpetas SFTP montadas, con un botón para desmontarlas.'),
        });
        settings.bind('show-mounts', filaMontajes, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoSftp.add(filaMontajes);

        const filaRuta = new Adw.EntryRow({title: _('Carpeta remota de inicio')});
        settings.bind('sftp-path', filaRuta, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoSftp.add(filaRuta);

        /* ------------------------- Wake on LAN ------------------------- */
        const grupoWol = new Adw.PreferencesGroup({
            title: _('Encendido'),
            description: _('Cuando un equipo no responde, el clic derecho ofrece ' +
                '«Encender» si se le conoce la MAC. Sale de un comentario ' +
                '«# MAC: aa:bb:cc:dd:ee:ff» en su bloque del config, o de los equipos ' +
                'que ya tengas en la extensión Wake on LAN, emparejando por nombre.'),
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
            subtitle: _('Mientras un equipo responde, se apunta su MAC de la tabla ARP ' +
                'del sistema para poder encenderlo cuando no responda. Solo vale para ' +
                'equipos del mismo segmento de red.'),
        });
        settings.bind('learn-macs', filaAprender, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-wol', filaAprender, 'sensitive', Gio.SettingsBindFlags.GET);
        grupoWol.add(filaAprender);

        // Cuántas hay ahora mismo. Se lee al abrir la ventana; el botón la
        // deja a cero y actualiza el texto sin tener que reabrirla.
        const filaOlvidar = new Adw.ActionRow({title: _('MAC aprendidas')});
        const etiqueta = new Gtk.Label({css_classes: ['dim-label']});
        const contar = () =>
            (etiqueta.label = String(settings.get_strv('macs-aprendidas').length));
        contar();

        const botonOlvidar = new Gtk.Button({
            label: _('Olvidar'),
            valign: Gtk.Align.CENTER,
        });
        botonOlvidar.connect('clicked', () => {
            settings.set_strv('macs-aprendidas', []);
            contar();
        });

        filaOlvidar.add_suffix(etiqueta);
        filaOlvidar.add_suffix(botonOlvidar);
        grupoWol.add(filaOlvidar);

        /* -------------------------- Comandos --------------------------- */
        const grupoComandos = new Adw.PreferencesGroup({
            title: _('Comandos'),
            description: _('Marcadores: %n alias, %h host, %p puerto, %u usuario, ' +
                '%d usuario@host, %f archivo de configuración, %s URL sftp://. ' +
                'Si el programa no está instalado se prueban alternativas.'),
        });
        pagina.add(grupoComandos);

        const filaTerminal = new Adw.EntryRow({title: _('Abrir sesión SSH')});
        settings.bind('terminal-command', filaTerminal, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoComandos.add(filaTerminal);

        const filaSftp = new Adw.EntryRow({title: _('Abrir SFTP en el gestor de archivos')});
        settings.bind('sftp-command', filaSftp, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoComandos.add(filaSftp);

        const filaSftpTerminal = new Adw.EntryRow({title: _('Abrir sftp en una terminal')});
        settings.bind('sftp-terminal-command', filaSftpTerminal, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoComandos.add(filaSftpTerminal);

        const filaEditor = new Adw.EntryRow({title: _('Editar configuración')});
        settings.bind('editor-command', filaEditor, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoComandos.add(filaEditor);

        /* ---------------------- Disponibilidad ------------------------ */
        const grupoChecks = new Adw.PreferencesGroup({
            title: _('Disponibilidad'),
            description: _('Punto verde o rojo según si el puerto de SSH responde. Solo se ' +
                'consulta la red mientras el menú está abierto, salvo que actives ' +
                'las comprobaciones en segundo plano. Los equipos con ProxyJump no se ' +
                'comprueban: no aceptan conexión directa.'),
        });
        pagina.add(grupoChecks);

        const filaActivar = new Adw.SwitchRow({title: _('Comprobar disponibilidad')});
        settings.bind('enable-checks', filaActivar, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoChecks.add(filaActivar);

        const filaLatencia = new Adw.SwitchRow({
            title: _('Mostrar la latencia'),
            subtitle: _('Milisegundos que tarda el equipo en responder, junto a cada entrada.'),
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
            subtitle: _('Segundos antes de dar un equipo por caído.'),
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

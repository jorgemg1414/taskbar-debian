/*
 * prefs.js — Ventana de preferencias (GNOME 45+ / libadwaita).
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {anadirFilasDeSitio} from './barraprefs.js';

export default class EquiposMenuPreferences extends ExtensionPreferences {
    /**
     * Construye la interfaz de preferencias.
     *
     * @param {Adw.PreferencesWindow} window ventana proporcionada por el shell
     */
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        /* ============================ General ============================ */
        const pagina = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(pagina);

        /* --------------------------- Equipos ---------------------------- */
        const grupoEquipos = new Adw.PreferencesGroup({
            title: _('Equipos'),
            description: _('Los equipos salen de tu configuración de SSH, la misma que ' +
                'usa el comando ssh. Añadir uno es añadir un bloque «Host» ahí.'),
        });
        pagina.add(grupoEquipos);

        const filaConfig = new Adw.EntryRow({title: _('Archivo de configuración')});
        settings.bind('config-path', filaConfig, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoEquipos.add(filaConfig);

        const filaRefresco = new Adw.SpinRow({
            title: _('Refresco con el menú abierto'),
            subtitle: _('Segundos entre consultas mientras miras el menú. Con el menú ' +
                'cerrado no se pregunta nada.'),
            adjustment: new Gtk.Adjustment({
                lower: 10, upper: 3600, step_increment: 10, page_increment: 60,
            }),
        });
        settings.bind('refresh-interval', filaRefresco, 'value', Gio.SettingsBindFlags.DEFAULT);
        grupoEquipos.add(filaRefresco);

        const filaActualizaciones = new Adw.SwitchRow({
            title: _('Contar las actualizaciones pendientes'),
            subtitle: _('En Debian es una simulación de apt-get, sin permisos ni red, ' +
                'pero tarda su segundo por equipo.'),
        });
        settings.bind('show-updates', filaActualizaciones, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoEquipos.add(filaActualizaciones);

        const filaDisco = new Adw.SpinRow({
            title: _('Avisar del disco a partir de'),
            subtitle: _('Porcentaje de disco usado con el que la cifra se pinta en rojo.'),
            adjustment: new Gtk.Adjustment({
                lower: 50, upper: 100, step_increment: 1, page_increment: 5,
            }),
        });
        settings.bind('disk-warning', filaDisco, 'value', Gio.SettingsBindFlags.DEFAULT);
        grupoEquipos.add(filaDisco);

        /* -------------------------- Conexión ---------------------------- */
        const grupoConexion = new Adw.PreferencesGroup({
            title: _('Conexión'),
            description: _('Se pregunta con «ssh <alias>» y BatchMode activado: nunca se ' +
                'pide una contraseña. Si un equipo pide una, es que su clave no está ' +
                'autorizada, y eso se arregla con herramientas/autorizar-clave.sh.'),
        });
        pagina.add(grupoConexion);

        const filaTimeout = new Adw.SpinRow({
            title: _('Espera al conectar'),
            subtitle: _('Segundos que espera ssh a que el equipo acepte la conexión.'),
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 60, step_increment: 1, page_increment: 5,
            }),
        });
        settings.bind('connect-timeout', filaTimeout, 'value', Gio.SettingsBindFlags.DEFAULT);
        grupoConexion.add(filaTimeout);

        const filaReutilizar = new Adw.SwitchRow({
            title: _('Reaprovechar la conexión'),
            subtitle: _('Todas las consultas de un equipo van por una sola conexión SSH. ' +
                'La primera paga el saludo completo; las demás son casi instantáneas.'),
        });
        settings.bind('reuse-connection', filaReutilizar, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoConexion.add(filaReutilizar);

        const filaPersistir = new Adw.SpinRow({
            title: _('Vida de la conexión compartida'),
            subtitle: _('Segundos que sigue abierta tras la última consulta.'),
            adjustment: new Gtk.Adjustment({
                lower: 10, upper: 3600, step_increment: 10, page_increment: 60,
            }),
        });
        settings.bind('persist-seconds', filaPersistir, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('reuse-connection', filaPersistir, 'sensitive', Gio.SettingsBindFlags.GET);
        grupoConexion.add(filaPersistir);

        /* ------------------------ Disponibilidad ------------------------ */
        const grupoChecks = new Adw.PreferencesGroup({
            title: _('Disponibilidad'),
            description: _('El punto verde o rojo sale de sondear el puerto de SSH, que ' +
                'tarda milisegundos: así se ve quién está antes de que lleguen las ' +
                'vitales, que tardan segundos.'),
        });
        pagina.add(grupoChecks);

        const filaChecks = new Adw.SwitchRow({title: _('Comprobar disponibilidad')});
        settings.bind('enable-checks', filaChecks, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoChecks.add(filaChecks);

        const filaEspera = new Adw.SpinRow({
            title: _('Tiempo de espera del sondeo'),
            subtitle: _('Segundos antes de dar un equipo por caído.'),
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 30, step_increment: 1, page_increment: 5,
            }),
        });
        settings.bind('check-timeout', filaEspera, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-checks', filaEspera, 'sensitive', Gio.SettingsBindFlags.GET);
        grupoChecks.add(filaEspera);

        /* -------------------------- Apariencia -------------------------- */
        const grupoAspecto = new Adw.PreferencesGroup({title: _('Apariencia')});
        pagina.add(grupoAspecto);

        const filaIcono = new Adw.EntryRow({title: _('Icono del panel')});
        settings.bind('panel-icon', filaIcono, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoAspecto.add(filaIcono);

        const filaInsignia = new Adw.SwitchRow({
            title: _('Contador en el panel'),
            subtitle: _('Cuántos equipos no responden, junto al icono.'),
        });
        settings.bind('panel-badge', filaInsignia, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoAspecto.add(filaInsignia);

        /* ============================ Energía ============================ */
        const paginaEnergia = new Adw.PreferencesPage({
            title: _('Energía'),
            icon_name: 'system-shutdown-symbolic',
        });
        window.add(paginaEnergia);

        const grupoAviso = new Adw.PreferencesGroup({
            title: _('Antes de tocar nada'),
            description: _('Apagar, reiniciar y suspender se ejecutan en el equipo tal ' +
                'cual estén escritos aquí. Un Linux normal no deja que una sesión SSH ' +
                'apague la máquina sin autorizarlo antes: si la orden falla diciendo que ' +
                'hace falta autenticación, mira el README de la extensión.'),
        });
        paginaEnergia.add(grupoAviso);

        const filaConfirmar = new Adw.SwitchRow({
            title: _('Pedir confirmación'),
            subtitle: _('Pregunta en el propio menú antes de ejecutar la orden. ' +
                'Desactivarlo deja el apagado a un solo clic.'),
        });
        settings.bind('confirm-power', filaConfirmar, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoAviso.add(filaConfirmar);

        const grupoLinux = new Adw.PreferencesGroup({
            title: _('Órdenes en Linux'),
        });
        paginaEnergia.add(grupoLinux);

        for (const [clave, titulo] of [
            ['poweroff-command-linux', _('Apagar')],
            ['reboot-command-linux', _('Reiniciar')],
            ['suspend-command-linux', _('Suspender')],
        ]) {
            const fila = new Adw.EntryRow({title: titulo});
            settings.bind(clave, fila, 'text', Gio.SettingsBindFlags.DEFAULT);
            grupoLinux.add(fila);
        }

        const grupoWindows = new Adw.PreferencesGroup({
            title: _('Órdenes en Windows'),
            description: _('El sistema de cada equipo se averigua solo la primera vez. ' +
                'Si no se reconoce, ponle un comentario «# Sistema: windows» en su bloque ' +
                'del archivo de configuración.'),
        });
        paginaEnergia.add(grupoWindows);

        for (const [clave, titulo] of [
            ['poweroff-command-windows', _('Apagar')],
            ['reboot-command-windows', _('Reiniciar')],
            ['suspend-command-windows', _('Suspender')],
        ]) {
            const fila = new Adw.EntryRow({title: titulo});
            settings.bind(clave, fila, 'text', Gio.SettingsBindFlags.DEFAULT);
            grupoWindows.add(fila);

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
}

/*
 * prefs.js — Ventana de preferencias (GNOME 45+ / libadwaita).
 *
 * La lista de equipos se edita aquí: cada equipo es una fila desplegable con
 * su nombre, su MAC, la dirección a la que se manda el paquete y el puerto.
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    leerEquipos, guardarEquipos, formatearMac, parsearSonda,
    PUERTO_POR_DEFECTO, PUERTO_SONDA,
} from './wol.js';
import {escanearHosts} from './hosts.js';
import {anadirFilasDeSitio} from './barraprefs.js';

// De dónde se importan los equipos. Es el archivo que lee el propio ssh.
const CONFIG_SSH = '~/.ssh/config';

export default class WolMenuPreferences extends ExtensionPreferences {
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
            description: _('El paquete mágico se manda a la dirección de difusión de ' +
                'la red donde vive el equipo (por ejemplo 192.168.10.255), no a su IP. ' +
                'La tarjeta escucha con el ordenador apagado.'),
        });
        pagina.add(grupoEquipos);

        const botonAnadir = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Añadir equipo'),
            css_classes: ['flat'],
        });

        const botonImportar = new Gtk.Button({
            icon_name: 'document-open-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Importar los equipos de ~/.ssh/config'),
            css_classes: ['flat'],
        });

        const cabecera = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 6});
        cabecera.append(botonImportar);
        cabecera.append(botonAnadir);
        grupoEquipos.set_header_suffix(cabecera);

        // Se guarda la lista en memoria y se vuelca a GSettings en cada cambio.
        let equipos = leerEquipos(settings);
        let filas = [];

        const guardar = () => guardarEquipos(settings, equipos);

        const repintar = () => {
            for (const fila of filas)
                grupoEquipos.remove(fila);
            filas = [];

            equipos.forEach((equipo, indice) => {
                const fila = this._filaEquipo(equipo, {
                    alCambiar: () => guardar(),
                    alBorrar: () => {
                        equipos.splice(indice, 1);
                        guardar();
                        repintar();
                    },
                });
                grupoEquipos.add(fila);
                filas.push(fila);
            });
        };

        botonAnadir.connect('clicked', () => {
            equipos.push({
                nombre: _('Equipo nuevo'),
                mac: '',
                destino: '',
                puerto: PUERTO_POR_DEFECTO,
                sonda: '',
            });
            guardar();
            repintar();
        });

        botonImportar.connect('clicked', () => {
            this._importarDeSsh(equipos)
                .then(anadidos => {
                    if (anadidos > 0) {
                        guardar();
                        repintar();
                    }
                    window.add_toast(new Adw.Toast({
                        title: anadidos > 0
                            ? `${anadidos} ${_('equipos importados de ~/.ssh/config')}`
                            : _('Nada nuevo que importar de ~/.ssh/config'),
                    }));
                })
                .catch(e => {
                    window.add_toast(new Adw.Toast({
                        title: `${_('No se pudo leer ~/.ssh/config')}: ${e.message}`,
                    }));
                });
        });

        repintar();

        /* ------------------------ Comprobación ------------------------- */
        const grupoComprobar = new Adw.PreferencesGroup({
            title: _('Comprobación'),
            description: _('El paquete mágico no tiene respuesta: que salga no dice ' +
                'si el equipo arrancó. Con la dirección de comprobación de cada equipo ' +
                'sí se puede saber, sondeándola hasta que responde.'),
        });
        pagina.add(grupoComprobar);

        const filaComprobar = new Adw.SwitchRow({
            title: _('Comprobar si el equipo está encendido'),
            subtitle: _('Pinta el punto verde o rojo al abrir el menú y espera al arranque.'),
        });
        settings.bind('enable-checks', filaComprobar, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoComprobar.add(filaComprobar);

        const filaEspera = new Adw.SpinRow({
            title: _('Espera de cada sondeo'),
            subtitle: _('Segundos que se espera a que acepte la conexión.'),
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 30, step_increment: 1, page_increment: 5,
            }),
        });
        settings.bind('check-timeout', filaEspera, 'value', Gio.SettingsBindFlags.DEFAULT);
        grupoComprobar.add(filaEspera);

        const filaArranque = new Adw.SpinRow({
            title: _('Espera al arranque'),
            subtitle: _('Segundos que se sigue sondeando tras mandar el paquete. 0 no espera.'),
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 600, step_increment: 10, page_increment: 30,
            }),
        });
        settings.bind('boot-timeout', filaArranque, 'value', Gio.SettingsBindFlags.DEFAULT);
        grupoComprobar.add(filaArranque);

        const filaAprender = new Adw.SwitchRow({
            title: _('Aprender las MAC'),
            subtitle: _('Mientras el equipo responde, su MAC está en la tabla ARP del ' +
                'sistema: se apunta de ahí y no hace falta escribirla.'),
        });
        settings.bind('learn-macs', filaAprender, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoComprobar.add(filaAprender);

        /* -------------------------- Apariencia ------------------------- */
        const grupoAspecto = new Adw.PreferencesGroup({title: _('Apariencia')});
        pagina.add(grupoAspecto);

        const filaIcono = new Adw.EntryRow({title: _('Icono del panel')});
        settings.bind('panel-icon', filaIcono, 'text', Gio.SettingsBindFlags.DEFAULT);
        grupoAspecto.add(filaIcono);

        const filaMac = new Adw.SwitchRow({
            title: _('Mostrar la MAC'),
            subtitle: _('Añade la dirección física a la derecha de cada equipo.'),
        });
        settings.bind('show-mac', filaMac, 'active', Gio.SettingsBindFlags.DEFAULT);
        grupoAspecto.add(filaMac);

        anadirFilasDeSitio(grupoAspecto, settings, _);
    }

    /**
     * Añade a la lista los equipos de ~/.ssh/config que todavía no estén.
     *
     * Es la forma rápida de llenar el menú: los equipos ya están descritos ahí,
     * con su dirección y su puerto, y la MAC no hace falta escribirla —se
     * aprende sola de la tabla ARP la primera vez que el equipo responda—.
     *
     * @param {object[]} equipos lista actual, que se amplía en el sitio
     * @returns {Promise<number>} cuántos equipos se han añadido
     */
    async _importarDeSsh(equipos) {
        const {hosts} = await escanearHosts(CONFIG_SSH, null);

        const normalizar = t => (t ?? '').trim().toLowerCase();

        // Lo que ya está en la lista, por nombre y por dirección, para no
        // duplicar equipos al importar dos veces.
        const conocidos = new Set();
        for (const equipo of equipos) {
            conocidos.add(normalizar(equipo.nombre));
            const sonda = parsearSonda(equipo.sonda);
            if (sonda)
                conocidos.add(normalizar(sonda.host));
        }

        let anadidos = 0;
        for (const host of hosts) {
            // Un equipo detrás de un salto no acepta conexión directa: ni se le
            // puede sondear, ni le llegaría un paquete de difusión.
            if (host.salto || host.host === '')
                continue;
            if (conocidos.has(normalizar(host.nombre)) || conocidos.has(normalizar(host.host)))
                continue;

            equipos.push({
                nombre: host.nombre,
                // Del comentario «# MAC:» de su bloque, si lo lleva.
                mac: formatearMac(host.mac) ?? '',
                // Del comentario «# Difusión:», si lo lleva.
                destino: host.difusion ?? '',
                puerto: PUERTO_POR_DEFECTO,
                sonda: host.port === PUERTO_SONDA ? host.host : `${host.host}:${host.port}`,
            });

            conocidos.add(normalizar(host.nombre));
            conocidos.add(normalizar(host.host));
            anadidos++;
        }

        return anadidos;
    }

    /**
     * Construye la fila desplegable de un equipo.
     *
     * @param {object} equipo equipo a editar (se modifica en el sitio)
     * @param {object} acciones callbacks
     * @param {Function} acciones.alCambiar se llama tras cada edición
     * @param {Function} acciones.alBorrar se llama al pulsar el botón de borrar
     * @returns {Adw.ExpanderRow} fila lista para añadir al grupo
     */
    _filaEquipo(equipo, {alCambiar, alBorrar}) {
        // Una MAC vacía no es un error si el equipo tiene con qué encontrarse:
        // se aprenderá de la tabla ARP la primera vez que responda.
        const subtitulo = () => {
            if (formatearMac(equipo.mac))
                return formatearMac(equipo.mac);
            if ((equipo.mac ?? '') !== '')
                return _('MAC no válida');
            return parsearSonda(equipo.sonda)
                ? _('MAC pendiente de aprender')
                : _('sin MAC');
        };

        const fila = new Adw.ExpanderRow({
            title: equipo.nombre || _('Equipo'),
            subtitle: subtitulo(),
        });

        const refrescarCabecera = () => {
            fila.title = equipo.nombre || _('Equipo');
            fila.subtitle = subtitulo();
        };

        const filaNombre = new Adw.EntryRow({title: _('Nombre'), text: equipo.nombre ?? ''});
        filaNombre.connect('changed', () => {
            equipo.nombre = filaNombre.get_text();
            refrescarCabecera();
            alCambiar();
        });
        fila.add_row(filaNombre);

        const filaMac = new Adw.EntryRow({title: _('MAC'), text: equipo.mac ?? ''});
        filaMac.connect('changed', () => {
            equipo.mac = filaMac.get_text();
            // Se avisa en el sitio si la MAC no cuadra, sin bloquear la edición.
            // Vacía no es un error: la aprende sola de la tabla ARP.
            if (formatearMac(equipo.mac) || equipo.mac === '')
                filaMac.remove_css_class('error');
            else
                filaMac.add_css_class('error');
            refrescarCabecera();
            alCambiar();
        });
        fila.add_row(filaMac);

        const filaDestino = new Adw.EntryRow({
            title: _('Dirección de difusión'),
            text: equipo.destino ?? '',
        });
        filaDestino.connect('changed', () => {
            equipo.destino = filaDestino.get_text();
            alCambiar();
        });
        fila.add_row(filaDestino);

        const filaPuerto = new Adw.SpinRow({
            title: _('Puerto'),
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 65535, step_increment: 1, page_increment: 10,
                value: equipo.puerto ?? PUERTO_POR_DEFECTO,
            }),
        });
        filaPuerto.connect('notify::value', () => {
            equipo.puerto = filaPuerto.get_value();
            alCambiar();
        });
        fila.add_row(filaPuerto);

        // Esta no es la dirección de difusión, sino la del equipo: es la que se
        // sondea para saber si ya está encendido.
        const filaSonda = new Adw.EntryRow({
            title: _('Dirección para comprobarlo'),
            text: equipo.sonda ?? '',
        });
        filaSonda.connect('changed', () => {
            equipo.sonda = filaSonda.get_text();
            const sonda = parsearSonda(equipo.sonda);
            filaSonda.set_tooltip_text(sonda
                ? `${_('Se sondea')} ${sonda.host}:${sonda.port}`
                : _('Vacío: del equipo solo se sabrá que se le mandó el paquete'));
            alCambiar();
        });
        filaSonda.set_tooltip_text(
            `${_('Su IP o su nombre, con puerto opcional. Sin puerto se usa el')} ${PUERTO_SONDA} (SSH); ` +
            `${_('para un Windows suele valer el 3389 o el 445.')}`);
        fila.add_row(filaSonda);

        const filaBorrar = new Adw.ActionRow({title: _('Quitar este equipo')});
        const botonBorrar = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        botonBorrar.connect('clicked', () => alBorrar());
        filaBorrar.add_suffix(botonBorrar);
        fila.add_row(filaBorrar);

        return fila;
    }
}

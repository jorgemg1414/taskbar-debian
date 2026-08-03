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

import {leerEquipos, guardarEquipos, formatearMac, PUERTO_POR_DEFECTO} from './wol.js';

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
        grupoEquipos.set_header_suffix(botonAnadir);

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
            });
            guardar();
            repintar();
        });

        repintar();

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
        const fila = new Adw.ExpanderRow({
            title: equipo.nombre || _('Equipo'),
            subtitle: formatearMac(equipo.mac) ?? _('sin MAC'),
        });

        const refrescarCabecera = () => {
            fila.title = equipo.nombre || _('Equipo');
            fila.subtitle = formatearMac(equipo.mac) ?? _('MAC no válida');
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
            if (formatearMac(equipo.mac))
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

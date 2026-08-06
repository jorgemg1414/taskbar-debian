/*
 * barraprefs.js — Las dos filas que eligen el sitio del indicador en la barra.
 *
 * La otra mitad de `barra.js`: aquello coloca el indicador leyendo «panel-box»
 * y «panel-position»; esto son las filas con las que se editan, iguales en
 * todas las extensiones del repositorio.
 *
 * Vive aparte porque la ventana de preferencias es otro proceso, sin shell: no
 * puede importar nada de `resource:///org/gnome/shell/ui/`.
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

// Mismo orden que las etiquetas de la lista desplegable.
const CAJAS = ['left', 'center', 'right'];

/**
 * Añade a un grupo de preferencias las filas del sitio en la barra.
 *
 * @param {Adw.PreferencesGroup} grupo grupo al que se añaden
 * @param {Gio.Settings} settings ajustes de la extensión
 * @param {Function} _ función de traducción de la extensión
 * @param {object} [claves] nombres de los ajustes, si no son los de siempre
 * @param {string} [claves.caja] ajuste con la caja de la barra
 * @param {string} [claves.posicion] ajuste con la posición dentro de la caja
 */
export function anadirFilasDeSitio(grupo, settings, _, {caja = 'panel-box', posicion = 'panel-position'} = {}) {
    const filaCaja = new Adw.ComboRow({
        title: _('Sitio en la barra'),
        subtitle: _('En qué parte de la barra superior se pone el indicador.'),
        model: new Gtk.StringList({
            strings: [_('Izquierda'), _('Centro'), _('Derecha')],
        }),
        selected: Math.max(0, CAJAS.indexOf(settings.get_string(caja))),
    });
    filaCaja.connect('notify::selected', () =>
        settings.set_string(caja, CAJAS[filaCaja.selected] ?? 'right'));
    // Por si el ajuste cambia por fuera, con gsettings o desde otra ventana.
    const idCaja = settings.connect(`changed::${caja}`, () =>
        (filaCaja.selected = Math.max(0, CAJAS.indexOf(settings.get_string(caja)))));
    filaCaja.connect('destroy', () => settings.disconnect(idCaja));
    grupo.add(filaCaja);

    const filaPosicion = new Adw.SpinRow({
        title: _('Posición'),
        subtitle: _('Orden dentro de esa parte, empezando por el 0. Los huecos que ' +
            'sobren se ignoran: el indicador se queda el último.'),
        adjustment: new Gtk.Adjustment({
            lower: 0, upper: 20, step_increment: 1, page_increment: 5,
        }),
    });
    settings.bind(posicion, filaPosicion, 'value', Gio.SettingsBindFlags.DEFAULT);
    grupo.add(filaPosicion);
}

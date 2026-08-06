/*
 * menu.js — Las piezas de menú que se repetían en tres extensiones.
 *
 * La fila de acciones del clic derecho, el campo de búsqueda, la lista con
 * desplazamiento, el contador del panel y el manejo del foco eran el mismo
 * código copiado en los menús de VNC, de SSH y de Equipos. Aquí están una vez.
 *
 * Los estilos de estas piezas viven en «estilos.css», con el mismo prefijo
 * «tb-», y cada install.sh lo pega delante de la hoja de su extensión.
 *
 * Nada de aquí conoce ninguna extensión concreta: lo que hace falta se pasa por
 * parámetro, incluida la función de traducción, porque `gettext` se importa del
 * módulo de la extensión que lo use.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Parte del alto de la pantalla que puede ocupar la lista. El resto queda para
// el buscador, el pie y los márgenes del menú.
const PROPORCION_ALTO_LISTA = 0.6;

/* -------------------------------------------------------------------------
 * Fila de acciones: varios botones icono+texto repartidos en una sola línea
 * ------------------------------------------------------------------------- */
export const ItemAcciones = GObject.registerClass(
class ItemAcciones extends PopupMenu.PopupBaseMenuItem {
    /**
     * Varias entradas de menú ocupaban varias filas y dejaban el pie pegado al
     * borde de la pantalla; en horizontal ocupan una sola.
     *
     * @param {{icono: string, texto: string, peligrosa: boolean, alPulsar: Function}[]} acciones botones a pintar
     */
    _init(acciones) {
        // No es activable: quien recibe los clics es cada botón.
        super._init({
            reactive: false,
            activate: false,
            hover: false,
            can_focus: false,
            style_class: 'tb-acciones',
        });

        for (const {icono, texto, peligrosa, alPulsar} of acciones) {
            const boton = new St.Button({
                style_class: peligrosa ? 'tb-accion tb-accion-peligrosa' : 'tb-accion',
                can_focus: true,
                x_expand: true,
                accessible_name: texto,
            });

            const caja = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            if (icono) {
                caja.add_child(new St.Icon({
                    icon_name: icono,
                    style_class: 'tb-accion-icono',
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            }
            caja.add_child(new St.Label({
                text: texto,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            boton.set_child(caja);

            boton.connect('clicked', () => alPulsar());
            this.add_child(boton);
        }
    }
});

/* -------------------------------------------------------------------------
 * Fila de confirmación: la pregunta y los dos botones
 * ------------------------------------------------------------------------- */
export const ItemConfirmacion = GObject.registerClass(
class ItemConfirmacion extends PopupMenu.PopupBaseMenuItem {
    /**
     * Se pregunta en el propio menú y no en un diálogo: el diálogo robaría el
     * foco y cerraría el menú, y aquí lo que hace falta es que el sí esté al
     * lado de aquello a lo que se refiere.
     *
     * @param {object} opciones opciones de la fila
     * @param {string} opciones.pregunta texto de la pregunta
     * @param {string} opciones.textoSi etiqueta del botón que confirma
     * @param {string} opciones.textoNo etiqueta del botón que cancela
     * @param {Function} opciones.alConfirmar acción al aceptar
     * @param {Function} opciones.alCancelar acción al rechazar
     */
    _init({pregunta, textoSi, textoNo, alConfirmar, alCancelar}) {
        super._init({
            reactive: false,
            activate: false,
            hover: false,
            can_focus: false,
            style_class: 'tb-acciones',
        });

        this.add_child(new St.Label({
            text: pregunta,
            style_class: 'tb-pregunta',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const boton = (texto, clase, accion) => {
            const b = new St.Button({
                style_class: clase,
                can_focus: true,
                accessible_name: texto,
                label: texto,
            });
            b.connect('clicked', () => accion());
            this.add_child(b);
        };

        // El «no» va primero, que es el que se pulsa sin mirar.
        boton(textoNo, 'tb-accion', alCancelar);
        boton(textoSi, 'tb-accion tb-accion-peligrosa', alConfirmar);
    }
});

/* -------------------------------------------------------------------------
 * Campo de búsqueda para filtrar la lista escribiendo
 * ------------------------------------------------------------------------- */
export const ItemBuscador = GObject.registerClass(
class ItemBuscador extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {object} opciones opciones del buscador
     * @param {string} opciones.pista texto de sugerencia del campo
     * @param {string} [opciones.texto] texto inicial del filtro
     * @param {Function} opciones.alEscribir callback con el texto escrito
     * @param {Function} opciones.alAceptar callback al pulsar Intro; recibe
     *   {ctrl, shift}, por si la extensión ofrece varias formas de abrir
     * @param {Function} opciones.alNavegar callback con +1/-1 al pulsar ↓/↑
     */
    _init({pista, texto = '', alEscribir, alAceptar, alNavegar}) {
        // No es activable ni enfocable: el foco lo lleva el campo de texto.
        super._init({reactive: false, activate: false, hover: false, can_focus: false});

        this.entrada = new St.Entry({
            style_class: 'tb-buscador',
            hint_text: pista,
            can_focus: true,
            x_expand: true,
        });
        this.entrada.set_primary_icon(new St.Icon({
            style_class: 'tb-buscador-icono',
            icon_name: 'edit-find-symbolic',
        }));
        this.entrada.set_text(texto);
        this.add_child(this.entrada);

        this.entrada.clutter_text.connect('text-changed',
            () => alEscribir(this.entrada.get_text()));

        this.entrada.clutter_text.connect('key-press-event', (_actor, evento) => {
            const tecla = evento.get_key_symbol();
            const estado = evento.get_state();

            if (tecla === Clutter.KEY_Return || tecla === Clutter.KEY_KP_Enter) {
                alAceptar({
                    ctrl: (estado & Clutter.ModifierType.CONTROL_MASK) !== 0,
                    shift: (estado & Clutter.ModifierType.SHIFT_MASK) !== 0,
                });
                return Clutter.EVENT_STOP;
            }

            // Escape limpia el filtro; si ya está vacío, deja que el menú se cierre.
            if (tecla === Clutter.KEY_Escape && this.entrada.get_text() !== '') {
                this.entrada.set_text('');
                return Clutter.EVENT_STOP;
            }

            // Las flechas bajan a la lista en vez de mover el cursor: dentro de
            // un campo de una línea no tienen otro cometido útil.
            if (tecla === Clutter.KEY_Down)
                return alNavegar(1);
            if (tecla === Clutter.KEY_Up)
                return alNavegar(-1);

            return Clutter.EVENT_PROPAGATE;
        });
    }

    /**
     * Pone el foco del teclado en el campo de texto.
     */
    enfocar() {
        this.entrada.grab_key_focus();
    }
});

/* -------------------------------------------------------------------------
 * Ayudas sueltas
 * ------------------------------------------------------------------------- */

/**
 * Quita acentos y mayúsculas para que la búsqueda sea tolerante.
 *
 * @param {string} texto texto a normalizar
 * @returns {string} texto comparable
 */
export function normalizar(texto) {
    // El rango es el de los diacríticos que NFD deja sueltos tras la letra.
    return (texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Contador de caídos para el panel.
 *
 * @returns {St.Label} etiqueta ya estilada, oculta hasta que haya algo que decir
 */
export function crearInsignia() {
    return new St.Label({
        style_class: 'tb-insignia',
        y_align: Clutter.ActorAlign.CENTER,
        visible: false,
    });
}

/**
 * Pone el número en el contador del panel, o lo esconde si no hay ninguno.
 *
 * @param {St.Label} insignia etiqueta creada con crearInsignia()
 * @param {number} caidos cuántos no responden
 */
export function pintarInsignia(insignia, caidos) {
    if (!insignia)
        return;
    insignia.text = String(caidos);
    insignia.visible = caidos > 0;
}

/**
 * Limita el alto de la lista a una parte del área de trabajo, para que el menú
 * nunca crezca más que la pantalla y el pie quede siempre visible.
 *
 * El valor va en píxeles lógicos, de ahí la división por el factor de escala.
 *
 * @param {St.ScrollView} scroll zona con desplazamiento de la lista
 */
export function ajustarAltoLista(scroll) {
    if (!scroll)
        return;

    const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
    const escala = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    const alto = Math.max(200, Math.round(area.height * PROPORCION_ALTO_LISTA / escala));

    scroll.style = `max-height: ${alto}px;`;
}

/**
 * Desplaza la lista lo justo para que un elemento quede a la vista.
 *
 * @param {St.ScrollView} scroll zona con desplazamiento
 * @param {St.Widget} item elemento que debe verse entero
 */
export function asegurarVisible(scroll, item) {
    const ajuste = scroll?.vadjustment;
    if (!ajuste)
        return;

    const caja = item.get_allocation_box();
    if (caja.y1 < ajuste.value)
        ajuste.value = caja.y1;
    else if (caja.y2 > ajuste.value + ajuste.page_size)
        ajuste.value = caja.y2 - ajuste.page_size;
}

/**
 * Mueve el foco entre los elementos visibles, saltando cabeceras y los que el
 * filtro haya ocultado.
 *
 * La navegación por omisión del menú no sabe que hay entradas ocultas y se
 * para en ellas, de ahí que las flechas se atiendan a mano.
 *
 * @param {object} opciones opciones del movimiento
 * @param {St.Widget[]} opciones.items elementos de la lista, en orden
 * @param {number} opciones.delta +1 para bajar, -1 para subir
 * @param {St.ScrollView} [opciones.scroll] lista, para desplazarla si hace falta
 * @param {object} [opciones.buscador] ItemBuscador al que volver desde el primero
 * @returns {boolean} si la tecla queda consumida
 */
export function moverFoco({items, delta, scroll = null, buscador = null}) {
    const visibles = items.filter(item => item.visible);
    if (visibles.length === 0)
        return Clutter.EVENT_PROPAGATE;

    const foco = global.stage.get_key_focus();
    const actual = visibles.findIndex(
        item => item === foco || (foco && item.contains(foco)));

    // Subir desde el primero devuelve el foco al buscador.
    if (actual === 0 && delta < 0 && buscador) {
        buscador.enfocar();
        return Clutter.EVENT_STOP;
    }

    const siguiente = actual === -1
        ? (delta > 0 ? visibles[0] : visibles[visibles.length - 1])
        : visibles[(actual + delta + visibles.length) % visibles.length];

    siguiente.grab_key_focus();
    asegurarVisible(scroll, siguiente);
    return Clutter.EVENT_STOP;
}

/**
 * Crea la lista con desplazamiento y la añade al menú.
 *
 * El St.ScrollView va dentro de una sección para que el removeAll() del menú lo
 * destruya con todo lo demás al reconstruirse.
 *
 * @param {PopupMenu.PopupMenu} menu menú al que añadirla
 * @returns {{scroll: St.ScrollView, seccion: PopupMenu.PopupMenuSection}} la lista
 */
export function crearListaConScroll(menu) {
    const scroll = new St.ScrollView({
        style_class: 'tb-lista',
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        x_expand: true,
    });

    const seccion = new PopupMenu.PopupMenuSection();
    scroll.set_child(seccion.actor);

    const contenedor = new PopupMenu.PopupMenuSection();
    contenedor.actor.add_child(scroll);
    menu.addMenuItem(contenedor);

    ajustarAltoLista(scroll);
    return {scroll, seccion};
}

/*
 * extension.js — Portapapeles para GNOME Shell 48 (ESM).
 *
 * Lo último que has copiado, en la barra superior. El historial no es suyo:
 * es el de CopyQ, el mismo que abre Super+V y el mismo que sigue ahí cuando
 * esta extensión está desactivada. Aquí solo se lee y se pinta.
 *
 * Esa decisión es la que evita el problema de tener dos historiales que no se
 * hablan: si la extensión guardara lo suyo, copiar algo con el menú cerrado y
 * buscarlo luego en la ventana de CopyQ daría dos listas distintas.
 *
 * Al historial no se le pregunta nada mientras el menú está cerrado: no hay
 * temporizador ni vigilancia del portapapeles. Se lee al abrir, y ya.
 *
 * Todo lo que se crea aquí se destruye en disable(), como exige GNOME.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {SitioEnLaBarra} from './barra.js';
import {
    ItemAcciones, ItemBuscador, ItemConfirmacion,
    crearListaConScroll, moverFoco, normalizar,
} from './menu.js';
import * as CopyQ from './copyq.js';

// Lo que se espera desde que se cierra el menú hasta que se manda el Ctrl+V.
// El foco tarda en volver a la ventana que lo tenía antes, y pegar antes de
// que vuelva mandaría la pulsación al shell, donde no hace nada.
const ESPERA_PEGADO_MS = 200;

/* -------------------------------------------------------------------------
 * Una fila del historial
 * ------------------------------------------------------------------------- */
const ItemElemento = GObject.registerClass({
    Signals: {'contexto': {}},
}, class ItemElemento extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {object} elemento elemento leído de CopyQ (fila, texto, vacio)
     */
    _init(elemento) {
        super._init();
        this.elemento = elemento;

        // Un elemento copiado de un editor trae saltos de línea y sangrías, y
        // en una fila de menú eso solo sirve para que no se lea nada. Se pinta
        // en una línea, con los espacios de sobra recogidos; el original no se
        // toca, que es lo que se copia luego.
        const enUnaLinea = elemento.texto.replace(/\s+/g, ' ').trim();

        this._etiqueta = new St.Label({
            text: elemento.vacio ? _('(sin texto: imagen u otro formato)') : enUnaLinea,
            style_class: elemento.vacio
                ? 'portapapeles-texto portapapeles-sin-texto'
                : 'portapapeles-texto',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._etiqueta.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.add_child(this._etiqueta);

        // A la derecha, cuánto hay de verdad detrás de esa línea: es la única
        // forma de distinguir un párrafo entero de la frase que se ve.
        const lineas = elemento.texto.split('\n').length;
        if (lineas > 1) {
            this.add_child(new St.Label({
                text: `${lineas} ${_('líneas')}`,
                style_class: 'portapapeles-medida',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }

        this.accessible_name = elemento.vacio ? _('Elemento sin texto') : enUnaLinea;

        // Para el buscador: se compara contra el texto entero, no contra lo
        // que se ve. Buscar una palabra que estaba en la tercera línea tiene
        // que encontrarla.
        this.comparable = normalizar(elemento.texto);
    }

    /**
     * Con el botón derecho no se copia: se piden sus acciones.
     *
     * @param {Clutter.Event} evento evento de soltar el botón
     * @returns {boolean} si el evento queda consumido
     */
    vfunc_button_release_event(evento) {
        if (evento.get_button() === Clutter.BUTTON_SECONDARY) {
            this.emit('contexto');
            return Clutter.EVENT_STOP;
        }
        // El clic izquierdo se deja pasar y no se encadena al padre:
        // PopupBaseMenuItem activa sus filas con un Clutter.ClickAction, no con
        // este vfunc, así que «super» llega hasta StBoxLayout —que no lo
        // implementa— y suelta un error en cada pulsación.
        return Clutter.EVENT_PROPAGATE;
    }
});

/* -------------------------------------------------------------------------
 * El indicador de la barra
 * ------------------------------------------------------------------------- */
const IndicadorPortapapeles = GObject.registerClass(
class IndicadorPortapapeles extends PanelMenu.Button {
    /**
     * @param {Extension} extension extensión dueña del indicador
     */
    _init(extension) {
        super._init(0.5, _('Portapapeles'));

        this._extension = extension;
        this._settings = extension.getSettings();
        this._cancellable = new Gio.Cancellable();
        this._destruido = false;

        this._items = [];
        this._filtro = '';
        this._buscador = null;
        this._scroll = null;
        this._filaAcciones = null;
        this._itemConAcciones = null;
        this._confirmandoVaciado = false;
        this._idEspera = 0;

        this._icono = new St.Icon({
            icon_name: this._settings.get_string('panel-icon'),
            style_class: 'system-status-icon',
        });
        this.add_child(this._icono);

        this._idsSettings = [
            this._settings.connect('changed::panel-icon', () =>
                (this._icono.icon_name = this._settings.get_string('panel-icon'))),
        ];

        // Se lee al abrir el menú y no antes: con el menú cerrado esta
        // extensión no existe para el sistema.
        this.menu.connect('open-state-changed', (_menu, abierto) => {
            if (abierto)
                this._refrescar();
            else
                this._olvidarEstadoDelMenu();
        });
    }

    /* --------------------------- Leer y pintar ------------------------- */

    /**
     * Pregunta a CopyQ y repinta el menú con lo que conteste.
     */
    async _refrescar() {
        const maximo = this._settings.get_int('max-items');

        let historial;
        try {
            historial = await CopyQ.leerHistorial({maximo}, this._cancellable);
        } catch {
            // Cancelado al cerrar el menú o al desactivar la extensión.
            return;
        }
        if (this._destruido)
            return;

        this._pintar(historial);
    }

    /**
     * Rehace el menú entero.
     *
     * @param {object} historial lo devuelto por CopyQ.leerHistorial
     */
    _pintar({estado, total, elementos}) {
        this.menu.removeAll();
        this._items = [];
        this._buscador = null;
        this._scroll = null;
        this._filaAcciones = null;
        this._itemConAcciones = null;

        if (estado !== CopyQ.ESTADO.LISTO) {
            this._pintarProblema(estado);
            return;
        }

        if (elementos.length === 0) {
            this.menu.addMenuItem(this._aviso(_('El historial está vacío. Copia algo.')));
            this._pintarPie(0);
            return;
        }

        this._pintarBuscador(elementos.length);

        const {scroll, seccion} = crearListaConScroll(this.menu);
        this._scroll = scroll;

        for (const elemento of elementos) {
            const item = new ItemElemento(elemento);
            item.connect('activate', () => this._usar(elemento.fila));
            item.connect('contexto', () => this._mostrarAcciones(item, seccion));
            seccion.addMenuItem(item);
            this._items.push(item);
        }

        this._pintarPie(total);
        this._aplicarFiltro();
    }

    /**
     * El campo de filtro, cuando hay elementos suficientes para que ayude.
     *
     * @param {number} cuantos elementos que se van a listar
     */
    _pintarBuscador(cuantos) {
        if (!this._settings.get_boolean('enable-search'))
            return;
        if (cuantos < this._settings.get_int('search-threshold'))
            return;

        this._buscador = new ItemBuscador({
            pista: _('Buscar en lo copiado…'),
            texto: this._filtro,
            alEscribir: texto => {
                this._filtro = texto;
                this._aplicarFiltro();
            },
            // Intro usa el primero de los que hayan quedado a la vista.
            alAceptar: () => {
                const primero = this._items.find(item => item.visible);
                if (primero)
                    this._usar(primero.elemento.fila);
            },
            alNavegar: delta => moverFoco({
                items: this._items, delta, scroll: this._scroll,
            }),
        });
        this.menu.addMenuItem(this._buscador);

        // El foco al campo en cuanto el menú termine de abrirse: hacerlo ahora
        // no sirve, porque el menú todavía se está montando.
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (!this._destruido && this.menu.isOpen)
                this._buscador?.enfocar();
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Esconde las filas que no casen con lo escrito en el buscador.
     */
    _aplicarFiltro() {
        const buscado = normalizar(this._filtro);
        for (const item of this._items)
            item.visible = buscado === '' || item.comparable.includes(buscado);
    }

    /**
     * El pie del menú: abrir CopyQ y vaciar el historial.
     *
     * @param {number} total cuántos elementos hay en CopyQ, no cuántos se ven
     */
    _pintarPie(total) {
        const vistos = this._items.length;
        if (total > vistos) {
            this.menu.addMenuItem(this._aviso(
                `${_('Se ven los últimos')} ${vistos} ${_('de')} ${total}. ` +
                `${_('El resto, en la ventana de CopyQ.')}`));
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        if (this._confirmandoVaciado) {
            this.menu.addMenuItem(new ItemConfirmacion({
                pregunta: _('¿Borrar todo el historial?'),
                textoSi: _('Borrar'),
                textoNo: _('No'),
                alConfirmar: () => {
                    this._confirmandoVaciado = false;
                    this._vaciar();
                },
                alCancelar: () => {
                    this._confirmandoVaciado = false;
                    this._refrescar();
                },
            }));
            return;
        }

        this.menu.addMenuItem(new ItemAcciones([
            {
                icono: 'view-list-symbolic',
                texto: _('Abrir CopyQ'),
                alPulsar: () => {
                    this.menu.close();
                    CopyQ.abrirVentana(this._cancellable).catch(() => {});
                },
            },
            {
                icono: 'user-trash-symbolic',
                texto: _('Vaciar'),
                peligrosa: true,
                alPulsar: () => {
                    this._confirmandoVaciado = true;
                    this._refrescar();
                },
            },
        ]));
    }

    /**
     * Lo que se enseña cuando CopyQ no está o no contesta.
     *
     * @param {string} estado uno de CopyQ.ESTADO
     */
    _pintarProblema(estado) {
        if (estado === CopyQ.ESTADO.SIN_PROGRAMA) {
            this.menu.addMenuItem(this._aviso(_('CopyQ no está instalado.')));
            this.menu.addMenuItem(this._aviso(
                _('Instálalo con:  sudo apt install copyq')));
            return;
        }

        if (estado === CopyQ.ESTADO.PARADO) {
            this.menu.addMenuItem(this._aviso(_('CopyQ está instalado, pero no en marcha.')));
            this.menu.addMenuItem(new ItemAcciones([{
                icono: 'media-playback-start-symbolic',
                texto: _('Arrancarlo'),
                alPulsar: () => {
                    CopyQ.arrancarServidor();
                    // Al servidor le cuesta un momento aceptar órdenes; se le
                    // deja ese momento antes de volver a preguntar.
                    this._reintentarTrasArrancar();
                },
            }]));
            return;
        }

        this.menu.addMenuItem(this._aviso(_('CopyQ ha contestado algo que no se entiende.')));
    }

    /**
     * Vuelve a leer el historial un segundo después de arrancar el servidor.
     */
    _reintentarTrasArrancar() {
        if (this._idEspera !== 0)
            GLib.source_remove(this._idEspera);

        this._idEspera = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._idEspera = 0;
            if (!this._destruido && this.menu.isOpen)
                this._refrescar();
            return GLib.SOURCE_REMOVE;
        });
    }

    /* ----------------------------- Acciones ---------------------------- */

    /**
     * Copia un elemento y, si está pedido, lo pega donde estuviera el cursor.
     *
     * @param {number} fila posición del elemento en el historial
     */
    async _usar(fila) {
        this.menu.close();

        const copiado = await CopyQ.elegir(fila, this._cancellable).catch(() => false);
        if (!copiado || this._destruido)
            return;

        if (this._settings.get_boolean('paste-on-select'))
            this._pegarEnUnMomento();
    }

    /**
     * Manda el Ctrl+V cuando el foco haya vuelto a la ventana de antes.
     */
    _pegarEnUnMomento() {
        if (this._idEspera !== 0)
            GLib.source_remove(this._idEspera);

        this._idEspera = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, ESPERA_PEGADO_MS, () => {
                this._idEspera = 0;
                if (!this._destruido)
                    CopyQ.pegar(this._cancellable).catch(() => {});
                return GLib.SOURCE_REMOVE;
            });
    }

    /**
     * Abre la fila de acciones del clic derecho debajo de un elemento.
     *
     * @param {ItemElemento} item fila sobre la que se ha pulsado
     * @param {PopupMenu.PopupMenuSection} seccion lista que la contiene
     */
    _mostrarAcciones(item, seccion) {
        const eraElMismo = this._itemConAcciones === item;
        this._quitarAcciones();
        if (eraElMismo)
            return;

        const fila = new ItemAcciones([
            {
                icono: 'edit-copy-symbolic',
                texto: _('Copiar'),
                alPulsar: () => {
                    this.menu.close();
                    CopyQ.elegir(item.elemento.fila, this._cancellable).catch(() => {});
                },
            },
            {
                icono: 'edit-delete-symbolic',
                texto: _('Quitar'),
                peligrosa: true,
                alPulsar: async () => {
                    await CopyQ.quitar(item.elemento.fila, this._cancellable).catch(() => {});
                    if (!this._destruido && this.menu.isOpen)
                        this._refrescar();
                },
            },
        ]);

        // Justo debajo de la fila a la que se refiere, no al final de la lista.
        const posicion = seccion._getMenuItems().indexOf(item) + 1;
        seccion.addMenuItem(fila, posicion);

        this._filaAcciones = fila;
        this._itemConAcciones = item;
    }

    /**
     * Cierra la fila de acciones si hay alguna abierta.
     */
    _quitarAcciones() {
        this._filaAcciones?.destroy();
        this._filaAcciones = null;
        this._itemConAcciones = null;
    }

    /**
     * Borra el historial y repinta.
     */
    async _vaciar() {
        await CopyQ.vaciar(this._cancellable).catch(() => {});
        if (!this._destruido && this.menu.isOpen)
            this._refrescar();
    }

    /**
     * Olvida el filtro y la fila de acciones al cerrarse el menú.
     *
     * Sin esto, abrir el menú al rato lo enseñaría filtrado por lo que se
     * escribió la vez anterior, y con media lista escondida sin motivo
     * aparente.
     */
    _olvidarEstadoDelMenu() {
        this._filtro = '';
        this._confirmandoVaciado = false;
        this._quitarAcciones();
    }

    /* ---------------------------- Auxiliares --------------------------- */

    /**
     * Una línea de texto que no se puede pulsar.
     *
     * @param {string} texto lo que se lee
     * @returns {PopupMenu.PopupMenuItem} la fila
     */
    _aviso(texto) {
        const item = new PopupMenu.PopupMenuItem(texto, {
            reactive: false,
            style_class: 'tb-aviso',
        });
        item.label.clutter_text.line_wrap = true;
        return item;
    }

    /* ----------------------------- Limpieza ---------------------------- */

    /**
     * Libera todo. Se llama desde disable().
     */
    destroy() {
        this._destruido = true;
        this._cancellable.cancel();

        if (this._idEspera !== 0) {
            GLib.source_remove(this._idEspera);
            this._idEspera = 0;
        }

        for (const id of this._idsSettings)
            this._settings.disconnect(id);
        this._idsSettings = [];

        this._items = [];
        this._buscador = null;
        this._scroll = null;
        this._filaAcciones = null;
        this._itemConAcciones = null;
        this._settings = null;
        this._extension = null;

        super.destroy();
    }
});

/* -------------------------------------------------------------------------
 * Punto de entrada de la extensión (API moderna de GNOME 45+)
 * ------------------------------------------------------------------------- */
export default class PortapapelesExtension extends Extension {
    /**
     * Crea el indicador y lo pone en la barra, donde digan los ajustes.
     */
    enable() {
        this._sitio = new SitioEnLaBarra({
            extension: this,
            crear: () => new IndicadorPortapapeles(this),
        });
    }

    /**
     * Destruye el indicador y, con él, todos sus recursos.
     */
    disable() {
        this._sitio?.destruir();
        this._sitio = null;
    }
}

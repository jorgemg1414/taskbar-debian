/*
 * extension.js — Pendientes para GNOME Shell 48 (ESM).
 *
 * Indicador en la barra superior con las tareas sin hacer de tus archivos
 * Markdown. Al pulsar una se marca en el archivo.
 *
 * La idea es la misma que en los demás menús del repositorio: leer tus archivos
 * tal como están. Aquí, además, se escribe en ellos —es el único que lo hace—,
 * así que el cuidado está en tareas.js: solo cambia el hueco de la casilla, y
 * solo si al releer sigue siendo la misma tarea.
 *
 * Todo lo que se crea aquí (indicador, monitores de archivo, temporizadores y
 * cancelables) se destruye en disable(), como exige GNOME.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    escanearTareas, agruparTareas, alternarTarea, editarTexto, anadirTarea,
    borrarTarea, crearArchivoSiFalta, expandirRuta,
} from './tareas.js';
import {SitioEnLaBarra} from './barra.js';
import {
    ItemAcciones, ItemBuscador, ItemConfirmacion, crearInsignia, pintarInsignia,
    crearListaConScroll, ajustarAltoLista, moverFoco, normalizar,
} from './menu.js';

// Milisegundos que se espera tras un cambio en los archivos antes de recargar
// (los editores guardan en varios pasos).
const RETARDO_RECARGA_MS = 700;

// Editores alternativos, por si el configurado no está instalado.
const ALTERNATIVAS_EDITOR = [
    'gnome-text-editor %f',
    'gedit %f',
    'kate %f',
    'xdg-open %f',
];

/* -------------------------------------------------------------------------
 * Elemento de menú de una tarea: casilla + texto + archivo
 * ------------------------------------------------------------------------- */
const ItemTarea = GObject.registerClass({
    // El clic derecho no marca: pide las acciones de esa tarea.
    Signals: {'contexto': {}},
}, class ItemTarea extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {object} tarea tarea a representar
     * @param {boolean} mostrarArchivo si se pone el nombre del archivo a la derecha
     */
    _init(tarea, mostrarArchivo) {
        super._init();

        this.tarea = tarea;

        this._casilla = new St.Icon({
            icon_name: tarea.hecha ? 'checkbox-checked-symbolic' : 'checkbox-symbolic',
            style_class: 'pendientes-casilla',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._casilla);

        this._etiqueta = new St.Label({
            text: tarea.texto,
            style_class: tarea.hecha ? 'pendientes-texto pendientes-hecha' : 'pendientes-texto',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        // Una tarea larga no puede estirar el menú hasta el otro extremo de la
        // pantalla: se corta con puntos suspensivos.
        this._etiqueta.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.add_child(this._etiqueta);
        this.label_actor = this._etiqueta;

        // La sangría de las subtareas se respeta, que para eso la escribiste.
        if (tarea.sangria > 0)
            this._casilla.style = `margin-left: ${Math.min(tarea.sangria, 8) * 6}px;`;

        if (mostrarArchivo) {
            this.add_child(new St.Label({
                text: tarea.archivo,
                style_class: 'pendientes-archivo',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }

        this.accessible_name = tarea.hecha
            ? `${tarea.texto} — ${_('hecha')}`
            : tarea.texto;
    }

    /**
     * Pinta la tarea como hecha o pendiente sin esperar a releer el archivo.
     *
     * @param {boolean} hecha nuevo estado
     */
    fijarHecha(hecha) {
        this.tarea.hecha = hecha;
        this._casilla.icon_name = hecha ? 'checkbox-checked-symbolic' : 'checkbox-symbolic';
        this._etiqueta.style_class = hecha
            ? 'pendientes-texto pendientes-hecha'
            : 'pendientes-texto';
        this.accessible_name = hecha
            ? `${this.tarea.texto} — ${_('hecha')}`
            : this.tarea.texto;
    }

    /**
     * Con el botón derecho no se marca: se piden sus acciones.
     *
     * @param {Clutter.Event} evento evento de soltar el botón
     * @returns {boolean} si el evento queda consumido
     */
    vfunc_button_release_event(evento) {
        if (evento.get_button() === Clutter.BUTTON_SECONDARY) {
            this.emit('contexto');
            return Clutter.EVENT_STOP;
        }
        return super.vfunc_button_release_event(evento);
    }
});

/* -------------------------------------------------------------------------
 * Fila con un campo de texto, para escribir una tarea sin salir del menú
 * ------------------------------------------------------------------------- */
const ItemEntrada = GObject.registerClass(
class ItemEntrada extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {object} opciones opciones de la fila
     * @param {string} [opciones.texto] texto con el que empieza el campo
     * @param {string} opciones.pista texto de sugerencia cuando está vacío
     * @param {Function} opciones.alAceptar recibe el texto al pulsar Intro
     * @param {Function} opciones.alCancelar se llama al pulsar Escape
     */
    _init({texto = '', pista, alAceptar, alCancelar}) {
        // No es activable ni enfocable: el foco lo lleva el campo de texto.
        super._init({reactive: false, activate: false, hover: false, can_focus: false});

        this.entrada = new St.Entry({
            style_class: 'tb-buscador',
            hint_text: pista,
            can_focus: true,
            x_expand: true,
        });
        this.entrada.set_text(texto);
        this.add_child(this.entrada);

        this.entrada.clutter_text.connect('key-press-event', (_actor, evento) => {
            const tecla = evento.get_key_symbol();

            if (tecla === Clutter.KEY_Return || tecla === Clutter.KEY_KP_Enter) {
                alAceptar(this.entrada.get_text());
                return Clutter.EVENT_STOP;
            }

            // Escape deja el archivo como estaba, se haya escrito lo que se haya
            // escrito.
            if (tecla === Clutter.KEY_Escape) {
                alCancelar();
                return Clutter.EVENT_STOP;
            }

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
 * Indicador del panel
 * ------------------------------------------------------------------------- */
const IndicadorPendientes = GObject.registerClass(
class IndicadorPendientes extends PanelMenu.Button {
    /**
     * @param {Extension} extension instancia de la extensión (settings, openPreferences)
     */
    _init(extension) {
        super._init(0.5, 'Pendientes');

        this._extension = extension;
        this._settings = extension.getSettings();

        this._tareas = [];
        this._items = new Map();      // id de tarea -> ItemTarea
        this._archivos = [];          // archivos leídos
        this._variosArchivos = false;
        this._motivoVacio = null;     // 'inexistente' | 'vacio' | null
        this._monitores = [];         // {monitor, handlerId}
        this._idsSettings = [];
        this._cabeceras = [];         // {cabecera, items} por grupo, para filtrar
        this._buscador = null;
        this._itemSinCoincidencias = null;
        this._scroll = null;
        this._seccionLista = null;
        this._contexto = null;
        this._textoFiltro = '';
        this._idRecarga = 0;
        this._idFoco = 0;
        this._cancellable = new Gio.Cancellable();
        // Marcar una tarea tiene su propio cancelable: que el archivo cambie y
        // se recargue no debe abortar una escritura a medias.
        this._cancellableAcciones = new Gio.Cancellable();
        this._destruido = false;

        this._icono = new St.Icon({
            icon_name: this._settings.get_string('panel-icon'),
            style_class: 'system-status-icon',
        });
        this.add_child(this._icono);

        // Cuántas quedan, para no tener que abrir el menú a mirarlo.
        this._insignia = crearInsignia();
        this.add_child(this._insignia);

        this._idAbrir = this.menu.connect('open-state-changed', (_menu, abierto) => {
            if (abierto)
                this._alAbrirMenu();
            else
                this._alCerrarMenu();
        });

        // Las flechas se atienden en el menú entero: la navegación por omisión
        // no sabe que hay tareas ocultas por el filtro y se para en ellas.
        this._idTeclas = this.menu.actor.connect('key-press-event', (_actor, evento) => {
            const tecla = evento.get_key_symbol();
            if (tecla === Clutter.KEY_Down)
                return this._moverFoco(1);
            if (tecla === Clutter.KEY_Up)
                return this._moverFoco(-1);
            return Clutter.EVENT_PROPAGATE;
        });

        this._conectarSettings();
        this._reconstruirMenu();   // pinta el estado «cargando»
        this.recargar();
    }

    /**
     * Ruta absoluta del archivo o carpeta según los ajustes.
     *
     * @returns {string} ruta expandida
     */
    get _ruta() {
        return expandirRuta(this._settings.get_string('ruta'));
    }

    /**
     * Tareas que salen en el menú: las hechas solo si se piden.
     *
     * @returns {object[]} tareas a pintar
     */
    get _visibles() {
        if (this._settings.get_boolean('mostrar-hechas'))
            return this._tareas;
        return this._tareas.filter(t => !t.hecha);
    }

    /* --------------------------- Ajustes ---------------------------- */

    /**
     * Reacciona a los cambios de configuración sin recargar el shell.
     */
    _conectarSettings() {
        const conectar = (clave, cb) =>
            this._idsSettings.push(this._settings.connect(`changed::${clave}`, cb));

        conectar('ruta', () => this.recargar());
        conectar('mostrar-hechas', () => {
            this._reconstruirMenu();
            this._actualizarInsignia();
        });
        conectar('enable-search', () => this._reconstruirMenu());
        conectar('search-threshold', () => this._reconstruirMenu());
        conectar('panel-badge', () => this._actualizarInsignia());
        conectar('panel-icon', () =>
            (this._icono.icon_name = this._settings.get_string('panel-icon')));
    }

    /* ------------------------ Carga de datos ------------------------ */

    /**
     * Vuelve a leer los archivos y reconstruye el menú.
     */
    recargar() {
        if (this._destruido)
            return;

        this._cancellable.cancel();
        this._cancellable = new Gio.Cancellable();
        const cancellable = this._cancellable;

        escanearTareas(this._settings.get_string('ruta'), cancellable)
            .then(resultado => {
                if (this._destruido || cancellable.is_cancelled() || resultado.motivo === 'cancelado')
                    return;

                this._tareas = resultado.tareas;
                this._archivos = resultado.archivos;
                this._variosArchivos = resultado.archivos.length > 1;
                this._motivoVacio = resultado.ok
                    ? (resultado.motivo === 'vacio' ? 'vacio' : null)
                    : 'inexistente';

                this._reconstruirMenu();
                this._actualizarInsignia();
                this._vigilarArchivos();
            })
            .catch(e => {
                if (this._destruido)
                    return;
                console.error(`[pendientes] Error al leer las tareas: ${e.message}`);
                this._motivoVacio = 'inexistente';
                this._reconstruirMenu();
            });
    }

    /**
     * Vigila los archivos leídos, para que el menú cambie en cuanto edites uno
     * en tu editor.
     *
     * Si todavía no existe ninguno se vigila la carpeta que lo contendría, que
     * es la única forma de enterarse de que se crea.
     */
    _vigilarArchivos() {
        this._pararMonitores();

        const objetivos = new Map();   // ruta -> si es carpeta
        for (const ruta of this._archivos)
            objetivos.set(ruta, false);

        if (objetivos.size === 0)
            objetivos.set(GLib.path_get_dirname(this._ruta), true);

        for (const [ruta, esCarpeta] of objetivos) {
            const file = Gio.File.new_for_path(ruta);
            try {
                const monitor = esCarpeta
                    ? file.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null)
                    : file.monitor_file(Gio.FileMonitorFlags.WATCH_MOVES, null);
                const handlerId = monitor.connect('changed', () => this._recargaDiferida());
                this._monitores.push({monitor, handlerId});
            } catch (e) {
                console.warn(`[pendientes] No se pudo vigilar ${ruta}: ${e.message}`);
            }
        }
    }

    /**
     * Recarga con un pequeño retardo para agrupar ráfagas de eventos.
     */
    _recargaDiferida() {
        if (this._idRecarga)
            GLib.source_remove(this._idRecarga);

        this._idRecarga = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RETARDO_RECARGA_MS, () => {
            this._idRecarga = 0;
            this.recargar();
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Desconecta y suelta todos los FileMonitor.
     */
    _pararMonitores() {
        for (const {monitor, handlerId} of this._monitores) {
            monitor.disconnect(handlerId);
            monitor.cancel();
        }
        this._monitores = [];
    }

    /* ----------------------------- Menú ----------------------------- */

    /**
     * Al abrir: ajustar el alto y poner el foco en el buscador.
     */
    _alAbrirMenu() {
        ajustarAltoLista(this._scroll);

        if (this._buscador && !this._idFoco) {
            this._idFoco = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._idFoco = 0;
                if (!this._destruido && this.menu.isOpen)
                    this._buscador?.enfocar();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    /**
     * Al cerrar: se olvida el filtro y se cierra la fila de acciones.
     */
    _alCerrarMenu() {
        this._cerrarContexto();

        if (this._textoFiltro) {
            this._textoFiltro = '';
            this._buscador?.entrada.set_text('');
            this._aplicarFiltro('');
        }
    }

    /**
     * Rehace el menú completo a partir del estado actual.
     */
    _reconstruirMenu() {
        this.menu.removeAll();
        this._items.clear();
        this._cabeceras = [];
        this._buscador = null;
        this._itemSinCoincidencias = null;
        this._scroll = null;
        this._contexto = null;   // removeAll() ya lo ha destruido

        this._pintarBuscador();
        this._pintarLista();

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addMenuItem(new ItemAcciones([
            {
                icono: 'list-add-symbolic',
                texto: _('Nueva'),
                alPulsar: () => this._nuevaTarea(),
            },
            {
                icono: 'view-refresh-symbolic',
                texto: _('Recargar'),
                alPulsar: () => this.recargar(),
            },
            {
                // «Editar» ahora es lo que se hace en la propia fila, así que
                // este botón dice lo que hace: abrir el archivo fuera.
                icono: 'text-editor-symbolic',
                texto: _('Abrir archivo'),
                alPulsar: () => {
                    this.menu.close();
                    this._editar();
                },
            },
            {
                icono: 'preferences-system-symbolic',
                texto: _('Ajustes'),
                alPulsar: () => {
                    this.menu.close();
                    this._extension.openPreferences();
                },
            },
        ]));
    }

    /**
     * Pinta la lista de tareas dentro de una zona con desplazamiento.
     */
    _pintarLista() {
        ({scroll: this._scroll, seccion: this._seccionLista} = crearListaConScroll(this.menu));

        if (this._motivoVacio === 'inexistente') {
            this._itemInformativo(_('No se encontró:'));
            this._itemInformativo(this._ruta);
            this._itemInformativo(_('«Editar» lo crea con un ejemplo.'));
        } else if (this._motivoVacio === 'vacio') {
            this._itemInformativo(_('No hay ninguna casilla «- [ ]» en el archivo'));
        } else if (this._tareas.length === 0) {
            this._itemInformativo(_('Cargando…'));
        } else if (this._visibles.length === 0) {
            this._itemInformativo(_('Todo hecho.'));
        } else {
            this._pintarGrupos();
        }

        ajustarAltoLista(this._scroll);
    }

    /**
     * Añade las tareas agrupadas por encabezado, en el orden del archivo.
     */
    _pintarGrupos() {
        const grupos = agruparTareas(this._visibles, this._variosArchivos);
        const unSoloGrupo = grupos.length === 1;

        let primero = true;
        for (const grupo of grupos) {
            const itemsDelGrupo = [];

            // Con un solo grupo, la cabecera no dice nada que no se vea ya.
            let cabecera = null;
            if (!unSoloGrupo) {
                cabecera = new PopupMenu.PopupSeparatorMenuItem(grupo.nombre);
                if (primero)
                    cabecera.add_style_class_name('tb-primera-cabecera');
                this._seccionLista.addMenuItem(cabecera);
            }
            primero = false;

            for (const tarea of grupo.tareas) {
                const item = new ItemTarea(tarea, this._variosArchivos);
                item.connect('activate', () => this._alternar(item));
                item.connect('contexto', () => this._alternarContexto(item));
                this._seccionLista.addMenuItem(item);
                this._items.set(tarea.id, item);
                itemsDelGrupo.push(item);
            }

            if (cabecera)
                this._cabeceras.push({cabecera, items: itemsDelGrupo});
        }

        this._itemSinCoincidencias = new PopupMenu.PopupMenuItem(
            _('Ninguna tarea coincide'), {reactive: false, style_class: 'tb-aviso'});
        this._itemSinCoincidencias.visible = false;
        this._seccionLista.addMenuItem(this._itemSinCoincidencias);

        if (this._textoFiltro)
            this._aplicarFiltro(this._textoFiltro);
    }

    /**
     * Añade una línea de texto no pulsable (avisos).
     *
     * @param {string} texto texto a mostrar
     */
    _itemInformativo(texto) {
        this._seccionLista.addMenuItem(
            new PopupMenu.PopupMenuItem(texto, {reactive: false, style_class: 'tb-aviso'}));
    }

    /**
     * Actualiza el contador del panel con las tareas que quedan.
     */
    _actualizarInsignia() {
        if (this._destruido || !this._insignia)
            return;

        const pendientes = this._settings.get_boolean('panel-badge')
            ? this._tareas.filter(t => !t.hecha).length
            : 0;

        pintarInsignia(this._insignia, pendientes);
        this.accessible_name = pendientes > 0
            ? `${_('Pendientes')} — ${pendientes}`
            : _('Pendientes');
    }

    /* --------------------------- Búsqueda ---------------------------- */

    /**
     * Añade el campo de búsqueda si hay suficientes tareas.
     */
    _pintarBuscador() {
        if (!this._settings.get_boolean('enable-search'))
            return;
        if (this._visibles.length < this._settings.get_int('search-threshold'))
            return;

        this._buscador = new ItemBuscador({
            pista: _('Buscar tarea…'),
            texto: this._textoFiltro,
            alEscribir: texto => this._aplicarFiltro(texto),
            alAceptar: () => this._marcarPrimeraVisible(),
            alNavegar: delta => this._moverFoco(delta),
        });
        this.menu.addMenuItem(this._buscador);
    }

    /**
     * Oculta las tareas que no coinciden, y con ellas las cabeceras vacías.
     *
     * @param {string} texto texto del filtro
     */
    _aplicarFiltro(texto) {
        this._textoFiltro = texto;
        const busqueda = normalizar(texto).trim();

        this._cerrarContexto();

        let visibles = 0;
        for (const item of this._items.values()) {
            const {texto: contenido, grupo, archivo} = item.tarea;
            const heno = normalizar(`${contenido} ${grupo} ${archivo}`);
            const coincide = busqueda === '' || heno.includes(busqueda);
            item.visible = coincide;
            if (coincide)
                visibles++;
        }

        for (const {cabecera, items} of this._cabeceras)
            cabecera.visible = items.some(item => item.visible);

        if (this._itemSinCoincidencias)
            this._itemSinCoincidencias.visible = visibles === 0;
    }

    /**
     * Mueve el foco entre las tareas visibles.
     *
     * @param {number} delta +1 para bajar, -1 para subir
     * @returns {boolean} si la tecla queda consumida
     */
    _moverFoco(delta) {
        return moverFoco({
            items: [...this._items.values()],
            delta,
            scroll: this._scroll,
            buscador: this._buscador,
        });
    }

    /**
     * Marca la primera tarea visible (Intro en el buscador).
     */
    _marcarPrimeraVisible() {
        for (const item of this._items.values()) {
            if (!item.visible)
                continue;
            this._alternar(item);
            return;
        }
    }

    /* -------------------------- Marcar ------------------------------- */

    /**
     * Marca o desmarca la tarea de una fila.
     *
     * La fila cambia al momento, sin esperar a que el archivo se relea: la
     * escritura es de unos milisegundos, pero el monitor tarda su retardo en
     * avisar y el menú se vería congelado mientras tanto.
     *
     * @param {ItemTarea} item fila pulsada
     */
    _alternar(item) {
        const tarea = item.tarea;
        const nuevo = !tarea.hecha;

        // El objeto de la tarea es el mismo que guarda la lista, así que el
        // contador del panel ya cuenta bien sin esperar a la recarga.
        item.fijarHecha(nuevo);
        this._actualizarInsignia();

        alternarTarea(tarea, this._cancellableAcciones)
            .then(motivo => {
                if (this._destruido)
                    return;

                if (motivo) {
                    // No se ha tocado el archivo: la fila vuelve a lo que era.
                    item.fijarHecha(!nuevo);
                    this._actualizarInsignia();
                    Main.notifyError('Pendientes', `${_('No se marcó')}: ${motivo}`);
                    this.recargar();
                }
                // Si salió bien no hace falta hacer nada más: el FileMonitor
                // verá el cambio y recargará la lista dentro de un momento.
            })
            .catch(e => {
                if (this._destruido)
                    return;
                item.fijarHecha(!nuevo);
                this._actualizarInsignia();
                Main.notifyError('Pendientes', `${_('No se marcó')}: ${e.message}`);
            });
    }

    /* -------------------------- Menú contextual ---------------------- */

    /**
     * Abre (o cierra) la fila de acciones de una tarea, justo debajo de ella.
     *
     * @param {ItemTarea} item elemento sobre el que se pulsó
     */
    _alternarContexto(item) {
        const yaAbierto = this._contexto?._idTarea === item.tarea.id;
        this._cerrarContexto();
        if (yaAbierto)
            return;

        const tarea = item.tarea;
        this._abrirFilaBajo(item, new ItemAcciones([
            {
                icono: 'document-edit-symbolic',
                texto: _('Editar'),
                alPulsar: () => this._editarTexto(item),
            },
            {
                icono: 'list-add-symbolic',
                texto: _('Añadir debajo'),
                alPulsar: () => this._anadirDebajo(item),
            },
            {
                icono: 'edit-copy-symbolic',
                texto: _('Copiar'),
                alPulsar: () => {
                    St.Clipboard.get_default().set_text(
                        St.ClipboardType.CLIPBOARD, tarea.texto);
                    this._cerrarContexto();
                },
            },
            {
                icono: 'user-trash-symbolic',
                texto: _('Borrar'),
                peligrosa: true,
                alPulsar: () => this._pedirBorrar(item),
            },
        ]));
    }

    /**
     * Pone una fila justo debajo de una tarea, sustituyendo a la que hubiera.
     *
     * @param {ItemTarea} item tarea bajo la que va
     * @param {PopupMenu.PopupBaseMenuItem} fila fila a insertar
     */
    _abrirFilaBajo(item, fila) {
        this._cerrarContexto();
        fila._idTarea = item.tarea.id;

        const posicion = this._seccionLista._getMenuItems().indexOf(item);
        this._seccionLista.addMenuItem(fila, posicion + 1);
        this._contexto = fila;

        // El foco se pide en cuanto la fila está puesta; hacerlo antes no
        // funciona porque el menú todavía la está colocando.
        if (fila.enfocar && !this._idFoco) {
            this._idFoco = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._idFoco = 0;
                if (!this._destruido && this._contexto === fila)
                    fila.enfocar();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    /* --------------------------- Editar ------------------------------ */

    /**
     * Cambia el texto de una tarea desde el propio menú.
     *
     * @param {ItemTarea} item tarea a editar
     */
    _editarTexto(item) {
        const tarea = item.tarea;

        this._abrirFilaBajo(item, new ItemEntrada({
            texto: tarea.texto,
            pista: _('Texto de la tarea'),
            alCancelar: () => this._cerrarContexto(),
            alAceptar: texto => {
                this._cerrarContexto();
                if (texto.trim() === tarea.texto)
                    return;
                this._aplicar(
                    editarTexto(tarea, texto, this._cancellableAcciones),
                    _('No se pudo cambiar el texto'));
            },
        }));
    }

    /**
     * Añade una tarea justo debajo de otra, con su misma sangría.
     *
     * @param {ItemTarea} item tarea de referencia
     */
    _anadirDebajo(item) {
        const tarea = item.tarea;

        this._abrirFilaBajo(item, new ItemEntrada({
            pista: _('Tarea nueva, debajo de esta'),
            alCancelar: () => this._cerrarContexto(),
            alAceptar: texto => {
                this._cerrarContexto();
                this._aplicar(
                    anadirTarea({ruta: tarea.ruta, despuesDe: tarea}, texto,
                        this._cancellableAcciones),
                    _('No se pudo añadir la tarea'));
            },
        }));
    }

    /**
     * Pregunta antes de borrar, que es lo único que no se puede deshacer desde
     * el menú: una tarea marcada se desmarca, pero una borrada ya no está.
     *
     * @param {ItemTarea} item tarea a borrar
     */
    _pedirBorrar(item) {
        const tarea = item.tarea;

        this._abrirFilaBajo(item, new ItemConfirmacion({
            pregunta: `¿${_('Borrar')} «${tarea.texto}»?`,
            textoSi: _('Sí'),
            textoNo: _('No'),
            alCancelar: () => this._cerrarContexto(),
            alConfirmar: () => {
                this._cerrarContexto();
                this._aplicar(
                    borrarTarea(tarea, this._cancellableAcciones),
                    _('No se pudo borrar la tarea'));
            },
        }));
    }

    /**
     * Añade una tarea al final, desde el pie del menú.
     *
     * Va al archivo de la última tarea de la lista, que con un solo archivo
     * —lo normal— es el de siempre. Si todavía no hay ninguna, al configurado,
     * que se crea con un ejemplo si hace falta.
     */
    _nuevaTarea() {
        const ultima = this._tareas[this._tareas.length - 1];
        const ruta = ultima ? ultima.ruta : (this._archivos[0] ?? this._ruta);

        const entrada = new ItemEntrada({
            pista: _('Tarea nueva'),
            alCancelar: () => this._cerrarContexto(),
            alAceptar: texto => {
                this._cerrarContexto();

                try {
                    crearArchivoSiFalta(ruta);
                } catch (e) {
                    Main.notifyError('Pendientes',
                        `${_('No se pudo crear')} ${ruta}: ${e.message}`);
                    return;
                }

                this._aplicar(
                    anadirTarea({ruta}, texto, this._cancellableAcciones),
                    _('No se pudo añadir la tarea'));
            },
        });

        // Al final de la lista, que es donde va a aparecer la tarea.
        this._cerrarContexto();
        this._seccionLista.addMenuItem(entrada);
        this._contexto = entrada;

        if (!this._idFoco) {
            this._idFoco = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._idFoco = 0;
                if (!this._destruido && this._contexto === entrada)
                    entrada.enfocar();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    /**
     * Espera a una operación sobre el archivo y avisa si no salió.
     *
     * Cuando sale bien no hay que hacer nada: el FileMonitor ve el cambio y
     * recarga la lista dentro de un momento.
     *
     * @param {Promise<string|null>} promesa operación de tareas.js
     * @param {string} queHacia qué se estaba intentando, para el aviso
     */
    _aplicar(promesa, queHacia) {
        promesa
            .then(motivo => {
                if (this._destruido || !motivo)
                    return;
                Main.notifyError('Pendientes', `${queHacia}: ${motivo}`);
                this.recargar();
            })
            .catch(e => {
                if (!this._destruido)
                    Main.notifyError('Pendientes', `${queHacia}: ${e.message}`);
            });
    }

    /**
     * Quita la fila de acciones, si hay alguna abierta.
     */
    _cerrarContexto() {
        this._contexto?.destroy();
        this._contexto = null;
    }

    /* -------------------------- Lanzamiento -------------------------- */

    /**
     * Abre un archivo en el editor de texto. Si el principal todavía no existe,
     * se crea con un ejemplo comentado.
     *
     * @param {string} [ruta] archivo a abrir; por omisión, el configurado
     */
    _editar(ruta = null) {
        let archivo = ruta;

        if (!archivo) {
            archivo = this._ruta;
            // Con una carpeta configurada no hay «el archivo»: se abre ella.
            if (this._archivos.length === 1)
                archivo = this._archivos[0];

            try {
                if (!GLib.file_test(archivo, GLib.FileTest.EXISTS) &&
                    crearArchivoSiFalta(archivo)) {
                    Main.notify('Pendientes',
                        `${_('Se ha creado')} ${archivo} ${_('con un ejemplo')}`);
                }
            } catch (e) {
                Main.notifyError('Pendientes', `${_('No se pudo crear')} ${archivo}: ${e.message}`);
                return;
            }
        }

        const configurado = this._settings.get_string('editor-command');
        if (this._lanzar([configurado, ...ALTERNATIVAS_EDITOR], {'%f': archivo}))
            return;

        // Reserva: la aplicación predeterminada del sistema.
        try {
            Gio.AppInfo.launch_default_for_uri(
                Gio.File.new_for_path(archivo).get_uri(), null);
        } catch (e) {
            Main.notifyError('Pendientes', `${_('No se pudo abrir')} ${archivo}: ${e.message}`);
        }
    }

    /**
     * Ejecuta la primera plantilla cuyo programa esté instalado.
     *
     * La sustitución se hace DESPUÉS de trocear la orden, de modo que una ruta
     * con espacios no pueda convertirse en argumentos extra.
     *
     * @param {string[]} plantillas órdenes candidatas, en orden de preferencia
     * @param {object} valores marcadores de sustitución
     * @returns {boolean} si se pudo lanzar alguna
     */
    _lanzar(plantillas, valores) {
        for (const plantilla of plantillas) {
            if (!plantilla)
                continue;

            let argv;
            try {
                const [ok, troceado] = GLib.shell_parse_argv(plantilla);
                if (!ok || troceado.length === 0)
                    continue;
                argv = troceado.map(arg => arg.replace(/%[f]/g, marca => valores[marca] ?? marca));
            } catch (e) {
                console.warn(`[pendientes] Comando mal escrito «${plantilla}»: ${e.message}`);
                continue;
            }

            if (!GLib.find_program_in_path(argv[0]))
                continue;

            try {
                Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
                return true;
            } catch (e) {
                console.warn(`[pendientes] Falló «${argv.join(' ')}»: ${e.message}`);
            }
        }
        return false;
    }

    /* --------------------------- Limpieza ---------------------------- */

    /**
     * Libera absolutamente todo. Se llama desde disable().
     */
    destroy() {
        this._destruido = true;

        if (this._idRecarga) {
            GLib.source_remove(this._idRecarga);
            this._idRecarga = 0;
        }
        if (this._idFoco) {
            GLib.source_remove(this._idFoco);
            this._idFoco = 0;
        }

        this._cancellable.cancel();
        this._cancellableAcciones.cancel();
        this._pararMonitores();

        for (const id of this._idsSettings)
            this._settings.disconnect(id);
        this._idsSettings = [];

        if (this._idAbrir) {
            this.menu.disconnect(this._idAbrir);
            this._idAbrir = 0;
        }
        if (this._idTeclas) {
            this.menu.actor.disconnect(this._idTeclas);
            this._idTeclas = 0;
        }

        this._items.clear();
        this._cabeceras = [];
        this._buscador = null;
        this._itemSinCoincidencias = null;
        this._scroll = null;
        this._seccionLista = null;
        this._contexto = null;
        this._insignia = null;
        this._tareas = [];
        this._archivos = [];
        this._settings = null;
        this._extension = null;

        super.destroy();
    }
});

/* -------------------------------------------------------------------------
 * Punto de entrada de la extensión (API moderna de GNOME 45+)
 * ------------------------------------------------------------------------- */
export default class PendientesExtension extends Extension {
    /**
     * Crea el indicador y lo pone donde digan los ajustes.
     */
    enable() {
        this._sitio = new SitioEnLaBarra({
            extension: this,
            crear: () => new IndicadorPendientes(this),
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

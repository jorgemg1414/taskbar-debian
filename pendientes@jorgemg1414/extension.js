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
    anadirGrupo, borrarTarea, moverTarea, sangrarTarea, limpiarHechas,
    crearArchivoSiFalta, expandirRuta, SIN_SITIO,
} from './tareas.js';
import {SitioEnLaBarra} from './barra.js';
import {
    ItemAcciones, ItemBuscador, ItemConfirmacion, crearInsignia, pintarInsignia,
    crearListaConScroll, ajustarAltoLista, asegurarVisible, moverFoco, normalizar,
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
 * Cabecera de grupo: el nombre, la raya y un «+» para apuntar ahí dentro
 * ------------------------------------------------------------------------- */
const ItemCabecera = GObject.registerClass({
    Signals: {'anadir': {}},
}, class ItemCabecera extends PopupMenu.PopupSeparatorMenuItem {
    /**
     * El «+» de la cabecera es lo que hace que una tarea vaya al grupo que te
     * interesa: «Nueva», al final del archivo, siempre caía en el último.
     *
     * @param {string} texto nombre del grupo
     */
    _init(texto) {
        super._init(texto);

        this._boton = new St.Button({
            style_class: 'pendientes-mas',
            can_focus: true,
            accessible_name: `${_('Añadir en')} ${texto}`,
        });
        this._boton.set_child(new St.Icon({
            icon_name: 'list-add-symbolic',
            style_class: 'pendientes-mas-icono',
        }));
        this._boton.connect('clicked', () => this.emit('anadir'));
        this.add_child(this._boton);
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

            // Las flechas se quedan aquí. El menú las usa para recorrer la
            // lista, y si se dejan subir te sacan del campo a media frase; en
            // un campo de una línea no hacen otra cosa útil.
            if (tecla === Clutter.KEY_Down || tecla === Clutter.KEY_Up)
                return Clutter.EVENT_STOP;

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
        // Tarea bajo la que está abierta la fila de acciones. Se guarda por
        // texto y no por línea para que sobreviva a mover la tarea.
        this._ancla = null;
        this._recargaPendiente = false;
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

        // Con un campo de texto abierto, rehacer el menú se llevaría por
        // delante la frase a medio escribir. Se espera a que se cierre.
        if (this._contexto instanceof ItemEntrada) {
            this._recargaPendiente = true;
            return;
        }

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
                texto: _('Tarea'),
                alPulsar: () => this._nuevaTarea(),
            },
            {
                icono: 'format-justify-left-symbolic',
                texto: _('Grupo'),
                alPulsar: () => this._nuevoGrupo(),
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
                texto: _('Archivo'),
                alPulsar: () => {
                    this.menu.close();
                    this._editar();
                },
            },
            {
                // Sin nombre: con cinco botones el pie se iba de ancho, y una
                // rueda dentada es lo único que no hace falta explicar.
                icono: 'preferences-system-symbolic',
                texto: _('Ajustes'),
                soloIcono: true,
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

        // También cuando no queda ninguna pendiente: es justo entonces cuando
        // el archivo está lleno de casillas marcadas.
        this._pintarLimpieza();

        ajustarAltoLista(this._scroll);
    }

    /**
     * Al final de la lista, la forma de barrer las hechas sin abrir el editor.
     *
     * Solo aparece cuando hay alguna: por omisión las hechas ni se ven, así que
     * si no se dijera aquí no habría manera de enterarse de que se acumulan.
     */
    _pintarLimpieza() {
        const hechas = this._tareas.filter(t => t.hecha);
        if (hechas.length === 0)
            return;

        const fila = new PopupMenu.PopupImageMenuItem(
            hechas.length === 1
                ? _('Quitar del archivo la tarea hecha')
                : `${_('Quitar del archivo las')} ${hechas.length} ${_('tareas hechas')}`,
            'edit-clear-all-symbolic');

        fila.connect('activate', () => this._pedirLimpiar(fila, hechas));
        this._seccionLista.addMenuItem(fila);
    }

    /**
     * Pregunta antes de barrer, que se lleva varias líneas de golpe.
     *
     * @param {PopupMenu.PopupBaseMenuItem} fila fila desde la que se pidió
     * @param {object[]} hechas tareas marcadas que hay ahora mismo
     */
    _pedirLimpiar(fila, hechas) {
        this._abrirFilaBajo(fila, new ItemConfirmacion({
            pregunta: `¿${_('Quitar')} ${hechas.length} ${_('del archivo')}?`,
            textoSi: _('Sí'),
            textoNo: _('No'),
            alCancelar: () => this._cerrarContexto(),
            alConfirmar: () => {
                this._cerrarContexto();
                this._limpiar(hechas);
            },
        }));
    }

    /**
     * Quita las tareas hechas de cada archivo del que salieron.
     *
     * Se le dice a cada uno cuántas se contaron en él: si entretanto cambió, no
     * se toca. Y avisa al terminar, porque con las hechas ocultas —lo de
     * siempre— no se vería lo que se ha llevado.
     *
     * @param {object[]} hechas tareas marcadas que había al preguntar
     */
    _limpiar(hechas) {
        const porArchivo = new Map();
        for (const tarea of hechas)
            porArchivo.set(tarea.ruta, (porArchivo.get(tarea.ruta) ?? 0) + 1);

        Promise.all([...porArchivo].map(([ruta, cuantas]) =>
            limpiarHechas(ruta, cuantas, this._cancellableAcciones)))
            .then(resultados => {
                if (this._destruido)
                    return;

                const borradas = resultados.reduce((n, r) => n + r.borradas, 0);
                const conservadas = resultados.reduce((n, r) => n + r.conservadas, 0);
                const motivo = resultados.map(r => r.motivo).find(Boolean);

                if (motivo && borradas === 0) {
                    Main.notifyError('Pendientes', `${_('No se limpió')}: ${motivo}`);
                } else {
                    const cola = conservadas > 0
                        ? ` (${conservadas} ${_('se quedan: tienen subtareas sin hacer')})`
                        : '';
                    Main.notify('Pendientes',
                        `${_('Quitadas')} ${borradas} ${_('tareas hechas')}${cola}`);
                }

                this.recargar();
            })
            .catch(e => {
                if (!this._destruido)
                    Main.notifyError('Pendientes', `${_('No se limpió')}: ${e.message}`);
            });
    }

    /**
     * Añade las tareas agrupadas por encabezado, en el orden del archivo.
     */
    _pintarGrupos() {
        const grupos = agruparTareas(this._visibles, this._variosArchivos);
        // Con un solo grupo en todo el archivo la cabecera no dice nada que no
        // se vea ya. Se miran todas las tareas y no solo las visibles: si un
        // grupo está entero hecho, su cabecera desaparecería y con ella el «+».
        const unSoloGrupo =
            agruparTareas(this._tareas, this._variosArchivos).length === 1;

        let primero = true;
        for (const grupo of grupos) {
            const itemsDelGrupo = [];

            let cabecera = null;
            if (!unSoloGrupo) {
                cabecera = new ItemCabecera(grupo.nombre);
                cabecera.connect('anadir', () => this._anadirEnGrupo(grupo, itemsDelGrupo));
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

        this._restaurarAcciones();
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

        // A la escritura se le pasa una copia con el estado que tenía la tarea
        // cuando se leyó el archivo, que es contra lo que comprueba que nadie
        // la haya marcado por otro lado. La de la lista se pinta ya, y pintarla
        // le cambia ese estado.
        const comoEstaba = {...tarea};

        // El objeto de la tarea es el mismo que guarda la lista, así que el
        // contador del panel ya cuenta bien sin esperar a la recarga.
        item.fijarHecha(nuevo);
        this._actualizarInsignia();

        alternarTarea(comoEstaba, this._cancellableAcciones)
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
        if (!yaAbierto)
            this._abrirAcciones(item);
    }

    /**
     * Pinta la fila de acciones de una tarea y la deja anclada a ella.
     *
     * Las cuatro flechas van sin nombre y al principio: mover y sangrar son
     * cosas de sitio, se entienden por el dibujo y así queda hueco para las
     * cuatro que sí necesitan palabras.
     *
     * @param {ItemTarea} item tarea a la que pertenece la fila
     * @param {number} [boton] botón al que devolver el foco, o -1 para ninguno
     */
    _abrirAcciones(item, boton = -1) {
        const tarea = item.tarea;

        const fila = new ItemAcciones([
            {
                icono: 'go-up-symbolic',
                texto: _('Subir'),
                soloIcono: true,
                alPulsar: () => this._mover(item, -1, 0),
            },
            {
                icono: 'go-down-symbolic',
                texto: _('Bajar'),
                soloIcono: true,
                alPulsar: () => this._mover(item, 1, 1),
            },
            {
                icono: 'format-indent-more-symbolic',
                texto: _('Convertir en subtarea'),
                soloIcono: true,
                alPulsar: () => this._sangrar(item, 1, 2),
            },
            {
                icono: 'format-indent-less-symbolic',
                texto: _('Sacar del margen'),
                soloIcono: true,
                alPulsar: () => this._sangrar(item, -1, 3),
            },
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
        ]);

        this._abrirFilaBajo(item, fila);

        // El ancla es por texto y no por línea: mover una tarea le cambia la
        // línea, y es justo entonces cuando la fila tiene que seguir ahí.
        this._ancla = {ruta: tarea.ruta, texto: tarea.texto, boton};
        if (boton >= 0)
            this._enfocarFila(fila, () => fila.enfocarBoton(boton));
    }

    /**
     * Vuelve a poner la fila de acciones donde estaba después de rehacer la
     * lista, que es lo que pasa cada vez que se mueve una tarea.
     */
    _restaurarAcciones() {
        const ancla = this._ancla;
        if (!ancla)
            return;

        const item = [...this._items.values()].find(
            i => i.tarea.ruta === ancla.ruta && i.tarea.texto === ancla.texto);

        if (!item) {
            this._ancla = null;
            return;
        }

        this._abrirAcciones(item, ancla.boton);

        // El foco se devuelve una sola vez, la de justo después de mover: el
        // monitor vuelve a recargar medio segundo más tarde y para entonces
        // puedes estar escribiendo en el buscador.
        this._ancla.boton = -1;
    }

    /* --------------------------- Mover ------------------------------- */

    /**
     * Sube o baja una tarea dentro de su grupo.
     *
     * @param {ItemTarea} item tarea a mover
     * @param {number} delta -1 para subirla, +1 para bajarla
     * @param {number} boton botón que se pulsó, para devolverle el foco
     */
    _mover(item, delta, boton) {
        this._ancla = {ruta: item.tarea.ruta, texto: item.tarea.texto, boton};
        this._aplicar(
            moverTarea(item.tarea, delta, this._cancellableAcciones),
            _('No se pudo mover la tarea'), true);
    }

    /**
     * Convierte una tarea en subtarea de la de encima, o la saca de serlo.
     *
     * @param {ItemTarea} item tarea a sangrar
     * @param {number} delta +1 para sangrarla, -1 para sacarla
     * @param {number} boton botón que se pulsó, para devolverle el foco
     */
    _sangrar(item, delta, boton) {
        this._ancla = {ruta: item.tarea.ruta, texto: item.tarea.texto, boton};
        this._aplicar(
            sangrarTarea(item.tarea, delta, this._cancellableAcciones),
            _('No se pudo sangrar la tarea'), true);
    }

    /**
     * Pone una fila justo debajo de una tarea, sustituyendo a la que hubiera.
     *
     * @param {ItemTarea} item tarea bajo la que va
     * @param {PopupMenu.PopupBaseMenuItem} fila fila a insertar
     */
    _abrirFilaBajo(item, fila) {
        this._cerrarContexto();
        // La fila de limpiar no es una tarea, y no pasa nada: solo sirve para
        // saber si el clic derecho vuelve a caer sobre la misma.
        fila._idTarea = item.tarea?.id ?? null;

        const posicion = this._seccionLista._getMenuItems().indexOf(item);
        this._seccionLista.addMenuItem(fila, posicion + 1);
        this._contexto = fila;

        if (fila.enfocar)
            this._enfocarFila(fila, () => fila.enfocar());
    }

    /**
     * Pone el foco en una fila recién abierta y la trae a la parte visible.
     *
     * Se hace en cuanto el menú está quieto y no antes: mientras la está
     * colocando, ni el foco ni la posición valen todavía.
     *
     * @param {PopupMenu.PopupBaseMenuItem} fila fila que acaba de abrirse
     * @param {Function} enfocar qué enfocar de la fila
     */
    _enfocarFila(fila, enfocar) {
        if (this._idFoco)
            return;

        this._idFoco = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idFoco = 0;
            if (!this._destruido && this._contexto === fila) {
                enfocar();
                // Con la lista larga, la fila puede haber quedado fuera de la
                // parte visible: se sube hasta ella.
                asegurarVisible(this._scroll, fila);
            }
            return GLib.SOURCE_REMOVE;
        });
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
     * Añade una tarea al final del grupo que la pidió.
     *
     * El «+» de la cabecera es lo que evita tener que abrir el editor para
     * apuntar algo en un grupo que no sea el último del archivo. Va con la
     * sangría de la primera tarea del grupo, no con la de la última: si la
     * última es una subtarea, la nueva no tiene por qué serlo.
     *
     * @param {{nombre: string, tareas: object[]}} grupo grupo de la cabecera
     * @param {ItemTarea[]} items filas de ese grupo, en el mismo orden
     */
    _anadirEnGrupo(grupo, items) {
        const ultima = grupo.tareas[grupo.tareas.length - 1];
        const sangria = grupo.tareas[0].sangriaTexto;

        this._abrirFilaBajo(items[items.length - 1], new ItemEntrada({
            pista: `${_('Tarea nueva en')} «${grupo.nombre}»`,
            alCancelar: () => this._cerrarContexto(),
            alAceptar: texto => {
                this._cerrarContexto();
                this._aplicar(
                    anadirTarea({ruta: ultima.ruta, despuesDe: ultima, sangria}, texto,
                        this._cancellableAcciones),
                    _('No se pudo añadir la tarea'));
            },
        }));
    }

    /**
     * Añade una tarea al final del archivo, desde el pie del menú.
     */
    _nuevaTarea() {
        const ruta = this._rutaParaAnadir();

        this._entradaAlFinal(_('Tarea nueva'), texto => {
            this._cerrarContexto();
            if (!this._asegurarArchivo(ruta))
                return;

            this._aplicar(
                anadirTarea({ruta}, texto, this._cancellableAcciones),
                _('No se pudo añadir la tarea'));
        });
    }

    /**
     * Crea un grupo nuevo al final del archivo: primero el nombre, luego su
     * primera tarea.
     *
     * Son dos pasos porque van juntos en el archivo: un encabezado sin ninguna
     * tarea debajo no aparecería en el menú, que saca los grupos de las tareas.
     */
    _nuevoGrupo() {
        const ruta = this._rutaParaAnadir();

        this._entradaAlFinal(_('Grupo nuevo'), titulo => {
            const nombre = titulo.trim();
            if (nombre === '') {
                this._cerrarContexto();
                return;
            }

            this._entradaAlFinal(`${_('Primera tarea de')} «${nombre}»`, texto => {
                this._cerrarContexto();
                if (!this._asegurarArchivo(ruta))
                    return;

                this._aplicar(
                    anadirGrupo(ruta, nombre, texto, this._cancellableAcciones),
                    _('No se pudo crear el grupo'));
            });
        });
    }

    /**
     * Abre un campo de texto al final de la lista, que es donde va a aparecer
     * lo que se escriba.
     *
     * @param {string} pista texto de sugerencia del campo
     * @param {Function} alAceptar recibe el texto al pulsar Intro
     */
    _entradaAlFinal(pista, alAceptar) {
        const entrada = new ItemEntrada({
            pista,
            alAceptar,
            alCancelar: () => this._cerrarContexto(),
        });

        this._cerrarContexto();
        this._seccionLista.addMenuItem(entrada);
        this._contexto = entrada;
        this._enfocarFila(entrada, () => entrada.enfocar());
    }

    /**
     * Archivo al que van las tareas y los grupos que se añaden desde el pie.
     *
     * El de la última tarea de la lista, que con un solo archivo —lo normal—
     * es el de siempre. Si todavía no hay ninguna, el configurado.
     *
     * @returns {string} ruta del archivo
     */
    _rutaParaAnadir() {
        const ultima = this._tareas[this._tareas.length - 1];
        return ultima ? ultima.ruta : (this._archivos[0] ?? this._ruta);
    }

    /**
     * Crea el archivo con un ejemplo si todavía no está, para poder escribir en
     * él a continuación.
     *
     * @param {string} ruta archivo en el que se va a escribir
     * @returns {boolean} si se puede seguir
     */
    _asegurarArchivo(ruta) {
        try {
            crearArchivoSiFalta(ruta);
            return true;
        } catch (e) {
            Main.notifyError('Pendientes', `${_('No se pudo crear')} ${ruta}: ${e.message}`);
            return false;
        }
    }

    /**
     * Espera a una operación sobre el archivo y avisa si no salió.
     *
     * Cuando sale bien no suele hacer falta nada más: el FileMonitor ve el
     * cambio y recarga la lista dentro de un momento. Mover y sangrar sí piden
     * la recarga en el acto, porque la siguiente pulsación de la flecha va
     * sobre una tarea que ya ha cambiado de línea.
     *
     * @param {Promise<string|null>} promesa operación de tareas.js
     * @param {string} queHacia qué se estaba intentando, para el aviso
     * @param {boolean} [recargarAhora] si se relee sin esperar al monitor
     */
    _aplicar(promesa, queHacia, recargarAhora = false) {
        promesa
            .then(motivo => {
                if (this._destruido || motivo === SIN_SITIO)
                    return;

                if (motivo) {
                    Main.notifyError('Pendientes', `${queHacia}: ${motivo}`);
                    this.recargar();
                } else if (recargarAhora) {
                    this.recargar();
                }
            })
            .catch(e => {
                if (!this._destruido)
                    Main.notifyError('Pendientes', `${queHacia}: ${e.message}`);
            });
    }

    /**
     * Quita la fila que hubiera abierta bajo una tarea.
     */
    _cerrarContexto() {
        const eraEntrada = this._contexto instanceof ItemEntrada;

        this._contexto?.destroy();
        this._contexto = null;
        this._ancla = null;

        // La recarga que se dejó en espera para no borrar lo que se estaba
        // escribiendo ya se puede hacer.
        if (eraEntrada && this._recargaPendiente) {
            this._recargaPendiente = false;
            this.recargar();
        }
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
        this._ancla = null;
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

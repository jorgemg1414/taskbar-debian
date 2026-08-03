/*
 * extension.js — VNC Menu para GNOME Shell 48 (ESM).
 *
 * Indicador en la barra superior con las conexiones VNC guardadas en una
 * carpeta. Al pulsar una entrada se lanza el cliente VNC con Gio.Subprocess.
 *
 * Todo lo que se crea aquí (indicador, monitores de archivo, temporizadores y
 * cancelables) se destruye en disable(), como exige GNOME.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {escanearConexiones, agruparConexiones, expandirRuta, GRUPO_SIN_NOMBRE} from './connections.js';
import {ComprobadorPuertos, ESTADO} from './checker.js';

// Milisegundos que se espera tras un cambio en la carpeta antes de recargar
// (los gestores de archivos generan varios eventos seguidos).
const RETARDO_RECARGA_MS = 700;

// Clientes alternativos, en orden, por si el comando configurado no existe.
const ALTERNATIVAS_VNC = [
    'remmina -c vnc://%h:%p',
    'vncviewer %h:%p',
    'xtigervncviewer %h:%p',
    'gvncviewer %h:%p',
];
const ALTERNATIVAS_REMMINA = ['remmina -c %f'];

// Parte del alto de la pantalla que puede ocupar la lista de conexiones. El
// resto queda para el buscador, el pie y los márgenes del menú.
const PROPORCION_ALTO_LISTA = 0.6;

/* -------------------------------------------------------------------------
 * Elemento de menú de una conexión: punto de estado + nombre + host:puerto
 * ------------------------------------------------------------------------- */
const ItemConexion = GObject.registerClass(
class ItemConexion extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {object} conexion conexión a representar
     * @param {boolean} mostrarHost si se muestra "host:puerto" a la derecha
     */
    _init(conexion, mostrarHost) {
        super._init();

        this.conexion = conexion;

        // Punto de disponibilidad (verde/rojo/gris). El color va en la hoja de estilos.
        this._punto = new St.Widget({
            style_class: 'vnc-punto vnc-punto-desconocido',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._punto);

        this._etiqueta = new St.Label({
            text: conexion.nombre,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._etiqueta);
        // Necesario para que el lector de pantalla anuncie el elemento.
        this.label_actor = this._etiqueta;

        if (mostrarHost) {
            this._host = new St.Label({
                text: `${conexion.host}:${conexion.port}`,
                style_class: 'vnc-host',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._host);
        }
    }

    /**
     * Cambia el color del punto según el estado.
     *
     * @param {string} estado valor de ESTADO
     */
    fijarEstado(estado) {
        const clases = {
            [ESTADO.ARRIBA]: 'vnc-punto vnc-punto-arriba',
            [ESTADO.ABAJO]: 'vnc-punto vnc-punto-abajo',
            [ESTADO.COMPROBANDO]: 'vnc-punto vnc-punto-comprobando',
            [ESTADO.DESCONOCIDO]: 'vnc-punto vnc-punto-desconocido',
        };
        this._punto.style_class = clases[estado] ?? clases[ESTADO.DESCONOCIDO];

        const textos = {
            [ESTADO.ARRIBA]: _('disponible'),
            [ESTADO.ABAJO]: _('sin respuesta'),
            [ESTADO.COMPROBANDO]: _('comprobando…'),
            [ESTADO.DESCONOCIDO]: _('estado desconocido'),
        };
        this.accessible_name = `${this.conexion.nombre} — ${textos[estado] ?? ''}`;
    }
});

/* -------------------------------------------------------------------------
 * Campo de búsqueda para filtrar las conexiones escribiendo
 * ------------------------------------------------------------------------- */
const ItemBuscador = GObject.registerClass(
class ItemBuscador extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {object} opciones opciones del buscador
     * @param {string} opciones.texto texto inicial del filtro
     * @param {Function} opciones.alEscribir callback con el texto escrito
     * @param {Function} opciones.alAceptar callback al pulsar Intro
     */
    _init({texto = '', alEscribir, alAceptar}) {
        // No es activable ni enfocable: el foco lo lleva el campo de texto.
        super._init({reactive: false, activate: false, hover: false, can_focus: false});

        this.entrada = new St.Entry({
            style_class: 'vnc-buscador',
            hint_text: _('Buscar conexión…'),
            can_focus: true,
            x_expand: true,
        });
        this.entrada.set_primary_icon(new St.Icon({
            style_class: 'vnc-buscador-icono',
            icon_name: 'edit-find-symbolic',
        }));
        this.entrada.set_text(texto);
        this.add_child(this.entrada);

        this.entrada.clutter_text.connect('text-changed',
            () => alEscribir(this.entrada.get_text()));

        // Intro conecta con la primera coincidencia visible.
        this.entrada.clutter_text.connect('activate', () => alAceptar());

        // Escape limpia el filtro; si ya está vacío, deja que el menú se cierre.
        this.entrada.clutter_text.connect('key-press-event', (_actor, evento) => {
            if (evento.get_key_symbol() === Clutter.KEY_Escape &&
                this.entrada.get_text() !== '') {
                this.entrada.set_text('');
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
 * Fila de acciones: varios botones icono+texto repartidos en una sola línea
 * ------------------------------------------------------------------------- */
const ItemAcciones = GObject.registerClass(
class ItemAcciones extends PopupMenu.PopupBaseMenuItem {
    /**
     * Tres entradas de menú ocupaban tres filas y dejaban el pie pegado al
     * borde de la pantalla; en horizontal ocupan una sola.
     *
     * @param {{icono: string, texto: string, alPulsar: Function}[]} acciones botones a pintar
     */
    _init(acciones) {
        // No es activable: quien recibe los clics es cada botón.
        super._init({
            reactive: false,
            activate: false,
            hover: false,
            can_focus: false,
            style_class: 'vnc-acciones',
        });

        for (const {icono, texto, alPulsar} of acciones) {
            const boton = new St.Button({
                style_class: 'vnc-accion',
                can_focus: true,
                x_expand: true,
                accessible_name: texto,
            });

            const caja = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            caja.add_child(new St.Icon({
                icon_name: icono,
                style_class: 'vnc-accion-icono',
                y_align: Clutter.ActorAlign.CENTER,
            }));
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
 * Indicador del panel
 * ------------------------------------------------------------------------- */
const IndicadorVnc = GObject.registerClass(
class IndicadorVnc extends PanelMenu.Button {
    /**
     * @param {Extension} extension instancia de la extensión (settings, openPreferences)
     */
    _init(extension) {
        super._init(0.5, 'VNC Menu');

        this._extension = extension;
        this._settings = extension.getSettings();

        // Estado interno.
        this._conexiones = [];
        this._items = new Map();        // id de conexión -> ItemConexion
        this._motivoVacio = null;       // 'inexistente' | 'vacia' | null
        this._monitores = [];           // {monitor, handlerId}
        this._idsSettings = [];
        this._cabeceras = [];           // {cabecera, items} por grupo, para filtrar
        this._buscador = null;          // ItemBuscador, si procede
        this._itemSinCoincidencias = null;
        this._scroll = null;            // zona con desplazamiento de la lista
        this._seccionLista = null;      // sección donde viven las conexiones
        this._textoFiltro = '';
        this._idRecarga = 0;            // timeout de rebote del FileMonitor
        this._idIntervaloMenu = 0;      // refresco mientras el menú está abierto
        this._idIntervaloFondo = 0;     // comprobación con el menú cerrado
        this._idFoco = 0;               // idle para enfocar el buscador
        this._cancellable = new Gio.Cancellable();
        this._destruido = false;

        this._icono = new St.Icon({
            icon_name: this._settings.get_string('panel-icon'),
            style_class: 'system-status-icon',
        });
        this.add_child(this._icono);

        this._comprobador = new ComprobadorPuertos({
            timeout: this._settings.get_int('check-timeout'),
            alCambiar: (id, estado) => this._items.get(id)?.fijarEstado(estado),
        });

        // El estado se consulta al abrir el menú y se deja de consultar al
        // cerrarlo: así no se toca la red cuando nadie está mirando.
        this._idAbrir = this.menu.connect('open-state-changed', (_menu, abierto) => {
            if (abierto)
                this._alAbrirMenu();
            else
                this._alCerrarMenu();
        });

        this._conectarSettings();
        this._programarIntervaloFondo();
        this._reconstruirMenu();   // pinta el estado «cargando»
        this.recargar();
    }

    /**
     * Ruta absoluta de la carpeta de conexiones según los ajustes.
     *
     * @returns {string} ruta expandida
     */
    get _carpeta() {
        return expandirRuta(this._settings.get_string('connections-dir'));
    }

    /* --------------------------- Ajustes ---------------------------- */

    /**
     * Reacciona a los cambios de configuración sin recargar el shell.
     */
    _conectarSettings() {
        const conectar = (clave, cb) =>
            this._idsSettings.push(this._settings.connect(`changed::${clave}`, cb));

        conectar('connections-dir', () => this.recargar());
        conectar('show-host', () => this._reconstruirMenu());
        conectar('enable-search', () => this._reconstruirMenu());
        conectar('search-threshold', () => this._reconstruirMenu());
        conectar('panel-icon', () =>
            (this._icono.icon_name = this._settings.get_string('panel-icon')));
        conectar('check-timeout', () =>
            (this._comprobador.timeout = this._settings.get_int('check-timeout')));
        conectar('check-interval', () => {
            if (this.menu.isOpen)
                this._programarIntervaloMenu();
        });
        conectar('background-check-interval', () => this._programarIntervaloFondo());
        conectar('enable-checks', () => {
            this._programarIntervaloFondo();
            if (!this._settings.get_boolean('enable-checks')) {
                this._pararIntervaloMenu();
                this._comprobador.cancelarPendientes();
            } else if (this.menu.isOpen) {
                this._alAbrirMenu();
            }
            this._reconstruirMenu();
        });
    }

    /* ------------------------ Carga de datos ------------------------ */

    /**
     * Vuelve a escanear la carpeta y reconstruye el menú.
     */
    recargar() {
        if (this._destruido)
            return;

        // Se cancela cualquier escaneo anterior todavía en vuelo.
        this._cancellable.cancel();
        this._cancellable = new Gio.Cancellable();
        const cancellable = this._cancellable;

        escanearConexiones(this._carpeta, cancellable)
            .then(resultado => {
                if (this._destruido || cancellable.is_cancelled() || resultado.motivo === 'cancelado')
                    return;

                this._conexiones = resultado.conexiones;
                this._motivoVacio = resultado.ok
                    ? (resultado.motivo === 'vacia' ? 'vacia' : null)
                    : 'inexistente';

                // Se olvidan los estados de conexiones que ya no existen.
                this._comprobador.podar(new Set(this._conexiones.map(c => c.id)));

                this._reconstruirMenu();
                this._vigilarCarpeta();

                // Solo se consulta la red si el menú está a la vista; si no, el
                // estado se resolverá la próxima vez que lo abras.
                if (this.menu.isOpen && this._settings.get_boolean('enable-checks'))
                    this._comprobador.comprobarTodas(this._conexiones);
            })
            .catch(e => {
                if (this._destruido)
                    return;
                console.error(`[vnc-menu] Error al escanear: ${e.message}`);
                this._motivoVacio = 'inexistente';
                this._reconstruirMenu();
            });
    }

    /* -------------------------- Vigilancia -------------------------- */

    /**
     * Coloca un Gio.FileMonitor en la carpeta raíz y en cada subcarpeta con
     * conexiones, para refrescar el menú cuando algo cambie.
     */
    _vigilarCarpeta() {
        this._pararMonitores();

        const rutas = new Set([this._carpeta]);
        for (const c of this._conexiones) {
            if (c.subcarpeta)
                rutas.add(GLib.build_filenamev([this._carpeta, c.subcarpeta]));
        }

        for (const ruta of rutas) {
            const dir = Gio.File.new_for_path(ruta);
            try {
                const monitor = dir.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
                const handlerId = monitor.connect('changed', () => this._recargaDiferida());
                this._monitores.push({monitor, handlerId});
            } catch (e) {
                console.warn(`[vnc-menu] No se pudo vigilar ${ruta}: ${e.message}`);
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

    /* ---------------------- Comprobación de estado ------------------- */

    /**
     * Al abrir el menú: comprueba los hosts y programa el refresco periódico
     * mientras siga abierto.
     */
    _alAbrirMenu() {
        // El área de trabajo puede haber cambiado (otro monitor, otra escala).
        this._ajustarAltoLista();

        // El foco se pide en cuanto el menú termina de abrirse; hacerlo antes
        // no funciona porque la animación todavía está reordenando el foco.
        if (this._buscador && !this._idFoco) {
            this._idFoco = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._idFoco = 0;
                if (!this._destruido && this.menu.isOpen)
                    this._buscador?.enfocar();
                return GLib.SOURCE_REMOVE;
            });
        }

        if (!this._settings.get_boolean('enable-checks'))
            return;

        this._comprobador.comprobarTodas(this._conexiones);
        this._programarIntervaloMenu();
    }

    /**
     * Al cerrar el menú: se para el refresco y se abandonan las comprobaciones
     * en vuelo, para no dejar sockets abiertos por algo que ya nadie ve.
     */
    _alCerrarMenu() {
        this._pararIntervaloMenu();
        this._comprobador.cancelarPendientes();

        // El filtro no sobrevive al cierre: al reabrir se ve la lista completa.
        if (this._textoFiltro) {
            this._textoFiltro = '';
            this._buscador?.entrada.set_text('');
            this._aplicarFiltro('');
        }
    }

    /**
     * (Re)programa el refresco periódico mientras el menú está abierto.
     */
    _programarIntervaloMenu() {
        this._pararIntervaloMenu();

        const segundos = this._settings.get_int('check-interval');
        this._idIntervaloMenu = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, segundos, () => {
            this._comprobador.comprobarTodas(this._conexiones);
            return GLib.SOURCE_CONTINUE;
        });
    }

    /**
     * Detiene el refresco asociado al menú abierto.
     */
    _pararIntervaloMenu() {
        if (this._idIntervaloMenu) {
            GLib.source_remove(this._idIntervaloMenu);
            this._idIntervaloMenu = 0;
        }
    }

    /**
     * (Re)programa la comprobación en segundo plano, con el menú cerrado.
     * Desactivada por omisión (intervalo 0).
     */
    _programarIntervaloFondo() {
        if (this._idIntervaloFondo) {
            GLib.source_remove(this._idIntervaloFondo);
            this._idIntervaloFondo = 0;
        }

        const segundos = this._settings.get_int('background-check-interval');
        if (!this._settings.get_boolean('enable-checks') || segundos <= 0)
            return;

        this._idIntervaloFondo = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, segundos, () => {
            // Con el menú abierto ya se está refrescando por su cuenta.
            if (!this.menu.isOpen)
                this._comprobador.comprobarTodas(this._conexiones);
            return GLib.SOURCE_CONTINUE;
        });
    }

    /* ----------------------------- Menú ----------------------------- */

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

        this._pintarBuscador();
        this._pintarLista();

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addMenuItem(new ItemAcciones([
            // Recargar no cierra el menú: así se ve cómo se refrescan las entradas.
            {
                icono: 'view-refresh-symbolic',
                texto: _('Recargar'),
                alPulsar: () => this.recargar(),
            },
            {
                icono: 'folder-symbolic',
                texto: _('Carpeta'),
                alPulsar: () => {
                    this.menu.close();
                    this._abrirCarpeta();
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
     * Pinta la lista de conexiones dentro de una zona con desplazamiento, para
     * que el menú nunca crezca más que la pantalla y el pie quede siempre
     * visible y con aire.
     */
    _pintarLista() {
        this._scroll = new St.ScrollView({
            style_class: 'vnc-lista',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
        });

        this._seccionLista = new PopupMenu.PopupMenuSection();
        this._scroll.set_child(this._seccionLista.actor);

        // El scroll va dentro de una sección para que removeAll() lo destruya.
        const contenedor = new PopupMenu.PopupMenuSection();
        contenedor.actor.add_child(this._scroll);
        this.menu.addMenuItem(contenedor);

        if (this._motivoVacio === 'inexistente') {
            this._itemInformativo(_('No se encontró la carpeta:'));
            this._itemInformativo(this._carpeta);
        } else if (this._motivoVacio === 'vacia') {
            this._itemInformativo(_('No hay conexiones en la carpeta'));
        } else if (this._conexiones.length === 0) {
            this._itemInformativo(_('Cargando conexiones…'));
        } else {
            this._pintarGrupos();
        }

        this._ajustarAltoLista();
    }

    /**
     * Limita el alto de la lista a una parte del área de trabajo. El valor va
     * en píxeles lógicos, de ahí la división por el factor de escala.
     */
    _ajustarAltoLista() {
        if (!this._scroll)
            return;

        const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        const escala = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const alto = Math.max(200, Math.round(area.height * PROPORCION_ALTO_LISTA / escala));

        this._scroll.style = `max-height: ${alto}px;`;
    }

    /**
     * Añade las conexiones agrupadas, con un separador por grupo.
     */
    _pintarGrupos() {
        const grupos = agruparConexiones(this._conexiones);
        const mostrarHost = this._settings.get_boolean('show-host');
        const hayVariosGrupos = grupos.length > 1 || grupos[0]?.nombre !== GRUPO_SIN_NOMBRE;

        let primero = true;
        for (const grupo of grupos) {
            const itemsDelGrupo = [];

            // El separador con texto hace de cabecera del grupo.
            let cabecera = null;
            if (hayVariosGrupos) {
                cabecera = new PopupMenu.PopupSeparatorMenuItem(grupo.nombre);
                if (primero)
                    cabecera.add_style_class_name('vnc-primera-cabecera');
                this._seccionLista.addMenuItem(cabecera);
            }
            primero = false;

            for (const conexion of grupo.conexiones) {
                const item = new ItemConexion(conexion, mostrarHost);
                item.fijarEstado(
                    this._settings.get_boolean('enable-checks')
                        ? this._comprobador.estadoDe(conexion.id)
                        : ESTADO.DESCONOCIDO);
                item.connect('activate', () => this._conectar(conexion));
                this._seccionLista.addMenuItem(item);
                this._items.set(conexion.id, item);
                itemsDelGrupo.push(item);
            }

            if (cabecera)
                this._cabeceras.push({cabecera, items: itemsDelGrupo});
        }

        // Aviso que solo se ve cuando el filtro no encuentra nada.
        this._itemSinCoincidencias = new PopupMenu.PopupMenuItem(
            _('Ninguna conexión coincide'), {reactive: false, style_class: 'vnc-aviso'});
        this._itemSinCoincidencias.visible = false;
        this._seccionLista.addMenuItem(this._itemSinCoincidencias);

        // Si se venía filtrando (p. ej. tras recargar), se mantiene el filtro.
        if (this._textoFiltro)
            this._aplicarFiltro(this._textoFiltro);
    }

    /* --------------------------- Búsqueda ---------------------------- */

    /**
     * Añade el campo de búsqueda si hay suficientes conexiones.
     */
    _pintarBuscador() {
        if (!this._settings.get_boolean('enable-search'))
            return;
        if (this._conexiones.length < this._settings.get_int('search-threshold'))
            return;

        this._buscador = new ItemBuscador({
            texto: this._textoFiltro,
            alEscribir: texto => this._aplicarFiltro(texto),
            alAceptar: () => this._activarPrimeraVisible(),
        });
        this.menu.addMenuItem(this._buscador);
    }

    /**
     * Quita acentos y mayúsculas para que la búsqueda sea tolerante.
     *
     * @param {string} texto texto a normalizar
     * @returns {string} texto comparable
     */
    _normalizar(texto) {
        return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    /**
     * Oculta las conexiones que no coinciden, y con ellas las cabeceras de los
     * grupos que quedan vacíos.
     *
     * @param {string} texto texto del filtro
     */
    _aplicarFiltro(texto) {
        this._textoFiltro = texto;
        const busqueda = this._normalizar(texto).trim();

        let visibles = 0;
        for (const item of this._items.values()) {
            const {nombre, host, grupo} = item.conexion;
            // Se busca por nombre, host y grupo: así vale tanto "mapelo" como "10.10".
            const heno = this._normalizar(`${nombre} ${host} ${grupo}`);
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
     * Lanza la primera conexión visible (Intro en el buscador).
     */
    _activarPrimeraVisible() {
        for (const item of this._items.values()) {
            if (item.visible) {
                item.activate(Clutter.get_current_event());
                return;
            }
        }
    }

    /**
     * Añade una línea de texto no pulsable (avisos, errores).
     *
     * @param {string} texto texto a mostrar
     */
    _itemInformativo(texto) {
        const item = new PopupMenu.PopupMenuItem(texto, {reactive: false, style_class: 'vnc-aviso'});
        this._seccionLista.addMenuItem(item);
    }

    /* -------------------------- Lanzamiento -------------------------- */

    /**
     * Sustituye los marcadores de la plantilla y devuelve el argv.
     *
     * La sustitución se hace DESPUÉS de trocear la orden, de modo que un host
     * o una ruta con espacios no puede convertirse en argumentos extra.
     *
     * @param {string} plantilla orden con marcadores (%h, %p, %u, %n, %f)
     * @param {object} conexion conexión de la que salen los valores
     * @returns {string[]|null} argv listo para Gio.Subprocess, o null si no parsea
     */
    _construirArgv(plantilla, conexion) {
        let troceado;
        try {
            const [ok, argv] = GLib.shell_parse_argv(plantilla);
            if (!ok || argv.length === 0)
                return null;
            troceado = argv;
        } catch (e) {
            console.warn(`[vnc-menu] Comando mal escrito «${plantilla}»: ${e.message}`);
            return null;
        }

        const valores = {
            '%h': conexion.host,
            '%p': String(conexion.port),
            '%u': conexion.usuario ?? '',
            '%n': conexion.nombre,
            '%f': conexion.ruta,
        };

        return troceado.map(arg =>
            arg.replace(/%[hpunf]/g, marca => valores[marca] ?? marca));
    }

    /**
     * Lanza el cliente VNC para una conexión, probando alternativas si el
     * programa configurado no está instalado.
     *
     * @param {object} conexion conexión seleccionada
     */
    _conectar(conexion) {
        const esRemmina = conexion.extension === '.remmina';
        const configurada = esRemmina
            ? this._settings.get_string('remmina-command')
            : this._settings.get_string('vnc-command');

        // La plantilla configurada primero; después los clientes alternativos.
        const candidatas = [configurada, ...(esRemmina ? ALTERNATIVAS_REMMINA : ALTERNATIVAS_VNC)];

        for (const plantilla of candidatas) {
            const argv = this._construirArgv(plantilla, conexion);
            if (!argv)
                continue;

            // Si el binario no está instalado se pasa a la siguiente alternativa.
            if (!GLib.find_program_in_path(argv[0]))
                continue;

            try {
                Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
                return;
            } catch (e) {
                console.warn(`[vnc-menu] Falló «${argv.join(' ')}»: ${e.message}`);
            }
        }

        Main.notifyError(
            'VNC Menu',
            `${_('No se pudo lanzar el cliente VNC para')} «${conexion.nombre}». ${_('Revisa el comando en las preferencias.')}`);
    }

    /**
     * Abre la carpeta de conexiones en el gestor de archivos.
     */
    _abrirCarpeta() {
        const carpeta = this._carpeta;
        const plantilla = this._settings.get_string('file-manager-command');
        const argv = this._construirArgv(plantilla, {
            host: '', port: '', usuario: '', nombre: '', ruta: carpeta,
        });

        if (argv && GLib.find_program_in_path(argv[0])) {
            try {
                Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
                return;
            } catch (e) {
                console.warn(`[vnc-menu] No se pudo abrir la carpeta: ${e.message}`);
            }
        }

        // Reserva: el gestor de archivos predeterminado del sistema.
        try {
            Gio.AppInfo.launch_default_for_uri(
                Gio.File.new_for_path(carpeta).get_uri(), null);
        } catch (e) {
            Main.notifyError('VNC Menu', `${_('No se pudo abrir la carpeta')} ${carpeta}: ${e.message}`);
        }
    }

    /* --------------------------- Limpieza ---------------------------- */

    /**
     * Libera absolutamente todo. Se llama desde disable().
     */
    destroy() {
        this._destruido = true;

        // Temporizadores.
        if (this._idRecarga) {
            GLib.source_remove(this._idRecarga);
            this._idRecarga = 0;
        }
        this._pararIntervaloMenu();
        if (this._idIntervaloFondo) {
            GLib.source_remove(this._idIntervaloFondo);
            this._idIntervaloFondo = 0;
        }
        if (this._idFoco) {
            GLib.source_remove(this._idFoco);
            this._idFoco = 0;
        }

        // Escaneos y comprobaciones de red pendientes.
        this._cancellable.cancel();
        this._comprobador.destruir();
        this._comprobador = null;

        // Monitores de archivo y señales.
        this._pararMonitores();
        for (const id of this._idsSettings)
            this._settings.disconnect(id);
        this._idsSettings = [];

        if (this._idAbrir) {
            this.menu.disconnect(this._idAbrir);
            this._idAbrir = 0;
        }

        this._items.clear();
        this._cabeceras = [];
        this._buscador = null;
        this._itemSinCoincidencias = null;
        this._scroll = null;
        this._seccionLista = null;
        this._conexiones = [];
        this._settings = null;
        this._extension = null;

        super.destroy();
    }
});

/* -------------------------------------------------------------------------
 * Punto de entrada de la extensión (API moderna de GNOME 45+)
 * ------------------------------------------------------------------------- */
export default class VncMenuExtension extends Extension {
    /**
     * Crea el indicador y lo añade al panel.
     */
    enable() {
        this._indicador = new IndicadorVnc(this);
        Main.panel.addToStatusArea(this.uuid, this._indicador, 0, 'right');
    }

    /**
     * Destruye el indicador y, con él, todos sus recursos.
     */
    disable() {
        this._indicador?.destroy();
        this._indicador = null;
    }
}

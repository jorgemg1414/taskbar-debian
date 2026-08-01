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
        this._idRecarga = 0;            // timeout de rebote del FileMonitor
        this._idIntervalo = 0;          // timeout periódico de comprobación
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

        // Al abrir el menú se refresca el estado de los hosts.
        this._idAbrir = this.menu.connect('open-state-changed', (_menu, abierto) => {
            if (abierto && this._settings.get_boolean('enable-checks'))
                this._comprobador.comprobarTodas(this._conexiones);
        });

        this._conectarSettings();
        this._programarIntervalo();
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
        conectar('panel-icon', () =>
            (this._icono.icon_name = this._settings.get_string('panel-icon')));
        conectar('check-timeout', () =>
            (this._comprobador.timeout = this._settings.get_int('check-timeout')));
        conectar('check-interval', () => this._programarIntervalo());
        conectar('enable-checks', () => {
            this._programarIntervalo();
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

                if (this._settings.get_boolean('enable-checks'))
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

    /* ---------------------- Comprobación periódica ------------------- */

    /**
     * (Re)programa la comprobación periódica de disponibilidad.
     */
    _programarIntervalo() {
        if (this._idIntervalo) {
            GLib.source_remove(this._idIntervalo);
            this._idIntervalo = 0;
        }

        if (!this._settings.get_boolean('enable-checks'))
            return;

        const segundos = this._settings.get_int('check-interval');
        this._idIntervalo = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, segundos, () => {
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

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const recargar = new PopupMenu.PopupImageMenuItem(_('Recargar conexiones'), 'view-refresh-symbolic');
        recargar.connect('activate', () => this.recargar());
        this.menu.addMenuItem(recargar);

        const abrir = new PopupMenu.PopupImageMenuItem(_('Abrir carpeta'), 'folder-symbolic');
        abrir.connect('activate', () => this._abrirCarpeta());
        this.menu.addMenuItem(abrir);

        const prefs = new PopupMenu.PopupImageMenuItem(_('Preferencias'), 'preferences-system-symbolic');
        prefs.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefs);
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
            // El separador con texto hace de cabecera del grupo.
            if (hayVariosGrupos) {
                const cabecera = new PopupMenu.PopupSeparatorMenuItem(grupo.nombre);
                if (primero)
                    cabecera.add_style_class_name('vnc-primera-cabecera');
                this.menu.addMenuItem(cabecera);
            }
            primero = false;

            for (const conexion of grupo.conexiones) {
                const item = new ItemConexion(conexion, mostrarHost);
                item.fijarEstado(
                    this._settings.get_boolean('enable-checks')
                        ? this._comprobador.estadoDe(conexion.id)
                        : ESTADO.DESCONOCIDO);
                item.connect('activate', () => this._conectar(conexion));
                this.menu.addMenuItem(item);
                this._items.set(conexion.id, item);
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
        this.menu.addMenuItem(item);
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
        if (this._idIntervalo) {
            GLib.source_remove(this._idIntervalo);
            this._idIntervalo = 0;
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

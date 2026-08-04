/*
 * extension.js — SSH Menu para GNOME Shell 48 (ESM).
 *
 * Indicador en la barra superior con los equipos de ~/.ssh/config. Al pulsar
 * uno se abre una terminal con la sesión SSH; el botón de la derecha abre la
 * misma máquina por SFTP en el gestor de archivos.
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
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';

import {
    escanearHosts, agruparHosts, expandirRuta, destinoSsh, uriSftp,
    crearConfigSiFalta, GRUPO_SIN_NOMBRE, PUERTO_SSH,
} from './hosts.js';
import {ComprobadorPuertos, ESTADO} from './checker.js';
import {listarMontajesSftp, idsMontados, uriDeMontaje, desmontar} from './montajes.js';
import {ajustesWol, leerEquiposWol, datosWolDe, despertar} from './wol.js';

// Milisegundos que se espera tras un cambio en la configuración antes de
// recargar (los editores guardan en varios pasos).
const RETARDO_RECARGA_MS = 700;

// Terminales alternativas, en orden, por si la configurada no está instalada.
// %o es el hueco de la orden que se ejecuta dentro (ssh o sftp).
//
// Las que esperan la orden como una sola cadena la llevan entrecomillada: el
// troceado se hace antes de sustituir los marcadores, así que las comillas
// hacen su trabajo aunque el alias lleve espacios.
const PLANTILLAS_TERMINAL = [
    'tilix -e "%o"',
    'gnome-terminal -- %o',
    'ptyxis -- %o',
    'kgx -e "%o"',
    'konsole -e %o',
    'xfce4-terminal -e "%o"',
    'alacritty -e %o',
    'kitty %o',
    'x-terminal-emulator -e %o',
    'xterm -e %o',
];

/**
 * Alternativas de terminal para una orden concreta.
 *
 * @param {string} orden orden a ejecutar dentro, con sus marcadores («ssh %n»)
 * @returns {string[]} plantillas listas para probar en orden
 */
function alternativasTerminal(orden) {
    return PLANTILLAS_TERMINAL.map(plantilla => plantilla.replace('%o', orden));
}

// Gestores de archivos alternativos para el SFTP.
//
// La URL se les pasa como argumento en vez de usar Gio.AppInfo: en Debian 13
// ningún programa declara «x-scheme-handler/sftp», así que
// launch_default_for_uri() contesta «la ubicación no está montada» sin llegar a
// intentar montarla. El gestor de archivos, en cambio, monta él mismo y pide la
// contraseña con su propio diálogo.
const ALTERNATIVAS_GESTOR = [
    'nautilus %s',
    'nemo %s',
    'caja %s',
    'thunar %s',
    'dolphin %s',
    'pcmanfm %s',
];

// Editores alternativos para «Editar config».
const ALTERNATIVAS_EDITOR = [
    'gnome-text-editor %f',
    'gedit %f',
    'kate %f',
    'xdg-open %f',
];

// Parte del alto de la pantalla que puede ocupar la lista de equipos. El resto
// queda para el buscador, el pie y los márgenes del menú.
const PROPORCION_ALTO_LISTA = 0.6;

/* -------------------------------------------------------------------------
 * Elemento de menú de un equipo: punto de estado + alias + destino + SFTP
 * ------------------------------------------------------------------------- */
const ItemHost = GObject.registerClass({
    // El clic derecho no conecta: pide las acciones de ese equipo.
    Signals: {'contexto': {}, 'sftp': {}, 'sftp-terminal': {}},
}, class ItemHost extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {object} host equipo a representar
     * @param {object} opciones qué partes de la fila se pintan
     * @param {boolean} opciones.mostrarDestino si se muestra «usuario@host»
     * @param {boolean} opciones.mostrarLatencia si se muestran los milisegundos
     * @param {boolean} opciones.mostrarSftp si se muestra el botón del gestor de archivos
     * @param {boolean} opciones.mostrarSftpTerminal si se muestra el botón de sftp en terminal
     */
    _init(host, {mostrarDestino, mostrarLatencia, mostrarSftp, mostrarSftpTerminal}) {
        super._init();

        this.host = host;

        // Punto de disponibilidad (verde/rojo/gris). El color va en la hoja de estilos.
        this._punto = new St.Widget({
            style_class: 'ssh-punto ssh-punto-desconocido',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._punto);

        this._etiqueta = new St.Label({
            text: host.nombre,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._etiqueta);
        // Necesario para que el lector de pantalla anuncie el elemento.
        this.label_actor = this._etiqueta;

        if (host.salto) {
            // Un equipo con salto no se alcanza directamente: conviene verlo.
            this.add_child(new St.Label({
                text: `⇢ ${host.salto}`,
                style_class: 'ssh-salto',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }

        if (mostrarDestino) {
            const puerto = host.port !== PUERTO_SSH ? `:${host.port}` : '';
            this._destino = new St.Label({
                text: `${destinoSsh(host)}${puerto}`,
                style_class: 'ssh-destino',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._destino);
        }

        if (mostrarLatencia) {
            this._latencia = new St.Label({
                text: '',
                style_class: 'ssh-latencia',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._latencia);
        }

        // Los botones se comen el clic (St.Button consume el evento), así que
        // pulsarlos no lanza además la sesión de terminal de la fila.
        if (mostrarSftp) {
            this._botonSftp = this._crearBoton(
                'folder-remote-symbolic',
                _('Abrir por SFTP en el gestor de archivos'),
                () => this.emit('sftp'));
        }

        if (mostrarSftpTerminal) {
            this._crearBoton(
                'network-transmit-receive-symbolic',
                _('Abrir sftp en una terminal (get, put…)'),
                () => this.emit('sftp-terminal'));
        }
    }

    /**
     * Añade a la fila un botón de icono con su acción.
     *
     * @param {string} icono nombre del icono simbólico
     * @param {string} descripcion texto para el lector de pantalla
     * @param {Function} alPulsar acción al pulsarlo
     * @returns {St.Button} el botón creado
     */
    _crearBoton(icono, descripcion, alPulsar) {
        const boton = new St.Button({
            style_class: 'ssh-boton-sftp',
            can_focus: true,
            accessible_name: descripcion,
            child: new St.Icon({
                icon_name: icono,
                style_class: 'ssh-boton-sftp-icono',
            }),
        });
        boton.connect('clicked', () => alPulsar());
        this.add_child(boton);
        return boton;
    }

    /**
     * Marca la fila cuando el equipo tiene una carpeta montada por SFTP.
     *
     * @param {boolean} montado si hay montaje activo
     */
    fijarMontado(montado) {
        if (!this._botonSftp)
            return;

        if (montado)
            this._botonSftp.add_style_class_name('ssh-boton-sftp-montado');
        else
            this._botonSftp.remove_style_class_name('ssh-boton-sftp-montado');

        this._botonSftp.accessible_name = montado
            ? _('Abrir la carpeta montada')
            : _('Abrir por SFTP en el gestor de archivos');
    }

    /**
     * Cambia el color del punto según el estado y actualiza la latencia.
     *
     * @param {string} estado valor de ESTADO
     * @param {number|null} latencia milisegundos de respuesta, si se conocen
     */
    fijarEstado(estado, latencia = null) {
        const clases = {
            [ESTADO.ARRIBA]: 'ssh-punto ssh-punto-arriba',
            [ESTADO.ABAJO]: 'ssh-punto ssh-punto-abajo',
            [ESTADO.COMPROBANDO]: 'ssh-punto ssh-punto-comprobando',
            [ESTADO.DESCONOCIDO]: 'ssh-punto ssh-punto-desconocido',
        };
        this._punto.style_class = clases[estado] ?? clases[ESTADO.DESCONOCIDO];

        const textos = {
            [ESTADO.ARRIBA]: _('disponible'),
            [ESTADO.ABAJO]: _('sin respuesta'),
            [ESTADO.COMPROBANDO]: _('comprobando…'),
            [ESTADO.DESCONOCIDO]: _('estado desconocido'),
        };
        // Los milisegundos solo dicen algo de un host que responde.
        const ms = estado === ESTADO.ARRIBA && latencia !== null ? `${latencia} ms` : '';
        if (this._latencia)
            this._latencia.text = ms;

        this.accessible_name =
            `${this.host.nombre} — ${textos[estado] ?? ''}${ms ? `, ${ms}` : ''}`;
    }

    /**
     * Con el botón derecho no se abre la sesión: se piden sus acciones.
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
 * Elemento de una carpeta remota montada
 * ------------------------------------------------------------------------- */
const ItemMontaje = GObject.registerClass({
    Signals: {'desmontar': {}},
}, class ItemMontaje extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {object} montaje montaje devuelto por listarMontajesSftp()
     */
    _init(montaje) {
        super._init();

        this.montaje = montaje;

        this.add_child(new St.Icon({
            icon_name: 'folder-remote-symbolic',
            style_class: 'popup-menu-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const etiqueta = new St.Label({
            text: montaje.nombre,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(etiqueta);
        this.label_actor = etiqueta;

        // Soltar el montaje sin salir del menú ni abrir el gestor de archivos.
        const expulsar = new St.Button({
            style_class: 'ssh-boton-sftp',
            can_focus: true,
            accessible_name: _('Desmontar'),
            child: new St.Icon({
                icon_name: 'media-eject-symbolic',
                style_class: 'ssh-boton-sftp-icono',
            }),
        });
        expulsar.connect('clicked', () => this.emit('desmontar'));
        this.add_child(expulsar);
    }
});

/* -------------------------------------------------------------------------
 * Campo de búsqueda para filtrar los equipos escribiendo
 * ------------------------------------------------------------------------- */
const ItemBuscador = GObject.registerClass(
class ItemBuscador extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {object} opciones opciones del buscador
     * @param {string} opciones.texto texto inicial del filtro
     * @param {Function} opciones.alEscribir callback con el texto escrito
     * @param {Function} opciones.alAceptar callback al pulsar Intro (recibe los modificadores)
     * @param {Function} opciones.alNavegar callback con +1/-1 al pulsar ↓/↑
     */
    _init({texto = '', alEscribir, alAceptar, alNavegar}) {
        // No es activable ni enfocable: el foco lo lleva el campo de texto.
        super._init({reactive: false, activate: false, hover: false, can_focus: false});

        this.entrada = new St.Entry({
            style_class: 'ssh-buscador',
            hint_text: _('Buscar equipo…'),
            can_focus: true,
            x_expand: true,
        });
        this.entrada.set_primary_icon(new St.Icon({
            style_class: 'ssh-buscador-icono',
            icon_name: 'edit-find-symbolic',
        }));
        this.entrada.set_text(texto);
        this.add_child(this.entrada);

        this.entrada.clutter_text.connect('text-changed',
            () => alEscribir(this.entrada.get_text()));

        this.entrada.clutter_text.connect('key-press-event', (_actor, evento) => {
            const tecla = evento.get_key_symbol();
            const estado = evento.get_state();

            // Intro abre la sesión con la primera coincidencia; con Ctrl, el
            // SFTP en el gestor de archivos; con Mayús, el sftp de terminal.
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
            style_class: 'ssh-acciones',
        });

        for (const {icono, texto, alPulsar} of acciones) {
            const boton = new St.Button({
                style_class: 'ssh-accion',
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
                style_class: 'ssh-accion-icono',
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
const IndicadorSsh = GObject.registerClass(
class IndicadorSsh extends PanelMenu.Button {
    /**
     * @param {Extension} extension instancia de la extensión (settings, openPreferences)
     */
    _init(extension) {
        super._init(0.5, 'SSH Menu');

        this._extension = extension;
        this._settings = extension.getSettings();

        // Estado interno.
        this._hosts = [];
        this._items = new Map();        // id de host -> ItemHost
        this._archivos = [];            // archivos de configuración leídos
        this._motivoVacio = null;       // 'inexistente' | 'vacia' | null
        this._monitores = [];           // {monitor, handlerId}
        this._idsSettings = [];
        this._idsVolumenes = [];        // señales de Gio.VolumeMonitor
        this._settingsWol = null;       // ajustes de la extensión Wake on LAN
        this._wolConsultado = false;    // si ya se buscó esa extensión
        this._cabeceras = [];           // {cabecera, items} por grupo, para filtrar
        this._buscador = null;          // ItemBuscador, si procede
        this._itemSinCoincidencias = null;
        this._scroll = null;            // zona con desplazamiento de la lista
        this._seccionLista = null;      // sección donde viven los equipos
        this._contexto = null;          // fila de acciones del clic derecho
        this._seccionMontajes = null;   // carpetas SFTP montadas
        this._textoFiltro = '';
        this._idRecarga = 0;            // timeout de rebote del FileMonitor
        this._idIntervaloMenu = 0;      // refresco mientras el menú está abierto
        this._idIntervaloFondo = 0;     // comprobación con el menú cerrado
        this._idFoco = 0;               // idle para enfocar el buscador
        this._cancellable = new Gio.Cancellable();
        // Las acciones sobre montajes tienen su propio cancelable: recargar la
        // configuración no debe abortar un desmontaje a medias.
        this._cancellableAcciones = new Gio.Cancellable();
        this._destruido = false;

        this._icono = new St.Icon({
            icon_name: this._settings.get_string('panel-icon'),
            style_class: 'system-status-icon',
        });
        this.add_child(this._icono);

        // Contador de equipos sin respuesta, para enterarte sin abrir el menú.
        this._insignia = new St.Label({
            style_class: 'ssh-insignia',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this.add_child(this._insignia);

        this._comprobador = new ComprobadorPuertos({
            timeout: this._settings.get_int('check-timeout'),
            alCambiar: (id, estado, latencia) => {
                this._items.get(id)?.fijarEstado(estado, latencia);
                this._actualizarInsignia();
            },
        });

        // El estado se consulta al abrir el menú y se deja de consultar al
        // cerrarlo: así no se toca la red cuando nadie está mirando.
        this._idAbrir = this.menu.connect('open-state-changed', (_menu, abierto) => {
            if (abierto)
                this._alAbrirMenu();
            else
                this._alCerrarMenu();
        });

        // Las flechas se atienden en el menú entero: la navegación por omisión
        // no sabe que hay equipos ocultos por el filtro y se para en ellos.
        this._idTeclas = this.menu.actor.connect('key-press-event', (_actor, evento) => {
            const tecla = evento.get_key_symbol();
            if (tecla === Clutter.KEY_Down)
                return this._moverFoco(1);
            if (tecla === Clutter.KEY_Up)
                return this._moverFoco(-1);
            return Clutter.EVENT_PROPAGATE;
        });

        this._vigilarMontajes();
        this._conectarSettings();
        this._programarIntervaloFondo();
        this._reconstruirMenu();   // pinta el estado «cargando»
        this.recargar();
    }

    /**
     * Ruta absoluta del archivo de configuración según los ajustes.
     *
     * @returns {string} ruta expandida
     */
    get _rutaConfig() {
        return expandirRuta(this._settings.get_string('config-path'));
    }

    /**
     * Equipos cuyo estado tiene sentido comprobar. Los que se alcanzan a
     * través de un salto no aceptan conexión directa: comprobarlos diría que
     * están caídos aunque funcionen.
     *
     * @returns {object[]} equipos alcanzables directamente
     */
    get _comprobables() {
        return this._hosts.filter(h => !h.salto);
    }

    /* --------------------------- Ajustes ---------------------------- */

    /**
     * Reacciona a los cambios de configuración sin recargar el shell.
     */
    _conectarSettings() {
        const conectar = (clave, cb) =>
            this._idsSettings.push(this._settings.connect(`changed::${clave}`, cb));

        conectar('config-path', () => this.recargar());
        conectar('show-target', () => this._reconstruirMenu());
        conectar('show-latency', () => this._reconstruirMenu());
        conectar('show-sftp', () => this._reconstruirMenu());
        conectar('show-sftp-terminal', () => this._reconstruirMenu());
        conectar('show-mounts', () => this._pintarMontajes());
        conectar('enable-search', () => this._reconstruirMenu());
        conectar('search-threshold', () => this._reconstruirMenu());
        conectar('panel-icon', () =>
            (this._icono.icon_name = this._settings.get_string('panel-icon')));
        conectar('panel-badge', () => this._actualizarInsignia());
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
            this._actualizarInsignia();
        });
    }

    /* ------------------------ Carga de datos ------------------------ */

    /**
     * Vuelve a leer la configuración de SSH y reconstruye el menú.
     */
    recargar() {
        if (this._destruido)
            return;

        // Se cancela cualquier lectura anterior todavía en vuelo.
        this._cancellable.cancel();
        this._cancellable = new Gio.Cancellable();
        const cancellable = this._cancellable;

        escanearHosts(this._rutaConfig, cancellable)
            .then(resultado => {
                if (this._destruido || cancellable.is_cancelled() || resultado.motivo === 'cancelado')
                    return;

                this._hosts = resultado.hosts;
                this._archivos = resultado.archivos;
                this._motivoVacio = resultado.ok
                    ? (resultado.motivo === 'vacia' ? 'vacia' : null)
                    : 'inexistente';

                // Se olvidan los estados de equipos que ya no existen.
                this._comprobador.podar(new Set(this._hosts.map(h => h.id)));

                this._reconstruirMenu();
                this._actualizarInsignia();
                this._vigilarConfig();

                // Solo se consulta la red si el menú está a la vista; si no, el
                // estado se resolverá la próxima vez que lo abras.
                if (this.menu.isOpen && this._settings.get_boolean('enable-checks'))
                    this._comprobador.comprobarTodas(this._comprobables);
            })
            .catch(e => {
                if (this._destruido)
                    return;
                console.error(`[ssh-menu] Error al leer la configuración: ${e.message}`);
                this._motivoVacio = 'inexistente';
                this._reconstruirMenu();
            });
    }

    /* -------------------------- Vigilancia -------------------------- */

    /**
     * Vigila los archivos de configuración leídos, para que el menú cambie en
     * cuanto edites un bloque.
     *
     * Mientras no exista ninguno se vigila la carpeta, que es la única forma de
     * enterarse de que se crea. En cuanto hay configuración se deja de vigilar:
     * ~/.ssh se toca sola cada vez que ssh apunta un equipo en known_hosts, y
     * eso no tiene nada que ver con el menú.
     */
    _vigilarConfig() {
        this._pararMonitores();

        const objetivos = new Map();   // ruta -> si es carpeta
        for (const ruta of this._archivos)
            objetivos.set(ruta, false);

        if (objetivos.size === 0)
            objetivos.set(GLib.path_get_dirname(this._rutaConfig), true);

        for (const [ruta, esCarpeta] of objetivos) {
            const file = Gio.File.new_for_path(ruta);
            try {
                const monitor = esCarpeta
                    ? file.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null)
                    : file.monitor_file(Gio.FileMonitorFlags.WATCH_MOVES, null);
                const handlerId = monitor.connect('changed', () => this._recargaDiferida());
                this._monitores.push({monitor, handlerId});
            } catch (e) {
                console.warn(`[ssh-menu] No se pudo vigilar ${ruta}: ${e.message}`);
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

    /**
     * Escucha los montajes de GVfs: montar o desmontar una carpeta remota
     * ocurre por su cuenta (desde Archivos, o al desconectarse la red).
     */
    _vigilarMontajes() {
        const monitor = Gio.VolumeMonitor.get();
        for (const senal of ['mount-added', 'mount-removed', 'mount-changed']) {
            this._idsVolumenes.push({
                monitor,
                id: monitor.connect(senal, () => this._pintarMontajes()),
            });
        }
    }

    /* ---------------------- Comprobación de estado ------------------- */

    /**
     * Al abrir el menú: comprueba los hosts y programa el refresco periódico
     * mientras siga abierto.
     */
    _alAbrirMenu() {
        // El área de trabajo puede haber cambiado (otro monitor, otra escala).
        this._ajustarAltoLista();

        // Los montajes van y vienen sin avisar a la extensión.
        this._pintarMontajes();

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

        this._comprobador.comprobarTodas(this._comprobables);
        this._programarIntervaloMenu();
    }

    /**
     * Al cerrar el menú: se para el refresco y se abandonan las comprobaciones
     * en vuelo, para no dejar sockets abiertos por algo que ya nadie ve.
     */
    _alCerrarMenu() {
        this._pararIntervaloMenu();
        this._comprobador.cancelarPendientes();
        this._cerrarContexto();

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
            this._comprobador.comprobarTodas(this._comprobables);
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
                this._comprobador.comprobarTodas(this._comprobables);
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
        this._contexto = null;   // removeAll() ya lo ha destruido

        // Las carpetas montadas van arriba del todo, y se repintan cada vez que
        // se abre el menú porque cambian por su cuenta.
        this._seccionMontajes = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._seccionMontajes);
        this._pintarMontajes();

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
                icono: 'text-editor-symbolic',
                texto: _('Editar config'),
                alPulsar: () => {
                    this.menu.close();
                    this._editarConfig();
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
     * Rellena la sección con las carpetas remotas montadas ahora mismo, y marca
     * en la lista los equipos que las tienen.
     */
    _pintarMontajes() {
        if (this._destruido || !this._seccionMontajes)
            return;

        this._seccionMontajes.removeAll();

        const montados = idsMontados(this._hosts);
        for (const [id, item] of this._items)
            item.fijarMontado(montados.has(id));

        if (!this._settings.get_boolean('show-mounts'))
            return;

        const montajes = listarMontajesSftp(this._hosts);
        if (montajes.length === 0)
            return;

        const cabecera = new PopupMenu.PopupSeparatorMenuItem(_('Carpetas montadas'));
        cabecera.add_style_class_name('ssh-primera-cabecera');
        this._seccionMontajes.addMenuItem(cabecera);

        for (const montaje of montajes) {
            const item = new ItemMontaje(montaje);
            item.connect('activate', () => this._abrirCarpetaRemota(uriDeMontaje(montaje.mount)));
            item.connect('desmontar', () => this._desmontar(montaje));
            this._seccionMontajes.addMenuItem(item);
        }
    }

    /**
     * Pinta la lista de equipos dentro de una zona con desplazamiento, para que
     * el menú nunca crezca más que la pantalla y el pie quede siempre visible.
     */
    _pintarLista() {
        this._scroll = new St.ScrollView({
            style_class: 'ssh-lista',
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
            this._itemInformativo(_('No se encontró la configuración de SSH:'));
            this._itemInformativo(this._rutaConfig);
            this._itemInformativo(_('«Editar config» la crea con un ejemplo.'));
        } else if (this._motivoVacio === 'vacia') {
            this._itemInformativo(_('No hay ningún bloque «Host» en la configuración'));
        } else if (this._hosts.length === 0) {
            this._itemInformativo(_('Cargando equipos…'));
        } else {
            this._pintarGrupos();
        }

        this._ajustarAltoLista();
    }

    /**
     * Actualiza el contador del panel con los equipos que no responden.
     *
     * Solo tiene sentido si las comprobaciones están activas; y para que se
     * mantenga al día con el menú cerrado hace falta el intervalo de fondo.
     */
    _actualizarInsignia() {
        if (this._destruido || !this._insignia)
            return;

        const activa = this._settings.get_boolean('panel-badge') &&
                       this._settings.get_boolean('enable-checks');

        let caidos = 0;
        if (activa) {
            for (const host of this._comprobables) {
                if (this._comprobador.estadoDe(host.id) === ESTADO.ABAJO)
                    caidos++;
            }
        }

        this._insignia.text = String(caidos);
        this._insignia.visible = caidos > 0;
        this.accessible_name = caidos > 0
            ? `${_('SSH Menu')} — ${caidos} ${_('sin respuesta')}`
            : _('SSH Menu');
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
     * Añade los equipos agrupados, con un separador por grupo.
     */
    _pintarGrupos() {
        const grupos = agruparHosts(this._hosts);
        const opciones = {
            mostrarDestino: this._settings.get_boolean('show-target'),
            mostrarLatencia: this._settings.get_boolean('show-latency') &&
                             this._settings.get_boolean('enable-checks'),
            mostrarSftp: this._settings.get_boolean('show-sftp'),
            mostrarSftpTerminal: this._settings.get_boolean('show-sftp-terminal'),
        };
        const comprobando = this._settings.get_boolean('enable-checks');
        const hayVariosGrupos = grupos.length > 1 || grupos[0]?.nombre !== GRUPO_SIN_NOMBRE;

        let primero = true;
        for (const grupo of grupos) {
            const itemsDelGrupo = [];

            // El separador con texto hace de cabecera del grupo.
            let cabecera = null;
            if (hayVariosGrupos) {
                cabecera = new PopupMenu.PopupSeparatorMenuItem(grupo.nombre);
                if (primero)
                    cabecera.add_style_class_name('ssh-primera-cabecera');
                this._seccionLista.addMenuItem(cabecera);
            }
            primero = false;

            for (const host of grupo.hosts) {
                const item = new ItemHost(host, opciones);
                item.fijarEstado(
                    comprobando && !host.salto
                        ? this._comprobador.estadoDe(host.id)
                        : ESTADO.DESCONOCIDO,
                    this._comprobador.latenciaDe(host.id));
                // Ctrl+clic abre el SFTP gráfico y Mayús+clic el de terminal,
                // lo mismo que hacen los dos botones de la derecha.
                item.connect('activate', (_item, evento) => {
                    const estado = this._modificadores(evento);
                    if (estado.ctrl)
                        this._abrirSftp(host);
                    else if (estado.shift)
                        this._abrirSftpTerminal(host);
                    else
                        this._conectar(host);
                });
                item.connect('sftp', () => this._abrirSftp(host));
                item.connect('sftp-terminal', () => this._abrirSftpTerminal(host));
                item.connect('contexto', () => this._alternarContexto(item));
                this._seccionLista.addMenuItem(item);
                this._items.set(host.id, item);
                itemsDelGrupo.push(item);
            }

            if (cabecera)
                this._cabeceras.push({cabecera, items: itemsDelGrupo});
        }

        // Marca los equipos que ya tienen carpeta montada.
        const montados = idsMontados(this._hosts);
        for (const [id, item] of this._items)
            item.fijarMontado(montados.has(id));

        // Aviso que solo se ve cuando el filtro no encuentra nada.
        this._itemSinCoincidencias = new PopupMenu.PopupMenuItem(
            _('Ningún equipo coincide'), {reactive: false, style_class: 'ssh-aviso'});
        this._itemSinCoincidencias.visible = false;
        this._seccionLista.addMenuItem(this._itemSinCoincidencias);

        // Si se venía filtrando (p. ej. tras recargar), se mantiene el filtro.
        if (this._textoFiltro)
            this._aplicarFiltro(this._textoFiltro);
    }

    /**
     * Modificadores que traía el evento que activó un elemento.
     *
     * @param {Clutter.Event|null} evento evento que activó el elemento
     * @returns {{ctrl: boolean, shift: boolean}} teclas pulsadas
     */
    _modificadores(evento) {
        const estado = evento?.get_state?.() ?? 0;
        return {
            ctrl: (estado & Clutter.ModifierType.CONTROL_MASK) !== 0,
            shift: (estado & Clutter.ModifierType.SHIFT_MASK) !== 0,
        };
    }

    /* --------------------------- Búsqueda ---------------------------- */

    /**
     * Añade el campo de búsqueda si hay suficientes equipos.
     */
    _pintarBuscador() {
        if (!this._settings.get_boolean('enable-search'))
            return;
        if (this._hosts.length < this._settings.get_int('search-threshold'))
            return;

        this._buscador = new ItemBuscador({
            texto: this._textoFiltro,
            alEscribir: texto => this._aplicarFiltro(texto),
            alAceptar: estado => this._activarPrimeroVisible(estado),
            alNavegar: delta => this._moverFoco(delta),
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
     * Oculta los equipos que no coinciden, y con ellos las cabeceras de los
     * grupos que quedan vacíos.
     *
     * @param {string} texto texto del filtro
     */
    _aplicarFiltro(texto) {
        this._textoFiltro = texto;
        const busqueda = this._normalizar(texto).trim();

        // La fila de acciones se refiere a un equipo concreto; si la lista
        // cambia debajo, deja de tener sentido.
        this._cerrarContexto();

        let visibles = 0;
        for (const item of this._items.values()) {
            const {nombre, host, usuario, grupo} = item.host;
            // Se busca por alias, host, usuario y grupo: así vale tanto
            // "oficina" como "10.20" o "root".
            const heno = this._normalizar(`${nombre} ${host} ${usuario} ${grupo}`);
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
     * Mueve el foco entre los equipos visibles, saltando cabeceras y equipos
     * ocultos por el filtro.
     *
     * @param {number} delta +1 para bajar, -1 para subir
     * @returns {boolean} si la tecla queda consumida
     */
    _moverFoco(delta) {
        const visibles = [...this._items.values()].filter(item => item.visible);
        if (visibles.length === 0)
            return Clutter.EVENT_PROPAGATE;

        const foco = global.stage.get_key_focus();
        const actual = visibles.findIndex(
            item => item === foco || (foco && item.contains(foco)));

        // Subir desde el primer equipo devuelve el foco al buscador.
        if (actual === 0 && delta < 0 && this._buscador) {
            this._buscador.enfocar();
            return Clutter.EVENT_STOP;
        }

        const siguiente = actual === -1
            ? (delta > 0 ? visibles[0] : visibles[visibles.length - 1])
            : visibles[(actual + delta + visibles.length) % visibles.length];

        siguiente.grab_key_focus();
        this._asegurarVisible(siguiente);
        return Clutter.EVENT_STOP;
    }

    /**
     * Desplaza la lista lo justo para que un elemento quede a la vista.
     *
     * @param {St.Widget} item elemento que debe verse entero
     */
    _asegurarVisible(item) {
        const ajuste = this._scroll?.vadjustment;
        if (!ajuste)
            return;

        const caja = item.get_allocation_box();
        if (caja.y1 < ajuste.value)
            ajuste.value = caja.y1;
        else if (caja.y2 > ajuste.value + ajuste.page_size)
            ajuste.value = caja.y2 - ajuste.page_size;
    }

    /* -------------------------- Menú contextual ---------------------- */

    /**
     * Abre (o cierra) la fila de acciones de un equipo, justo debajo de él. Es
     * una fila más de la lista, así no pelea con el menú del panel por el foco
     * ni por el modal.
     *
     * @param {ItemHost} item elemento sobre el que se pulsó
     */
    _alternarContexto(item) {
        const yaAbierto = this._contexto?._idHost === item.host.id;
        this._cerrarContexto();
        if (yaAbierto)
            return;

        const host = item.host;
        const acciones = [];

        // Encender solo se ofrece si el equipo no está respondiendo: si
        // contesta, ya está encendido y el botón sobraría.
        const wol = this._wolDe(host);
        if (wol && this._comprobador.estadoDe(host.id) !== ESTADO.ARRIBA) {
            acciones.push({
                icono: 'system-shutdown-symbolic',
                texto: _('Encender'),
                alPulsar: () => {
                    this._cerrarContexto();
                    this._despertar(host, wol);
                },
            });
        }

        acciones.push(
            {
                icono: 'edit-copy-symbolic',
                texto: _('Copiar'),
                alPulsar: () => {
                    St.Clipboard.get_default().set_text(
                        St.ClipboardType.CLIPBOARD, `ssh ${host.nombre}`);
                    this._cerrarContexto();
                },
            },
            {
                icono: 'view-refresh-symbolic',
                texto: _('Comprobar'),
                alPulsar: () => {
                    if (this._settings.get_boolean('enable-checks') && !host.salto)
                        this._comprobador.comprobar(host);
                    this._cerrarContexto();
                },
            },
            {
                icono: 'text-editor-symbolic',
                texto: _('Editar'),
                alPulsar: () => {
                    this.menu.close();
                    // El equipo puede estar definido en un archivo incluido.
                    this._editarConfig(host.ruta);
                },
            });

        const contexto = new ItemAcciones(acciones);
        contexto._idHost = host.id;

        const posicion = this._seccionLista._getMenuItems().indexOf(item);
        this._seccionLista.addMenuItem(contexto, posicion + 1);
        this._contexto = contexto;
    }

    /**
     * Con qué datos se puede encender un equipo, si es que se puede.
     *
     * Salen del comentario «# MAC:» de su bloque o de los equipos que ya
     * tengas dados de alta en la extensión Wake on LAN, que se leen de sus
     * propios ajustes. Si no está instalada, sencillamente no hay nada.
     *
     * @param {object} host equipo del menú
     * @returns {object|null} datos del paquete mágico, o null
     */
    _wolDe(host) {
        if (!this._settings.get_boolean('enable-wol'))
            return null;

        // La extensión hermana se busca una sola vez por sesión.
        if (!this._wolConsultado) {
            this._wolConsultado = true;
            this._settingsWol = ajustesWol(this._extension.path);
        }

        return datosWolDe(host, leerEquiposWol(this._settingsWol));
    }

    /**
     * Manda el paquete mágico a un equipo caído.
     *
     * @param {object} host equipo del menú
     * @param {object} datos mac, destino y puerto con los que despertarlo
     */
    _despertar(host, datos) {
        despertar(datos, this._cancellableAcciones)
            .then(error => {
                if (this._destruido)
                    return;
                if (error) {
                    Main.notifyError('SSH Menu',
                        `${_('No se pudo encender')} «${host.nombre}»: ${error}`);
                } else {
                    // El protocolo no tiene respuesta: que el paquete salga no
                    // garantiza que el equipo arranque, así que se dice eso.
                    Main.notify('SSH Menu',
                        `${_('Paquete de encendido enviado a')} «${host.nombre}»`);
                }
            })
            .catch(e => {
                if (!this._destruido)
                    console.error(`[ssh-menu] Fallo al encender: ${e.message}`);
            });
    }

    /**
     * Quita la fila de acciones, si hay alguna abierta.
     */
    _cerrarContexto() {
        this._contexto?.destroy();
        this._contexto = null;
    }

    /**
     * Activa el primer equipo visible (Intro en el buscador).
     *
     * @param {{ctrl: boolean, shift: boolean}} estado modificadores pulsados
     */
    _activarPrimeroVisible({ctrl, shift}) {
        for (const item of this._items.values()) {
            if (!item.visible)
                continue;
            if (ctrl)
                this._abrirSftp(item.host);
            else if (shift)
                this._abrirSftpTerminal(item.host);
            else
                item.activate(Clutter.get_current_event());
            return;
        }
    }

    /**
     * Añade una línea de texto no pulsable (avisos, errores).
     *
     * @param {string} texto texto a mostrar
     */
    _itemInformativo(texto) {
        const item = new PopupMenu.PopupMenuItem(texto, {reactive: false, style_class: 'ssh-aviso'});
        this._seccionLista.addMenuItem(item);
    }

    /* -------------------------- Lanzamiento -------------------------- */

    /**
     * Sustituye los marcadores de la plantilla y devuelve el argv.
     *
     * La sustitución se hace DESPUÉS de trocear la orden, de modo que un alias
     * o una ruta con espacios no puede convertirse en argumentos extra.
     *
     * @param {string} plantilla orden con marcadores (%n, %h, %p, %u, %d, %f, %s)
     * @param {object} valores valores de sustitución ya calculados
     * @returns {string[]|null} argv listo para Gio.Subprocess, o null si no parsea
     */
    _construirArgv(plantilla, valores) {
        let troceado;
        try {
            const [ok, argv] = GLib.shell_parse_argv(plantilla);
            if (!ok || argv.length === 0)
                return null;
            troceado = argv;
        } catch (e) {
            console.warn(`[ssh-menu] Comando mal escrito «${plantilla}»: ${e.message}`);
            return null;
        }

        return troceado.map(arg =>
            arg.replace(/%[nhpudfs]/g, marca => valores[marca] ?? marca));
    }

    /**
     * Valores de sustitución de un equipo.
     *
     * @param {object} host equipo seleccionado
     * @returns {object} marcadores listos para _construirArgv()
     */
    _valoresDe(host) {
        return {
            '%n': host.nombre,
            '%h': host.host,
            '%p': String(host.port),
            '%u': host.usuario,
            '%d': destinoSsh(host),
            '%f': host.ruta,
            '%s': uriSftp(host, this._settings.get_string('sftp-path')),
        };
    }

    /**
     * Ejecuta la primera plantilla cuyo programa esté instalado.
     *
     * @param {string[]} plantillas órdenes candidatas, en orden de preferencia
     * @param {object} valores marcadores de sustitución
     * @returns {boolean} si se pudo lanzar alguna
     */
    _lanzar(plantillas, valores) {
        for (const plantilla of plantillas) {
            if (!plantilla)
                continue;

            const argv = this._construirArgv(plantilla, valores);
            if (!argv)
                continue;

            // Si el binario no está instalado se pasa a la siguiente alternativa.
            if (!GLib.find_program_in_path(argv[0]))
                continue;

            try {
                Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
                return true;
            } catch (e) {
                console.warn(`[ssh-menu] Falló «${argv.join(' ')}»: ${e.message}`);
            }
        }
        return false;
    }

    /**
     * Abre una terminal con la sesión SSH.
     *
     * Se lanza «ssh <alias>», no «ssh usuario@host»: así el propio ssh aplica
     * todo lo que tengas en el bloque (usuario, puerto, claves, ProxyJump…) y
     * la extensión no tiene que reimplementar su configuración.
     *
     * @param {object} host equipo seleccionado
     */
    _conectar(host) {
        // Los equipos viven dentro del St.ScrollView, fuera de la sección que
        // el menú vigila para cerrarse solo al activar una entrada, así que hay
        // que cerrarlo a mano.
        this.menu.itemActivated(BoxPointer.PopupAnimation.FULL);

        const configurada = this._settings.get_string('terminal-command');
        const lanzado = this._lanzar(
            [configurada, ...alternativasTerminal('ssh %n')], this._valoresDe(host));

        if (!lanzado) {
            Main.notifyError('SSH Menu',
                `${_('No se pudo abrir la terminal para')} «${host.nombre}». ${_('Revisa el comando en las preferencias.')}`);
        }
    }

    /**
     * Abre una sesión interactiva de sftp en una terminal, la de los comandos
     * «get», «put», «ls» y «cd».
     *
     * Igual que con ssh, se lanza «sftp <alias>»: sftp lee el mismo
     * ~/.ssh/config, así que respeta usuario, puerto, clave y ProxyJump.
     *
     * @param {object} host equipo seleccionado
     */
    _abrirSftpTerminal(host) {
        this.menu.itemActivated(BoxPointer.PopupAnimation.FULL);

        const configurada = this._settings.get_string('sftp-terminal-command');
        const lanzado = this._lanzar(
            [configurada, ...alternativasTerminal('sftp %n')], this._valoresDe(host));

        if (!lanzado) {
            Main.notifyError('SSH Menu',
                `${_('No se pudo abrir sftp en una terminal para')} «${host.nombre}». ${_('Revisa el comando en las preferencias.')}`);
        }
    }

    /**
     * Abre la carpeta remota del equipo por SFTP.
     *
     * Si ya está montada se abre el montaje, así se cae directamente donde te
     * deja GVfs: la carpeta personal del usuario remoto, no la raíz del
     * servidor.
     *
     * @param {object} host equipo seleccionado
     */
    _abrirSftp(host) {
        this.menu.itemActivated(BoxPointer.PopupAnimation.FULL);

        const montaje = listarMontajesSftp(this._hosts).find(m => m.id === host.id);
        const uri = montaje
            ? uriDeMontaje(montaje.mount)
            : uriSftp(host, this._settings.get_string('sftp-path'));

        this._abrirCarpetaRemota(uri, this._valoresDe(host));
    }

    /**
     * Abre una carpeta remota en el gestor de archivos, que es quien monta y
     * quien pide la contraseña o la clave: la extensión no toca credenciales.
     *
     * @param {string} uri URL a abrir
     * @param {object} [valores] marcadores para la plantilla configurada
     */
    _abrirCarpetaRemota(uri, valores = null) {
        const marcadores = {...(valores ?? {}), '%s': uri};

        const configurada = this._settings.get_string('sftp-command');
        if (configurada.trim() !== '' && this._lanzar([configurada], marcadores))
            return;

        if (this._lanzar(ALTERNATIVAS_GESTOR, marcadores))
            return;

        // Último recurso: la aplicación predeterminada del sistema. Con la
        // carpeta ya montada funciona, porque entonces GIO la ve como un
        // directorio y eso sí lo declara el gestor de archivos.
        this._abrirUri(uri);
    }

    /**
     * Abre una URL con la aplicación predeterminada del sistema.
     *
     * @param {string} uri URL a abrir
     */
    _abrirUri(uri) {
        try {
            Gio.AppInfo.launch_default_for_uri(uri, null);
        } catch (e) {
            Main.notifyError('SSH Menu', `${_('No se pudo abrir')} ${uri}: ${e.message}`);
        }
    }

    /**
     * Suelta una carpeta remota montada.
     *
     * @param {object} montaje montaje devuelto por listarMontajesSftp()
     */
    _desmontar(montaje) {
        desmontar(montaje.mount, this._cancellableAcciones)
            .then(() => {
                if (!this._destruido)
                    this._pintarMontajes();
            })
            .catch(e => {
                if (this._destruido || e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.FAILED_HANDLED))
                    return;
                Main.notifyError('SSH Menu',
                    `${_('No se pudo desmontar')} «${montaje.nombre}»: ${e.message}`);
            });
    }

    /**
     * Abre la configuración de SSH en un editor de texto. Si el archivo
     * principal todavía no existe, se crea con un ejemplo comentado.
     *
     * @param {string} [ruta] archivo a abrir; por omisión, el principal
     */
    _editarConfig(ruta = null) {
        const archivo = ruta ?? this._rutaConfig;

        if (!ruta) {
            try {
                if (crearConfigSiFalta(archivo)) {
                    Main.notify('SSH Menu',
                        `${_('Se ha creado')} ${archivo} ${_('con un ejemplo')}`);
                }
            } catch (e) {
                Main.notifyError('SSH Menu',
                    `${_('No se pudo crear')} ${archivo}: ${e.message}`);
                return;
            }
        }

        const configurada = this._settings.get_string('editor-command');
        const valores = {'%f': archivo};

        if (this._lanzar([configurada, ...ALTERNATIVAS_EDITOR], valores))
            return;

        // Reserva: la aplicación predeterminada del sistema.
        this._abrirUri(Gio.File.new_for_path(archivo).get_uri());
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

        // Lecturas, comprobaciones de red y desmontajes pendientes.
        this._cancellable.cancel();
        this._cancellableAcciones.cancel();
        this._comprobador.destruir();
        this._comprobador = null;

        // Monitores de archivo y señales.
        this._pararMonitores();
        // El VolumeMonitor es del proceso: solo se sueltan sus señales.
        for (const {monitor, id} of this._idsVolumenes)
            monitor.disconnect(id);
        this._idsVolumenes = [];

        for (const id of this._idsSettings)
            this._settings.disconnect(id);
        this._idsSettings = [];
        this._settingsWol = null;

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
        this._seccionMontajes = null;
        this._insignia = null;
        this._hosts = [];
        this._archivos = [];
        this._settings = null;
        this._extension = null;

        super.destroy();
    }
});

/* -------------------------------------------------------------------------
 * Punto de entrada de la extensión (API moderna de GNOME 45+)
 * ------------------------------------------------------------------------- */
export default class SshMenuExtension extends Extension {
    /**
     * Crea el indicador y lo añade al panel.
     */
    enable() {
        this._indicador = new IndicadorSsh(this);
        Main.panel.addToStatusArea(this.uuid, this._indicador, 2, 'right');
    }

    /**
     * Destruye el indicador y, con él, todos sus recursos.
     */
    disable() {
        this._indicador?.destroy();
        this._indicador = null;
    }
}

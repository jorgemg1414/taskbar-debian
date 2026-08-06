/*
 * extension.js — Equipos para GNOME Shell 48 (ESM).
 *
 * Indicador en la barra superior que dice cómo está cada equipo de tu
 * ~/.ssh/config —encendido desde cuándo, cuánta memoria y cuánto disco le
 * queda, cuántas actualizaciones tiene pendientes— y permite apagarlo,
 * reiniciarlo o suspenderlo sin abrir una terminal.
 *
 * Es el paso siguiente al punto verde de los otros menús: aquel dice que el
 * puerto 22 acepta conexiones; este entra y pregunta.
 *
 * Las acciones de energía no se pueden deshacer desde aquí, así que viven en el
 * clic derecho y piden confirmación antes de salir.
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

import {
    escanearHosts, agruparHosts, expandirRuta, GRUPO_SIN_NOMBRE,
} from './hosts.js';
import {ComprobadorPuertos, ESTADO, esperarArranque} from './checker.js';
import {SitioEnLaBarra} from './barra.js';
import {ajustesWol, leerEquipos, datosWolDe, despertar, CacheMacs} from './wol.js';
import {
    ItemAcciones, ItemConfirmacion, ItemBuscador, crearInsignia, pintarInsignia,
    crearListaConScroll, ajustarAltoLista, moverFoco, normalizar,
} from './menu.js';
import {
    MonitorVitales, VITALES, SISTEMA, resumen, detalle, porcentaje,
} from './vitales.js';

// Milisegundos que se espera tras un cambio en la configuración antes de
// recargar (los editores guardan en varios pasos).
const RETARDO_RECARGA_MS = 700;

// Segundos que se espera antes de volver a mirar un equipo al que se le acaba
// de mandar apagarse o reiniciarse. Lo justo para que le dé tiempo a irse.
const RETARDO_TRAS_ENERGIA_S = 15;

// Segundos entre sondeo y sondeo mientras se espera a que un equipo arranque.
const INTERVALO_ARRANQUE_S = 5;

// Acciones de energía, en el orden en que salen en el clic derecho. La clave es
// el prefijo de los ajustes: «poweroff-command-linux» y compañía.
const ACCIONES_ENERGIA = [
    {
        clave: 'poweroff',
        icono: 'system-shutdown-symbolic',
        etiqueta: () => _('Apagar'),
        peligrosa: true,
    },
    {
        clave: 'reboot',
        icono: 'system-reboot-symbolic',
        etiqueta: () => _('Reiniciar'),
        peligrosa: true,
    },
    {
        clave: 'suspend',
        icono: 'weather-clear-night-symbolic',
        etiqueta: () => _('Suspender'),
        peligrosa: false,
    },
];

/* -------------------------------------------------------------------------
 * Elemento de menú de un equipo: punto + alias + resumen de sus vitales
 * ------------------------------------------------------------------------- */
const ItemEquipo = GObject.registerClass({
    // El clic derecho no refresca: pide las acciones de ese equipo.
    Signals: {'contexto': {}},
}, class ItemEquipo extends PopupMenu.PopupBaseMenuItem {
    /**
     * @param {object} host equipo a representar
     * @param {object} opciones qué partes de la fila se pintan
     * @param {number} opciones.avisoDisco porcentaje de disco con el que se avisa
     * @param {boolean} opciones.mostrarLatencia si se muestran los milisegundos
     */
    _init(host, {avisoDisco, mostrarLatencia}) {
        super._init();

        this.host = host;
        this._avisoDisco = avisoDisco;

        // Punto de disponibilidad (verde/rojo/gris). El color va en la hoja de
        // estilos. Un equipo detrás de un salto no se sondea.
        this._punto = new St.Widget({
            style_class: 'tb-punto tb-punto-desconocido',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._punto);

        this._etiqueta = new St.Label({
            text: host.nombre,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._etiqueta);
        // Necesario para que el lector de pantalla anuncie el elemento.
        this.label_actor = this._etiqueta;

        // El resumen se pega a la derecha; el hueco que sobra queda en medio.
        this._resumen = new St.Label({
            text: '',
            style_class: 'equipos-resumen',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._resumen);

        if (mostrarLatencia) {
            this._latencia = new St.Label({
                text: '',
                style_class: 'tb-latencia',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._latencia);
        }
    }

    /**
     * Pinta el estado del sondeo del puerto.
     *
     * @param {string} estado valor de ESTADO
     * @param {number|null} latencia milisegundos de respuesta, si se conocen
     */
    fijarEstado(estado, latencia = null) {
        const clases = {
            [ESTADO.ARRIBA]: 'tb-punto tb-punto-arriba',
            [ESTADO.ABAJO]: 'tb-punto tb-punto-abajo',
            [ESTADO.COMPROBANDO]: 'tb-punto tb-punto-comprobando',
            [ESTADO.DESCONOCIDO]: 'tb-punto tb-punto-desconocido',
        };
        this._punto.style_class = clases[estado] ?? clases[ESTADO.DESCONOCIDO];

        // Los milisegundos solo dicen algo de un equipo que responde.
        if (this._latencia) {
            this._latencia.text =
                estado === ESTADO.ARRIBA && latencia !== null ? `${latencia} ms` : '';
        }
    }

    /**
     * Pinta lo que el equipo ha contado de sí mismo.
     *
     * @param {string} estadoVitales valor de VITALES
     * @param {object|null} datos vitales, si las hay
     * @param {string} error motivo del fallo, si lo hubo
     */
    fijarVitales(estadoVitales, datos, error) {
        this._resumen.remove_style_class_name('equipos-alerta');

        if (estadoVitales === VITALES.OK && datos) {
            this._resumen.text = resumen(datos);

            // El disco casi lleno es lo único que hay que ver sin leer.
            const usado = porcentaje(datos.disco);
            if (usado !== null && usado >= this._avisoDisco)
                this._resumen.add_style_class_name('equipos-alerta');

            // Al lector de pantalla se le da el detalle entero: no tiene por
            // qué conformarse con lo que cabe en la fila.
            this.accessible_name =
                `${this.host.nombre}. ${detalle(datos).replace(/\n/g, '. ')}`;
        } else if (estadoVitales === VITALES.CONSULTANDO) {
            this._resumen.text = _('consultando…');
            this.accessible_name = `${this.host.nombre} — ${_('consultando…')}`;
        } else if (estadoVitales === VITALES.ERROR) {
            this._resumen.text = error;
            this._resumen.add_style_class_name('equipos-alerta');
            this.accessible_name = `${this.host.nombre} — ${error}`;
        } else {
            this._resumen.text = '';
            this.accessible_name = this.host.nombre;
        }
    }

    /**
     * Con el botón derecho no se refresca: se piden sus acciones.
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
 * Indicador del panel
 * ------------------------------------------------------------------------- */
const IndicadorEquipos = GObject.registerClass(
class IndicadorEquipos extends PanelMenu.Button {
    /**
     * @param {Extension} extension instancia de la extensión (settings, openPreferences)
     */
    _init(extension) {
        super._init(0.5, 'Equipos');

        this._extension = extension;
        this._settings = extension.getSettings();

        this._hosts = [];
        this._items = new Map();      // id de equipo -> ItemEquipo
        this._archivos = [];          // archivos de configuración leídos
        this._motivoVacio = null;     // 'inexistente' | 'vacia' | null
        this._monitores = [];         // {monitor, handlerId}
        this._idsSettings = [];
        this._scroll = null;
        this._seccionLista = null;
        this._contexto = null;        // fila de acciones o de confirmación
        this._idRecarga = 0;
        this._idIntervalo = 0;
        this._idsEspera = [];         // recomprobaciones tras apagar o reiniciar
        this._buscador = null;        // ItemBuscador, si hay equipos de sobra
        this._cabeceras = [];         // {cabecera, items} por grupo, para filtrar
        this._itemSinCoincidencias = null;
        this._textoFiltro = '';
        this._idFoco = 0;             // idle para enfocar el buscador
        this._idIntervaloFondo = 0;   // sondeo con el menú cerrado
        this._settingsWol = null;     // ajustes de la extensión Wake on LAN
        this._wolConsultado = false;  // si ya se buscó esa extensión
        this._encendiendo = new Set();// equipos con un arranque en curso
        this._cancellable = new Gio.Cancellable();
        // Las acciones de energía tienen su propio cancelable: recargar la
        // configuración no debe abortar un apagado a medias.
        this._cancellableAcciones = new Gio.Cancellable();
        this._destruido = false;

        this._icono = new St.Icon({
            icon_name: this._settings.get_string('panel-icon'),
            style_class: 'system-status-icon',
        });
        this.add_child(this._icono);

        // Contador de equipos sin respuesta, para enterarte sin abrir el menú.
        this._insignia = crearInsignia();
        this.add_child(this._insignia);

        this._macs = new CacheMacs(this._settings, 'equipos-menu');

        this._comprobador = new ComprobadorPuertos({
            timeout: this._settings.get_int('check-timeout'),
            alCambiar: (id, estado, latencia) => {
                this._items.get(id)?.fijarEstado(estado, latencia);
                this._actualizarInsignia();
                // Preguntarle las vitales a un equipo que no acepta conexiones
                // es esperar a que ssh agote su propio plazo para nada.
                const host = this._hostDe(id);
                if (estado === ESTADO.ARRIBA && host && this.menu.isOpen)
                    this._monitor.pedir(host);

                // Un equipo que acaba de responder tiene su MAC recién puesta
                // en la tabla ARP: es el momento de apuntarla, que es lo que
                // permitirá encenderlo el día que aparezca en rojo.
                if (estado === ESTADO.ARRIBA)
                    this._macs.programar(() => this._ipsQueResponden());

                // Y las de hace un minuto ya no dicen nada de un equipo que
                // acaba de dejar de responder.
                if (estado === ESTADO.ABAJO)
                    this._monitor.olvidar(id);
            },
        });

        this._monitor = new MonitorVitales({
            conexion: this._opcionesConexion(),
            actualizaciones: this._settings.get_boolean('show-updates'),
            alCambiar: id => this._actualizarVitales(id),
        });

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
     * Opciones de conexión de ssh según los ajustes.
     *
     * @returns {object} opciones para argvSsh()
     */
    _opcionesConexion() {
        return {
            timeout: this._settings.get_int('connect-timeout'),
            reutilizar: this._settings.get_boolean('reuse-connection'),
            persistir: this._settings.get_int('persist-seconds'),
        };
    }

    /**
     * Equipos cuyo puerto tiene sentido sondear. Los que se alcanzan a través
     * de un salto no aceptan conexión directa: el punto sería mentira, aunque
     * ssh sí sepa llegar a ellos.
     *
     * @returns {object[]} equipos alcanzables directamente
     */
    get _comprobables() {
        return this._hosts.filter(h => !h.salto);
    }

    /**
     * Equipo por su identificador.
     *
     * @param {string} id identificador
     * @returns {object|null} equipo, o null si ya no está
     */
    _hostDe(id) {
        return this._hosts.find(h => h.id === id) ?? null;
    }

    /* --------------------------- Ajustes ---------------------------- */

    /**
     * Reacciona a los cambios de configuración sin recargar el shell.
     */
    _conectarSettings() {
        const conectar = (clave, cb) =>
            this._idsSettings.push(this._settings.connect(`changed::${clave}`, cb));

        conectar('config-path', () => this.recargar());
        conectar('show-latency', () => this._reconstruirMenu());
        conectar('enable-search', () => this._reconstruirMenu());
        conectar('search-threshold', () => this._reconstruirMenu());
        conectar('background-check-interval', () => this._programarIntervaloFondo());
        conectar('disk-warning', () => this._reconstruirMenu());
        conectar('panel-icon', () =>
            (this._icono.icon_name = this._settings.get_string('panel-icon')));
        conectar('panel-badge', () => this._actualizarInsignia());
        conectar('check-timeout', () =>
            (this._comprobador.timeout = this._settings.get_int('check-timeout')));
        conectar('show-updates', () =>
            (this._monitor.actualizaciones = this._settings.get_boolean('show-updates')));
        conectar('refresh-interval', () => {
            if (this.menu.isOpen)
                this._programarIntervalo();
        });
        conectar('enable-checks', () => {
            this._programarIntervaloFondo();
            this._reconstruirMenu();
            if (this.menu.isOpen)
                this._alAbrirMenu();
            else
                this._comprobador.cancelarPendientes();
            this._actualizarInsignia();
        });

        for (const clave of ['connect-timeout', 'reuse-connection', 'persist-seconds'])
            conectar(clave, () => (this._monitor.conexion = this._opcionesConexion()));
    }

    /* ------------------------ Carga de datos ------------------------ */

    /**
     * Vuelve a leer la configuración de SSH y reconstruye el menú.
     */
    recargar() {
        if (this._destruido)
            return;

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

                const vivos = new Set(this._hosts.map(h => h.id));
                this._comprobador.podar(vivos);
                this._monitor.podar(vivos);

                this._reconstruirMenu();
                this._actualizarInsignia();
                this._vigilarConfig();

                if (this.menu.isOpen)
                    this._preguntar();
            })
            .catch(e => {
                if (this._destruido)
                    return;
                console.error(`[equipos-menu] Error al leer la configuración: ${e.message}`);
                this._motivoVacio = 'inexistente';
                this._reconstruirMenu();
            });
    }

    /**
     * Vigila los archivos de configuración leídos, para que el menú cambie en
     * cuanto edites un bloque.
     *
     * Mientras no exista ninguno se vigila la carpeta, que es la única forma de
     * enterarse de que se crea.
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
                console.warn(`[equipos-menu] No se pudo vigilar ${ruta}: ${e.message}`);
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

    /* ------------------------- Consultas ---------------------------- */

    /**
     * Al abrir el menú: sondea los puertos y pide las vitales.
     */
    _alAbrirMenu() {
        // El área de trabajo puede haber cambiado (otro monitor, otra escala).
        ajustarAltoLista(this._scroll);

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

        this._preguntar();
        this._programarIntervalo();
    }

    /**
     * Al cerrar el menú: se para el refresco y se abandona lo que hubiera en
     * vuelo. Con el menú cerrado no se toca la red.
     */
    _alCerrarMenu() {
        this._pararIntervalo();
        this._comprobador.cancelarPendientes();
        this._monitor.cancelarPendientes();
        this._cerrarContexto();

        // El filtro no sobrevive al cierre: al reabrir se ve la lista completa.
        if (this._textoFiltro) {
            this._textoFiltro = '';
            this._buscador?.entrada.set_text('');
            this._aplicarFiltro('');
        }
    }

    /**
     * Pide el estado de todos los equipos.
     *
     * El sondeo del puerto tarda milisegundos y la consulta por SSH, segundos:
     * por eso van los dos. El punto se pinta enseguida y el resumen llega
     * después. A los equipos que van por un salto no se les puede sondear, así
     * que a esos se les pregunta directamente.
     */
    _preguntar() {
        if (this._settings.get_boolean('enable-checks')) {
            this._comprobador.comprobarTodas(this._comprobables);
            this._monitor.pedirTodos(this._hosts.filter(h =>
                h.salto || this._comprobador.estadoDe(h.id) === ESTADO.ARRIBA));
        } else {
            this._monitor.pedirTodos(this._hosts);
        }
    }

    /**
     * (Re)programa el refresco periódico mientras el menú está abierto.
     */
    _programarIntervalo() {
        this._pararIntervalo();

        const segundos = this._settings.get_int('refresh-interval');
        this._idIntervalo = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, segundos, () => {
            this._preguntar();
            return GLib.SOURCE_CONTINUE;
        });
    }

    /**
     * (Re)programa el sondeo con el menú cerrado. Desactivado por omisión.
     *
     * Solo se sondea el puerto: pedir las vitales es abrir una conexión SSH, y
     * eso no se hace si nadie está mirando.
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

    /**
     * Detiene el refresco periódico.
     */
    _pararIntervalo() {
        if (this._idIntervalo) {
            GLib.source_remove(this._idIntervalo);
            this._idIntervalo = 0;
        }
    }

    /**
     * Vuelca en la fila de un equipo lo último que se sabe de él.
     *
     * @param {string} id identificador del equipo
     */
    _actualizarVitales(id) {
        this._items.get(id)?.fijarVitales(
            this._monitor.estadoDe(id),
            this._monitor.datosDe(id),
            this._monitor.errorDe(id));
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

        this._pintarBuscador();
        this._pintarLista();

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addMenuItem(new ItemAcciones([
            {
                icono: 'view-refresh-symbolic',
                texto: _('Actualizar'),
                alPulsar: () => this._preguntar(),
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
     * Pinta la lista de equipos dentro de una zona con desplazamiento, para que
     * el menú nunca crezca más que la pantalla y el pie quede siempre visible.
     */
    _pintarLista() {
        ({scroll: this._scroll, seccion: this._seccionLista} = crearListaConScroll(this.menu));

        if (this._motivoVacio === 'inexistente') {
            this._itemInformativo(_('No se encontró la configuración de SSH:'));
            this._itemInformativo(this._rutaConfig);
        } else if (this._motivoVacio === 'vacia') {
            this._itemInformativo(_('No hay ningún bloque «Host» en la configuración'));
        } else if (this._hosts.length === 0) {
            this._itemInformativo(_('Cargando equipos…'));
        } else {
            this._pintarGrupos();
        }

        ajustarAltoLista(this._scroll);
    }

    /**
     * Añade los equipos agrupados, con un separador por grupo.
     */
    _pintarGrupos() {
        const grupos = agruparHosts(this._hosts);
        const avisoDisco = this._settings.get_int('disk-warning');
        const hayVariosGrupos = grupos.length > 1 || grupos[0]?.nombre !== GRUPO_SIN_NOMBRE;

        const opciones = {
            avisoDisco,
            mostrarLatencia: this._settings.get_boolean('show-latency') &&
                             this._settings.get_boolean('enable-checks'),
        };

        let primero = true;
        for (const grupo of grupos) {
            const itemsDelGrupo = [];

            let cabecera = null;
            if (hayVariosGrupos) {
                cabecera = new PopupMenu.PopupSeparatorMenuItem(grupo.nombre);
                if (primero)
                    cabecera.add_style_class_name('tb-primera-cabecera');
                this._seccionLista.addMenuItem(cabecera);
            }
            primero = false;

            for (const host of grupo.hosts) {
                const item = new ItemEquipo(host, opciones);
                item.fijarEstado(
                    host.salto ? ESTADO.DESCONOCIDO : this._comprobador.estadoDe(host.id),
                    this._comprobador.latenciaDe(host.id));
                item.fijarVitales(
                    this._monitor.estadoDe(host.id),
                    this._monitor.datosDe(host.id),
                    this._monitor.errorDe(host.id));

                // El clic normal no hace nada irreversible: vuelve a preguntar.
                item.connect('activate', () => {
                    this._comprobador.comprobar(host);
                    this._monitor.pedir(host);
                });
                item.connect('contexto', () => this._alternarContexto(item));

                this._seccionLista.addMenuItem(item);
                this._items.set(host.id, item);
                itemsDelGrupo.push(item);
            }

            if (cabecera)
                this._cabeceras.push({cabecera, items: itemsDelGrupo});
        }

        // Aviso que solo se ve cuando el filtro no encuentra nada.
        this._itemSinCoincidencias = new PopupMenu.PopupMenuItem(
            _('Ningún equipo coincide'), {reactive: false, style_class: 'tb-aviso'});
        this._itemSinCoincidencias.visible = false;
        this._seccionLista.addMenuItem(this._itemSinCoincidencias);

        // Si se venía filtrando (p. ej. tras recargar), se mantiene el filtro.
        if (this._textoFiltro)
            this._aplicarFiltro(this._textoFiltro);
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
            pista: _('Buscar equipo…'),
            texto: this._textoFiltro,
            alEscribir: texto => this._aplicarFiltro(texto),
            alAceptar: () => this._activarPrimeroVisible(),
            alNavegar: delta => this._moverFoco(delta),
        });
        this.menu.addMenuItem(this._buscador);
    }

    /**
     * Oculta los equipos que no coinciden, y con ellos las cabeceras de los
     * grupos que quedan vacíos.
     *
     * @param {string} texto texto del filtro
     */
    _aplicarFiltro(texto) {
        this._textoFiltro = texto;
        const busqueda = normalizar(texto).trim();

        // La fila de acciones se refiere a un equipo concreto; si la lista
        // cambia debajo, deja de tener sentido.
        this._cerrarContexto();

        let visibles = 0;
        for (const item of this._items.values()) {
            const {nombre, host, usuario, grupo} = item.host;
            const heno = normalizar(`${nombre} ${host} ${usuario} ${grupo}`);
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
     * Mueve el foco entre los equipos visibles.
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
     * Refresca el primer equipo visible (Intro en el buscador).
     */
    _activarPrimeroVisible() {
        for (const item of this._items.values()) {
            if (!item.visible)
                continue;
            this._comprobador.comprobar(item.host);
            this._monitor.pedir(item.host);
            return;
        }
    }

    /**
     * Actualiza el contador del panel con los equipos que no responden.
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

        pintarInsignia(this._insignia, caidos);
        this.accessible_name = caidos > 0
            ? `${_('Equipos')} — ${caidos} ${_('sin respuesta')}`
            : _('Equipos');
    }

    /**
     * Añade una línea de texto no pulsable (avisos, errores).
     *
     * @param {string} texto texto a mostrar
     */
    _itemInformativo(texto) {
        this._seccionLista.addMenuItem(
            new PopupMenu.PopupMenuItem(texto, {reactive: false, style_class: 'tb-aviso'}));
    }

    /* -------------------------- Menú contextual ---------------------- */

    /**
     * Abre (o cierra) la fila de acciones de un equipo, justo debajo de él.
     *
     * @param {ItemEquipo} item elemento sobre el que se pulsó
     */
    _alternarContexto(item) {
        const yaAbierto = this._contexto?._idHost === item.host.id;
        this._cerrarContexto();
        if (yaAbierto)
            return;

        const host = item.host;
        const acciones = [];

        // Encender va primero porque es lo contrario de apagar, y solo aparece
        // si el equipo no responde: si contesta ya está encendido. No pide
        // confirmación —no hay nada que deshacer— al revés que las otras tres.
        const wol = this._wolDe(host);
        if (wol && this._comprobador.estadoDe(host.id) !== ESTADO.ARRIBA &&
            !this._encendiendo.has(host.id)) {
            acciones.push({
                icono: 'system-run-symbolic',
                texto: _('Encender'),
                peligrosa: false,
                alPulsar: () => {
                    this._cerrarContexto();
                    this._encender(host, wol);
                },
            });
        }

        acciones.push(...ACCIONES_ENERGIA.map(accion => ({
            icono: accion.icono,
            texto: accion.etiqueta(),
            peligrosa: accion.peligrosa,
            alPulsar: () => this._pedirEnergia(item, accion),
        })));

        acciones.push({
            icono: 'edit-copy-symbolic',
            texto: _('Copiar'),
            alPulsar: () => {
                St.Clipboard.get_default().set_text(
                    St.ClipboardType.CLIPBOARD, `ssh ${host.nombre}`);
                this._cerrarContexto();
            },
        });

        this._abrirContexto(item, new ItemAcciones(acciones));
    }

    /**
     * Pone una fila debajo de un equipo, sustituyendo a la que hubiera.
     *
     * @param {ItemEquipo} item equipo bajo el que va la fila
     * @param {PopupMenu.PopupBaseMenuItem} fila fila a insertar
     */
    _abrirContexto(item, fila) {
        this._cerrarContexto();
        fila._idHost = item.host.id;

        const posicion = this._seccionLista._getMenuItems().indexOf(item);
        this._seccionLista.addMenuItem(fila, posicion + 1);
        this._contexto = fila;
    }

    /**
     * Quita la fila de acciones, si hay alguna abierta.
     */
    _cerrarContexto() {
        this._contexto?.destroy();
        this._contexto = null;
    }

    /* ------------------------- Encendido ---------------------------- */

    /**
     * Direcciones de los equipos que están respondiendo ahora mismo, que son
     * los únicos de los que se puede aprender la MAC.
     *
     * @returns {string[]} direcciones de los equipos que contestan
     */
    _ipsQueResponden() {
        return this._hosts
            .filter(h => this._comprobador.estadoDe(h.id) === ESTADO.ARRIBA)
            .map(h => h.host);
    }

    /**
     * Con qué datos se puede encender un equipo, si es que se puede.
     *
     * Salen del comentario «# MAC:» de su bloque, de los equipos que tengas
     * dados de alta en la extensión Wake on LAN, o de lo aprendido de la tabla
     * ARP mientras el equipo respondía.
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

        return datosWolDe(
            host,
            leerEquipos(this._settingsWol),
            this._macs.macDe(host.host));
    }

    /**
     * Manda el paquete mágico y espera a que el equipo conteste.
     *
     * Aquí sí se puede esperar, a diferencia de los otros menús: este ya sabe
     * por qué puerto se le pregunta al equipo, así que en vez de decir
     * «paquete enviado» —lo único que garantiza el protocolo— se sondea hasta
     * que responde de verdad.
     *
     * @param {object} host equipo a encender
     * @param {object} datos mac, destino y puerto del paquete
     */
    async _encender(host, datos) {
        const error = await despertar(datos, this._cancellableAcciones);
        if (this._destruido)
            return;

        if (error) {
            Main.notifyError('Equipos',
                `${_('No se pudo encender')} «${host.nombre}»: ${error}`);
            return;
        }

        const limite = this._settings.get_int('boot-timeout');
        if (limite <= 0 || host.salto) {
            Main.notify('Equipos',
                `${_('Paquete de encendido enviado a')} «${host.nombre}»`);
            return;
        }

        Main.notify('Equipos',
            `${_('Encendiendo')} «${host.nombre}»…`);

        this._encendiendo.add(host.id);
        this._items.get(host.id)?.fijarEstado(ESTADO.COMPROBANDO);

        let segundos = null;
        try {
            segundos = await esperarArranque(
                host,
                {
                    timeout: this._settings.get_int('check-timeout'),
                    intervalo: INTERVALO_ARRANQUE_S,
                    limite,
                },
                this._cancellableAcciones);
        } finally {
            this._encendiendo.delete(host.id);
        }

        if (this._destruido)
            return;

        if (segundos === null) {
            Main.notifyError('Equipos',
                `«${host.nombre}» ${_('sigue sin responder tras')} ${limite} s`);
        } else {
            Main.notify('Equipos',
                `«${host.nombre}» ${_('ya responde')} (${segundos} s)`);
        }

        // Sea cual sea el resultado, el estado real lo fija el comprobador; y
        // si arrancó, ya se le pueden pedir las vitales.
        this._comprobador.comprobar(host);
        if (segundos !== null && this.menu.isOpen)
            this._monitor.pedir(host);
    }

    /* ------------------------- Energía ------------------------------ */

    /**
     * Pide confirmación antes de apagar, reiniciar o suspender.
     *
     * Se pregunta en el propio menú, no en un diálogo: el diálogo robaría el
     * foco y cerraría el menú, y aquí lo que hace falta es que el sí esté al
     * lado del equipo al que se refiere.
     *
     * @param {ItemEquipo} item equipo sobre el que se actúa
     * @param {object} accion acción de ACCIONES_ENERGIA
     */
    _pedirEnergia(item, accion) {
        if (!this._settings.get_boolean('confirm-power')) {
            this._cerrarContexto();
            this._ejecutarEnergia(item.host, accion);
            return;
        }

        this._abrirContexto(item, new ItemConfirmacion({
            pregunta: `¿${accion.etiqueta()} «${item.host.nombre}»?`,
            textoSi: _('Sí'),
            textoNo: _('No'),
            alConfirmar: () => {
                this._cerrarContexto();
                this._ejecutarEnergia(item.host, accion);
            },
            alCancelar: () => this._cerrarContexto(),
        }));
    }

    /**
     * Manda la orden de energía al equipo y cuenta lo que pasó.
     *
     * @param {object} host equipo destino
     * @param {object} accion acción de ACCIONES_ENERGIA
     */
    async _ejecutarEnergia(host, accion) {
        const etiqueta = accion.etiqueta();

        try {
            const sistema = await this._monitor.sistema(host, this._cancellableAcciones);
            const familia = sistema === SISTEMA.WINDOWS ? 'windows' : 'linux';
            const orden = this._settings.get_string(`${accion.clave}-command-${familia}`).trim();

            if (orden === '') {
                Main.notifyError('Equipos',
                    `${_('No hay orden configurada para')} «${etiqueta}» ${_('en')} ${familia}`);
                return;
            }

            const {error, codigo} = await this._monitor.ejecutarCrudo(
                host, orden, this._cancellableAcciones);

            if (this._destruido)
                return;

            // Que la conexión se corte a mitad no es un fallo: es el equipo
            // haciendo exactamente lo que se le pidió.
            const seFue = /closed by remote host|connection reset|broken pipe/i.test(error);

            if (codigo === 0 || seFue) {
                Main.notify('Equipos', `«${host.nombre}»: ${etiqueta.toLowerCase()}`);
                this._trasEnergia(host);
                return;
            }

            Main.notifyError('Equipos',
                `${_('No se pudo')} ${etiqueta.toLowerCase()} «${host.nombre}»: ${this._explicarEnergia(error)}`);
        } catch (e) {
            if (!this._destruido && !e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                Main.notifyError('Equipos',
                    `${_('No se pudo')} ${etiqueta.toLowerCase()} «${host.nombre}»: ${e.message}`);
            }
        }
    }

    /**
     * Traduce el fallo más típico de estas órdenes: logind no deja apagar a una
     * sesión que no está delante del equipo, y lo dice de una forma que no
     * ayuda nada.
     *
     * @param {string} error salida de error de la orden
     * @returns {string} explicación de una línea
     */
    _explicarEnergia(error) {
        const texto = (error ?? '').trim();

        if (/interactive authentication required/i.test(texto)) {
            return _('el equipo exige autenticación para apagarse desde una sesión ' +
                     'remota; hace falta una regla de polkit o sudo (mira el README)');
        }
        if (/access is denied|acceso denegado/i.test(texto))
            return _('el usuario remoto no tiene permiso para apagar el equipo');

        const primera = texto.split('\n').find(l => l.trim() !== '');
        return primera ? primera.trim() : _('falló sin decir por qué');
    }

    /**
     * Tras una orden de energía, el equipo tarda un poco en irse: se le deja
     * ese rato y se vuelve a mirar, para que el punto diga la verdad.
     *
     * @param {object} host equipo al que se le mandó la orden
     */
    _trasEnergia(host) {
        this._items.get(host.id)?.fijarEstado(ESTADO.COMPROBANDO);
        this._items.get(host.id)?.fijarVitales(VITALES.DESCONOCIDO, null, '');

        const id = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, RETARDO_TRAS_ENERGIA_S, () => {
                this._idsEspera = this._idsEspera.filter(otro => otro !== id);
                if (!this._destruido) {
                    this._comprobador.comprobar(host);
                    if (this.menu.isOpen)
                        this._monitor.pedir(host);
                }
                return GLib.SOURCE_REMOVE;
            });
        this._idsEspera.push(id);
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
        this._pararIntervalo();
        if (this._idIntervaloFondo) {
            GLib.source_remove(this._idIntervaloFondo);
            this._idIntervaloFondo = 0;
        }
        if (this._idFoco) {
            GLib.source_remove(this._idFoco);
            this._idFoco = 0;
        }
        for (const id of this._idsEspera)
            GLib.source_remove(id);
        this._idsEspera = [];

        // La caché de MAC lleva dentro su propio temporizador y su cancelable.
        this._macs.destruir();
        this._macs = null;

        this._cancellable.cancel();
        this._cancellableAcciones.cancel();
        this._comprobador.destruir();
        this._comprobador = null;
        this._monitor.destruir();
        this._monitor = null;

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
        this._encendiendo.clear();
        this._scroll = null;
        this._seccionLista = null;
        this._contexto = null;
        this._insignia = null;
        this._hosts = [];
        this._archivos = [];
        this._settingsWol = null;
        this._settings = null;
        this._extension = null;

        super.destroy();
    }
});

/* -------------------------------------------------------------------------
 * Punto de entrada de la extensión (API moderna de GNOME 45+)
 * ------------------------------------------------------------------------- */
export default class EquiposMenuExtension extends Extension {
    /**
     * Crea el indicador y lo pone en la barra, donde digan los ajustes.
     */
    enable() {
        this._sitio = new SitioEnLaBarra({
            extension: this,
            crear: () => new IndicadorEquipos(this),
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

/*
 * vitales.js — Lo que cuenta cada equipo de sí mismo, preguntado por SSH.
 *
 * La extensión no reimplementa nada de SSH: lanza el cliente `ssh` con el alias
 * del `~/.ssh/config`, igual que escribirías en la terminal, y deja que sea él
 * quien aplique usuario, puerto, clave y `ProxyJump`. Con `BatchMode=yes` no se
 * pide ninguna contraseña: si la clave no está autorizada, la consulta falla y
 * se dice, que es justo lo que hay que arreglar (herramientas/autorizar-clave.sh).
 *
 * Las conexiones se reaprovechan con `ControlMaster`: la primera consulta paga
 * el saludo completo y las siguientes viajan por el mismo túnel, así que
 * refrescar seis equipos cada minuto no abre seis conexiones cada minuto.
 *
 * El comando remoto se manda de una sola pieza y sin comillas que se puedan
 * escapar: en POSIX va con `sh -c` y lo entrecomilla GLib; en Windows va con
 * `powershell -EncodedCommand`, que recibe el script en base64 y así no lo toca
 * ni `cmd`.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {comunicar} from './asyncgio.js';

// Sistemas que se saben preguntar.
export const SISTEMA = {
    POSIX: 'linux',
    WINDOWS: 'windows',
    DESCONOCIDO: 'desconocido',
};

// Estado de la consulta de un equipo.
export const VITALES = {
    DESCONOCIDO: 'desconocido',
    CONSULTANDO: 'consultando',
    OK: 'ok',
    ERROR: 'error',
};

// Consultas simultáneas como máximo. Cada una es una conexión SSH: con más de
// cuatro a la vez se nota en el arranque del menú y no se gana nada.
const MAX_PARALELO = 4;

/**
 * Script POSIX que imprime las vitales en líneas «clave=valor».
 *
 * Todo sale de /proc y de df, que están en cualquier Linux sin instalar nada.
 * Las cantidades van en KiB, que es como las da el propio sistema.
 *
 * @param {boolean} conActualizaciones si se cuentan los paquetes pendientes
 * @returns {string} script de una sola pieza
 */
function scriptPosix(conActualizaciones) {
    const partes = [
        'echo "so=linux"',
        'echo "nombre=$(uname -n)"',
        'read u r < /proc/uptime; echo "arranque=${u%%.*}"',
        'read a b c r < /proc/loadavg; echo "carga=$a $b $c"',
        'awk \'/^MemTotal:/{t=$2} /^MemAvailable:/{d=$2} END{if(t>0) printf "memoria=%d %d\\n", t, t-d}\' /proc/meminfo',
        'df -P / | awk \'NR==2{printf "disco=%d %d\\n", $2, $3}\'',
    ];

    // `apt-get -s` es una simulación: no necesita permisos ni toca la red.
    if (conActualizaciones) {
        partes.push(
            'command -v apt-get >/dev/null 2>&1 && ' +
            'echo "actualizaciones=$(apt-get -s -o Debug::NoLocking=1 upgrade 2>/dev/null | grep -c \'^Inst \')"');
    }

    // El «true» final evita que el script termine con código de error si la
    // última orden no encontró nada que contar.
    return `${partes.join('; ')}; true`;
}

/**
 * Script de PowerShell equivalente para Windows.
 *
 * @param {boolean} conActualizaciones si se cuentan las actualizaciones
 * @returns {string} script de una sola pieza
 */
function scriptWindows(conActualizaciones) {
    const partes = [
        '$ErrorActionPreference = "SilentlyContinue"',
        '$so = Get-CimInstance Win32_OperatingSystem',
        '"so=windows"',
        '"nombre=" + $env:COMPUTERNAME',
        '"arranque=" + [int]((Get-Date) - $so.LastBootUpTime).TotalSeconds',
        // TotalVisibleMemorySize y FreePhysicalMemory ya vienen en KiB.
        '"memoria=" + $so.TotalVisibleMemorySize + " " + ($so.TotalVisibleMemorySize - $so.FreePhysicalMemory)',
        '$d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID=\'C:\'"',
        '"disco=" + [int]($d.Size / 1024) + " " + [int](($d.Size - $d.FreeSpace) / 1024)',
        // Windows no tiene carga media: lo más parecido es el uso de CPU.
        '"cpu=" + (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average',
    ];

    // Las actualizaciones pendientes salen del agente de Windows Update, que
    // en un equipo con directivas puede tardar; por eso es opcional.
    if (conActualizaciones) {
        partes.push(
            '$b = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher().' +
            'Search("IsInstalled=0 and IsHidden=0").Updates.Count',
            'if ($b -ne $null) { "actualizaciones=" + $b }');
    }

    return partes.join('; ');
}

/**
 * Codifica un script de PowerShell para `-EncodedCommand`: UTF-16LE en base64.
 *
 * Es la forma de mandarlo sin que lo toque `cmd`, que es el intérprete con el
 * que recibe las órdenes un Windows con OpenSSH por omisión. En base64 solo hay
 * letras, cifras, '+', '/' y '=', así que no queda nada que entrecomillar.
 *
 * @param {string} script script en texto claro
 * @returns {string} el mismo script en base64 UTF-16LE
 */
function codificarPowershell(script) {
    const bytes = new Uint8Array(script.length * 2);
    for (let i = 0; i < script.length; i++) {
        const punto = script.charCodeAt(i);
        bytes[i * 2] = punto & 0xff;
        bytes[i * 2 + 1] = punto >> 8;
    }
    return GLib.base64_encode(bytes);
}

/**
 * Envuelve un script en la orden que hay que mandarle al equipo.
 *
 * @param {string} sistema valor de SISTEMA
 * @param {string} script script a ejecutar
 * @returns {string} orden remota, lista para pasársela a ssh
 */
function ordenDe(sistema, script) {
    if (sistema === SISTEMA.WINDOWS)
        return `powershell -NoProfile -NonInteractive -EncodedCommand ${codificarPowershell(script)}`;

    // GLib.shell_quote deja el script en una sola palabra para el intérprete
    // remoto, comillas internas incluidas.
    return `sh -c ${GLib.shell_quote(script)}`;
}

/**
 * Orden con la que se le pregunta a un equipo qué sistema tiene.
 *
 * `uname` no existe en Windows y `ver` no existe en POSIX, así que la respuesta
 * dice cuál de los dos es. El `||` lo entienden tanto los intérpretes POSIX
 * como `cmd`.
 *
 * @returns {string} orden remota
 */
function ordenSistema() {
    return 'uname -s || ver';
}

/**
 * Interpreta la respuesta de la pregunta anterior.
 *
 * @param {string} salida lo que contestó el equipo
 * @returns {string} valor de SISTEMA
 */
function interpretarSistema(salida) {
    const texto = salida.toLowerCase();
    if (texto.includes('windows'))
        return SISTEMA.WINDOWS;
    if (/linux|darwin|bsd|sunos|aix/.test(texto))
        return SISTEMA.POSIX;
    return SISTEMA.DESCONOCIDO;
}

/**
 * Normaliza lo que se haya escrito en un comentario «# Sistema:».
 *
 * @param {string} texto valor del comentario
 * @returns {string} valor de SISTEMA, o cadena vacía si no dice nada útil
 */
export function sistemaDeclarado(texto) {
    const t = (texto ?? '').trim().toLowerCase();
    if (t === '')
        return '';
    if (t.startsWith('win'))
        return SISTEMA.WINDOWS;
    if (/linux|posix|unix|bsd|mac|darwin/.test(t))
        return SISTEMA.POSIX;
    return '';
}

/**
 * Argumentos completos del cliente ssh para una orden remota.
 *
 * @param {object} host equipo del menú (solo se usa su alias)
 * @param {string} orden orden remota
 * @param {object} opciones opciones de conexión
 * @param {number} opciones.timeout segundos de espera al conectar
 * @param {boolean} opciones.reutilizar si se comparte la conexión (ControlMaster)
 * @param {number} opciones.persistir segundos que sigue viva la conexión compartida
 * @returns {string[]} argv listo para Gio.Subprocess
 */
export function argvSsh(host, orden, {timeout, reutilizar, persistir}) {
    const argv = [
        'ssh',
        // Sin terminal ni entrada estándar: esto no es una sesión interactiva.
        '-n',
        '-T',
        // Nunca preguntar nada: sin clave autorizada, que falle y se vea.
        '-o', 'BatchMode=yes',
        '-o', `ConnectTimeout=${timeout}`,
    ];

    if (reutilizar) {
        // %C es un resumen de usuario/host/puerto: mantiene la ruta corta, que
        // en un socket unix no puede pasar de ~100 caracteres.
        const carpeta = GLib.get_user_runtime_dir() || GLib.get_tmp_dir();
        argv.push(
            '-o', 'ControlMaster=auto',
            '-o', `ControlPath=${GLib.build_filenamev([carpeta, 'equipos-menu-%C'])}`,
            '-o', `ControlPersist=${persistir}`);
    }

    // El alias, y detrás la orden de una sola pieza.
    argv.push(host.nombre, orden);
    return argv;
}

/**
 * Convierte la salida «clave=valor» en los datos que pinta el menú.
 *
 * @param {string} texto respuesta del equipo
 * @returns {object} vitales; las claves que no vengan se quedan sin poner
 */
export function parsearVitales(texto) {
    const datos = {};

    for (const linea of texto.split(/\r?\n/)) {
        const corte = linea.indexOf('=');
        if (corte <= 0)
            continue;

        const clave = linea.slice(0, corte).trim();
        const valor = linea.slice(corte + 1).trim();
        const numeros = valor.split(/\s+/).map(Number);

        switch (clave) {
        case 'so':
            datos.so = valor;
            break;
        case 'nombre':
            datos.nombre = valor;
            break;
        case 'arranque':
            if (Number.isFinite(numeros[0]))
                datos.arranque = numeros[0];
            break;
        case 'carga':
            if (numeros.every(n => Number.isFinite(n)))
                datos.carga = numeros;
            break;
        case 'cpu':
            if (Number.isFinite(numeros[0]))
                datos.cpu = numeros[0];
            break;
        case 'memoria':
            if (numeros.length === 2 && numeros.every(n => Number.isFinite(n)) && numeros[0] > 0)
                datos.memoria = {total: numeros[0], usada: numeros[1]};
            break;
        case 'disco':
            if (numeros.length === 2 && numeros.every(n => Number.isFinite(n)) && numeros[0] > 0)
                datos.disco = {total: numeros[0], usada: numeros[1]};
            break;
        case 'actualizaciones':
            if (Number.isFinite(numeros[0]))
                datos.actualizaciones = numeros[0];
            break;
        }
    }

    return datos;
}

/**
 * Traduce los fallos más habituales de ssh a algo que diga qué hacer.
 *
 * @param {string} error lo que escribió ssh en su salida de error
 * @returns {string} explicación de una línea
 */
export function explicarError(error) {
    const texto = (error ?? '').trim();

    if (/permission denied|no supported authentication/i.test(texto))
        return 'la clave no está autorizada en el equipo (herramientas/autorizar-clave.sh)';
    if (/host key verification failed/i.test(texto))
        return 'la clave del servidor no está en known_hosts: conéctate una vez con ssh';
    if (/connection timed out|operation timed out/i.test(texto))
        return 'no contesta';
    if (/connection refused/i.test(texto))
        return 'el puerto está cerrado';
    if (/could not resolve|name or service not known/i.test(texto))
        return 'el nombre no se resuelve';
    if (/no route to host|network is unreachable/i.test(texto))
        return 'no hay ruta hasta el equipo';

    // Lo que sea, tal cual, pero solo la primera línea: el resto suele ser el
    // banner del servidor.
    const primera = texto.split('\n').find(l => l.trim() !== '');
    return primera ? primera.trim() : 'falló sin decir por qué';
}

/* -------------------------------------------------------------------------
 * Monitor: consulta en cola, cancelable, con el sistema de cada equipo en caché
 * ------------------------------------------------------------------------- */
export class MonitorVitales {
    /**
     * @param {object} opciones opciones del monitor
     * @param {object} opciones.conexion opciones de ssh (timeout, reutilizar, persistir)
     * @param {boolean} opciones.actualizaciones si se cuentan los paquetes pendientes
     * @param {Function} opciones.alCambiar callback (id) cuando cambia algo de un equipo
     */
    constructor({conexion, actualizaciones = true, alCambiar = () => {}} = {}) {
        this._conexion = conexion;
        this._actualizaciones = actualizaciones;
        this._alCambiar = alCambiar;

        this._datos = new Map();     // id -> vitales
        this._estados = new Map();   // id -> valor de VITALES
        this._errores = new Map();   // id -> explicación del fallo
        this._sistemas = new Map();  // id -> valor de SISTEMA, para no repreguntar
        this._enCurso = new Map();   // id -> Gio.Cancellable
        this._cola = [];
        this._enCola = new Set();
        this._destruido = false;
    }

    /**
     * Cambia las opciones de conexión sin rehacer el monitor.
     *
     * @param {object} conexion nuevas opciones de ssh
     */
    set conexion(conexion) {
        this._conexion = conexion;
    }

    /**
     * Activa o desactiva el recuento de actualizaciones pendientes.
     *
     * @param {boolean} activo si se cuentan
     */
    set actualizaciones(activo) {
        this._actualizaciones = activo;
    }

    /**
     * Vitales conocidas de un equipo.
     *
     * @param {string} id identificador del equipo
     * @returns {object|null} datos, o null si todavía no hay
     */
    datosDe(id) {
        return this._datos.get(id) ?? null;
    }

    /**
     * Estado de la consulta de un equipo.
     *
     * @param {string} id identificador del equipo
     * @returns {string} valor de VITALES
     */
    estadoDe(id) {
        return this._estados.get(id) ?? VITALES.DESCONOCIDO;
    }

    /**
     * Motivo del último fallo de un equipo.
     *
     * @param {string} id identificador del equipo
     * @returns {string} explicación, o cadena vacía
     */
    errorDe(id) {
        return this._errores.get(id) ?? '';
    }

    /**
     * Olvida lo que se sabía de un equipo.
     *
     * Lo usa el menú cuando el sondeo del puerto dice que el equipo ha dejado
     * de responder: seguir enseñando las vitales de hace un minuto sería
     * enseñar algo que ya no es verdad.
     *
     * @param {string} id identificador del equipo
     */
    olvidar(id) {
        const habia = this._datos.has(id) || this._estados.has(id) || this._errores.has(id);
        this._datos.delete(id);
        this._estados.delete(id);
        this._errores.delete(id);

        if (habia && !this._destruido)
            this._alCambiar(id);
    }

    /**
     * Olvida los equipos que ya no existen y cancela sus consultas.
     *
     * @param {Set<string>} idsVivos identificadores que siguen existiendo
     */
    podar(idsVivos) {
        for (const mapa of [this._datos, this._estados, this._errores, this._sistemas]) {
            for (const id of [...mapa.keys()]) {
                if (!idsVivos.has(id))
                    mapa.delete(id);
            }
        }

        for (const [id, cancellable] of [...this._enCurso.entries()]) {
            if (!idsVivos.has(id)) {
                cancellable.cancel();
                this._enCurso.delete(id);
            }
        }

        this._cola = this._cola.filter(h => idsVivos.has(h.id));
        this._enCola = new Set(this._cola.map(h => h.id));
        this._bombear();
    }

    /**
     * Pide las vitales de varios equipos.
     *
     * @param {object[]} hosts equipos a consultar
     */
    pedirTodos(hosts) {
        for (const host of hosts)
            this.pedir(host);
    }

    /**
     * Pone un equipo en la cola de consulta.
     *
     * @param {object} host equipo a consultar
     */
    pedir(host) {
        if (this._destruido || this._enCurso.has(host.id) || this._enCola.has(host.id))
            return;

        this._cola.push(host);
        this._enCola.add(host.id);
        this._fijarEstado(host.id, VITALES.CONSULTANDO);
        this._bombear();
    }

    /**
     * Arranca consultas de la cola hasta llenar los huecos disponibles.
     */
    _bombear() {
        while (!this._destruido &&
               this._enCurso.size < MAX_PARALELO &&
               this._cola.length > 0) {
            const host = this._cola.shift();
            this._enCola.delete(host.id);
            this._consultar(host);
        }
    }

    /**
     * Averigua el sistema del equipo, si hace falta, y le pide las vitales.
     *
     * @param {object} host equipo a consultar
     */
    _consultar(host) {
        const cancellable = new Gio.Cancellable();
        this._enCurso.set(host.id, cancellable);

        this._vitalesDe(host, cancellable)
            .then(datos => {
                if (this._enCurso.get(host.id) === cancellable)
                    this._enCurso.delete(host.id);

                if (!this._destruido && !cancellable.is_cancelled()) {
                    this._datos.set(host.id, datos);
                    this._errores.delete(host.id);
                    this._estados.set(host.id, VITALES.OK);
                    this._alCambiar(host.id);
                }

                this._bombear();
            })
            .catch(e => {
                if (this._enCurso.get(host.id) === cancellable)
                    this._enCurso.delete(host.id);

                if (!this._destruido && !cancellable.is_cancelled() &&
                    !e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    // Los datos anteriores se borran: de un equipo que ya no
                    // contesta no se sabe nada, y dejar los de hace media hora
                    // sería mentir.
                    this._datos.delete(host.id);
                    this._errores.set(host.id, e.message);
                    this._estados.set(host.id, VITALES.ERROR);
                    this._alCambiar(host.id);
                }

                this._bombear();
            });
    }

    /**
     * Consulta completa de un equipo: sistema (si no se sabe) y vitales.
     *
     * @param {object} host equipo a consultar
     * @param {Gio.Cancellable} cancellable cancelable de esta consulta
     * @returns {Promise<object>} vitales ya parseadas
     */
    async _vitalesDe(host, cancellable) {
        const sistema = await this.sistema(host, cancellable);

        const script = sistema === SISTEMA.WINDOWS
            ? scriptWindows(this._actualizaciones)
            : scriptPosix(this._actualizaciones);

        const salida = await this.ejecutar(host, ordenDe(sistema, script), cancellable);
        const datos = parsearVitales(salida);

        if (Object.keys(datos).length === 0)
            throw new Error('contestó, pero sin datos que entender');

        return datos;
    }

    /**
     * Qué sistema tiene un equipo: el que hayas declarado, el que ya se
     * averiguó, o preguntándoselo ahora.
     *
     * @param {object} host equipo del menú
     * @param {Gio.Cancellable} cancellable cancelable
     * @returns {Promise<string>} valor de SISTEMA
     * @throws {Error} si contesta algo que no se reconoce
     */
    async sistema(host, cancellable = null) {
        const declarado = sistemaDeclarado(host.sistema);
        if (declarado)
            return declarado;

        const guardado = this._sistemas.get(host.id);
        if (guardado)
            return guardado;

        // Se pregunta con el mismo intérprete que luego ejecutará las vitales,
        // así que si esto sale bien, aquello también conecta.
        const sistema = interpretarSistema(
            await this.ejecutar(host, ordenSistema(), cancellable));

        if (sistema === SISTEMA.DESCONOCIDO) {
            throw new Error(
                'no se reconoce su sistema; ponle un comentario ' +
                '«# Sistema: windows» o «# Sistema: linux» en el bloque del config');
        }

        this._sistemas.set(host.id, sistema);
        return sistema;
    }

    /**
     * Lanza una orden en un equipo y devuelve lo que escribió, sin juzgar el
     * resultado. Lo usan las acciones de energía, donde que la conexión se
     * corte no es un fallo sino la señal de que el equipo está obedeciendo.
     *
     * @param {object} host equipo destino
     * @param {string} orden orden remota, de una sola pieza
     * @param {Gio.Cancellable} cancellable cancelable
     * @returns {Promise<{salida: string, error: string, codigo: number}>} resultado
     */
    ejecutarCrudo(host, orden, cancellable = null) {
        const proceso = Gio.Subprocess.new(
            argvSsh(host, orden, this._conexion),
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);

        return comunicar(proceso, cancellable);
    }

    /**
     * Lanza una orden en un equipo y devuelve su salida, o falla con el motivo
     * ya explicado.
     *
     * @param {object} host equipo destino
     * @param {string} orden orden remota, de una sola pieza
     * @param {Gio.Cancellable} cancellable cancelable
     * @returns {Promise<string>} salida estándar del equipo
     * @throws {Error} con el motivo ya explicado si ssh falla
     */
    async ejecutar(host, orden, cancellable = null) {
        const {salida, error, codigo} = await this.ejecutarCrudo(host, orden, cancellable);
        if (codigo !== 0)
            throw new Error(explicarError(error));

        return salida;
    }

    /**
     * Guarda un estado y avisa. No toca los datos: los anteriores se siguen
     * mostrando mientras se refresca.
     *
     * @param {string} id identificador del equipo
     * @param {string} estado nuevo estado
     */
    _fijarEstado(id, estado) {
        if (this._estados.get(id) === estado)
            return;
        this._estados.set(id, estado);
        this._alCambiar(id);
    }

    /**
     * Cancela las consultas en vuelo sin inutilizar el monitor. Se usa al
     * cerrar el menú: lo ya sabido se conserva.
     */
    cancelarPendientes() {
        for (const host of this._cola) {
            if (this._estados.get(host.id) === VITALES.CONSULTANDO)
                this._estados.delete(host.id);
        }
        this._cola = [];
        this._enCola.clear();

        for (const [id, cancellable] of this._enCurso) {
            cancellable.cancel();
            if (this._estados.get(id) === VITALES.CONSULTANDO)
                this._estados.delete(id);
        }
        this._enCurso.clear();
    }

    /**
     * Cancela todo y deja el objeto inservible. Se llama desde disable().
     */
    destruir() {
        this._destruido = true;
        for (const cancellable of this._enCurso.values())
            cancellable.cancel();
        this._enCurso.clear();
        this._cola = [];
        this._enCola.clear();
        this._datos.clear();
        this._estados.clear();
        this._errores.clear();
        this._sistemas.clear();
        this._alCambiar = () => {};
    }
}

/* -------------------------------------------------------------------------
 * Formato para el menú
 * ------------------------------------------------------------------------- */

/**
 * Tiempo encendido, con la unidad que se lea de un vistazo.
 *
 * @param {number} segundos segundos desde el arranque
 * @returns {string} texto corto («14 d», «3 h», «12 min»)
 */
export function formatearArranque(segundos) {
    if (!Number.isFinite(segundos) || segundos < 0)
        return '';

    const minutos = Math.floor(segundos / 60);
    if (minutos < 60)
        return `${minutos} min`;

    const horas = Math.floor(minutos / 60);
    if (horas < 48)
        return `${horas} h`;

    return `${Math.floor(horas / 24)} d`;
}

/**
 * Porcentaje usado de un total, redondeado.
 *
 * @param {{total: number, usada: number}} medida medida en KiB
 * @returns {number|null} porcentaje, o null si no hay medida
 */
export function porcentaje(medida) {
    if (!medida || !(medida.total > 0))
        return null;
    return Math.round((medida.usada / medida.total) * 100);
}

/**
 * Cantidad en KiB pasada a la unidad que toque.
 *
 * @param {number} kib cantidad en KiB
 * @returns {string} texto con unidad («3,9 GiB»)
 */
export function formatearTamano(kib) {
    if (!Number.isFinite(kib))
        return '';

    const mib = kib / 1024;
    if (mib < 1024)
        return `${Math.round(mib)} MiB`;

    const gib = mib / 1024;
    return `${gib.toFixed(1)} GiB`;
}

/**
 * Resumen de una línea con lo que cabe al lado del nombre del equipo.
 *
 * @param {object} datos vitales del equipo
 * @returns {string} resumen, o cadena vacía si no hay nada que resumir
 */
export function resumen(datos) {
    if (!datos)
        return '';

    const trozos = [];

    if (Number.isFinite(datos.arranque))
        trozos.push(`↑ ${formatearArranque(datos.arranque)}`);

    const ram = porcentaje(datos.memoria);
    if (ram !== null)
        trozos.push(`RAM ${ram}%`);

    const disco = porcentaje(datos.disco);
    if (disco !== null)
        trozos.push(`/ ${disco}%`);

    if (Number.isFinite(datos.actualizaciones) && datos.actualizaciones > 0)
        trozos.push(`${datos.actualizaciones} act.`);

    return trozos.join(' · ');
}

/**
 * Detalle largo, el que se lee al pasar el ratón por encima.
 *
 * @param {object} datos vitales del equipo
 * @returns {string} varias líneas con todo lo que se sabe
 */
export function detalle(datos) {
    if (!datos)
        return '';

    const lineas = [];

    if (datos.nombre)
        lineas.push(datos.nombre);
    if (Number.isFinite(datos.arranque))
        lineas.push(`Encendido desde hace ${formatearArranque(datos.arranque)}`);
    if (datos.carga)
        lineas.push(`Carga media: ${datos.carga.join('  ')}`);
    if (Number.isFinite(datos.cpu))
        lineas.push(`CPU: ${datos.cpu}%`);
    if (datos.memoria) {
        lineas.push(`Memoria: ${formatearTamano(datos.memoria.usada)} de ` +
                    `${formatearTamano(datos.memoria.total)} (${porcentaje(datos.memoria)}%)`);
    }
    if (datos.disco) {
        lineas.push(`Disco: ${formatearTamano(datos.disco.usada)} de ` +
                    `${formatearTamano(datos.disco.total)} (${porcentaje(datos.disco)}%)`);
    }
    if (Number.isFinite(datos.actualizaciones))
        lineas.push(`Actualizaciones pendientes: ${datos.actualizaciones}`);

    return lineas.join('\n');
}

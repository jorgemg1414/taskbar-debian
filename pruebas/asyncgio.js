/*
 * Pruebas de comunicar(), en comun/asyncgio.js: esperar a un programa externo
 * (ssh, copyq) sin que un cuelgue suyo deje nada colgado aquí.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {prueba, igual, cierto, ejecutar} from './marco.js';
import {comunicar} from '../comun/asyncgio.js';

/**
 * Lanza una orden con las dos salidas recogidas.
 *
 * @param {string[]} argv orden
 * @returns {Gio.Subprocess} proceso en marcha
 */
const lanzar = argv => Gio.Subprocess.new(
    argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);

/**
 * Espera a que el proceso termine del todo y dice con qué señal, si fue una.
 *
 * @param {Gio.Subprocess} proceso proceso
 * @returns {Promise<number>} señal que lo mató, o 0 si salió por su cuenta
 */
const senal = proceso => new Promise(resolve => {
    proceso.wait_async(null, () =>
        resolve(proceso.get_if_signaled() ? proceso.get_term_sig() : 0));
});

prueba('recoge la salida, los errores y el código', async () => {
    const r = await comunicar(lanzar(['sh', '-c', 'echo hola; echo mal >&2; exit 3']), null);
    igual(r, {salida: 'hola\n', error: 'mal\n', codigo: 3});
});

prueba('con plazo agotado, mata el proceso y falla con TIMED_OUT', async () => {
    const proceso = lanzar(['sleep', '30']);
    const inicio = GLib.get_monotonic_time();

    let error = null;
    await comunicar(proceso, null, 1).catch(e => (error = e));

    const segundos = (GLib.get_monotonic_time() - inicio) / 1e6;
    cierto(error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.TIMED_OUT), `no falló por plazo: ${error}`);
    cierto(segundos < 5, `tardó ${segundos} s en rendirse`);
    igual(await senal(proceso), 9, 'el proceso no murió con SIGKILL');
});

prueba('un plazo que no se agota no molesta', async () => {
    const r = await comunicar(lanzar(['echo', 'rápido']), null, 5);
    igual(r.salida, 'rápido\n');
});

prueba('cancelar mata el proceso, no solo deja de esperar', async () => {
    const proceso = lanzar(['sleep', '30']);
    const cancelable = new Gio.Cancellable();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        cancelable.cancel();
        return GLib.SOURCE_REMOVE;
    });

    let error = null;
    await comunicar(proceso, cancelable).catch(e => (error = e));
    cierto(error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED), `no falló como cancelado: ${error}`);
    igual(await senal(proceso), 9, 'el proceso sigue vivo');
});

prueba('con el cancelable ya cancelado de antes, tampoco queda nada vivo', async () => {
    const cancelable = new Gio.Cancellable();
    cancelable.cancel();
    const proceso = lanzar(['sleep', '30']);
    await comunicar(proceso, cancelable).catch(() => {});
    igual(await senal(proceso), 9);
});

ejecutar();

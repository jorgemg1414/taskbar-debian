/*
 * Pruebas de equipos-menu/vitales.js: cómo se entiende lo que contesta cada
 * equipo, y cómo se pinta en el menú.
 */

import {prueba, igual, cierto, ejecutar} from './marco.js';
import {
    parsearVitales, explicarError, sistemaDeclarado, argvSsh, SISTEMA,
    formatearArranque, formatearTamano, porcentaje, resumen,
} from '../equipos-menu@jorgemg1414/vitales.js';

prueba('lee la respuesta de un Linux', () => {
    const datos = parsearVitales(`so=linux
nombre=nas
arranque=90061
carga=0.10 0.20 0.30
memoria=8000000 2000000
disco=100000000 90000000
actualizaciones=4
`);
    igual(datos, {
        so: 'linux', nombre: 'nas', arranque: 90061, carga: [0.1, 0.2, 0.3],
        memoria: {total: 8000000, usada: 2000000},
        disco: {total: 100000000, usada: 90000000}, actualizaciones: 4,
    });
});

prueba('lee la de un Windows, con sus finales de línea', () => {
    const datos = parsearVitales('so=windows\r\ncpu=37\r\ndisco=3000000000 1000000000\r\n');
    igual(datos, {so: 'windows', cpu: 37, disco: {total: 3000000000, usada: 1000000000}});
});

prueba('lo que no se entiende se descarta, no se inventa', () => {
    const datos = parsearVitales(`memoria=0 0
disco=abc 1
carga=1 dos 3
arranque=
cpu=
actualizaciones= 
banner del servidor sin igual
=sin clave
otra=cosa
`);
    igual(datos, {});
    igual(parsearVitales('carga=\n'), {}, 'una carga vacía no es una carga');
});

prueba('los fallos de ssh se explican con lo que hay que hacer', () => {
    igual(explicarError('user@h: Permission denied (publickey).'),
        'la clave no está autorizada en el equipo (herramientas/autorizar-clave.sh)');
    igual(explicarError('Host key verification failed.'),
        'la clave del servidor no está en known_hosts: conéctate una vez con ssh');
    igual(explicarError('ssh: connect to host h port 22: Connection refused'), 'el puerto está cerrado');
    igual(explicarError('ssh: Could not resolve hostname h: Name or service not known'), 'el nombre no se resuelve');
    igual(explicarError('\n\nalgo raro\nsegunda línea'), 'algo raro');
    igual(explicarError(''), 'falló sin decir por qué');
});

prueba('# Sistema: se entiende escrito de varias formas', () => {
    igual(['Windows 11', 'win', 'Debian Linux', 'macOS', 'freebsd', 'otra cosa', ''].map(sistemaDeclarado),
        [SISTEMA.WINDOWS, SISTEMA.WINDOWS, SISTEMA.POSIX, SISTEMA.POSIX, SISTEMA.POSIX, '', '']);
});

prueba('ssh se lanza sin preguntar nada y con la orden de una pieza', () => {
    const argv = argvSsh({nombre: 'nas'}, 'uname -s', {timeout: 5, reutilizar: false, persistir: 60});
    igual(argv, ['ssh', '-n', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', 'nas', 'uname -s']);

    const conControl = argvSsh({nombre: 'nas'}, 'x', {timeout: 5, reutilizar: true, persistir: 60});
    cierto(conControl.includes('ControlMaster=auto') && conControl.includes('ControlPersist=60'),
        'sin ControlMaster al reutilizar');
    igual(conControl.slice(-2), ['nas', 'x'], 'el alias y la orden van al final');
});

prueba('el formato de lo que se ve en el menú', () => {
    igual([formatearArranque(59), formatearArranque(3600), formatearArranque(47 * 3600), formatearArranque(3 * 86400)],
        ['0 min', '1 h', '47 h', '3 d']);
    igual([formatearTamano(512 * 1024), formatearTamano(3.5 * 1024 * 1024)], ['512 MiB', '3.5 GiB']);
    igual([porcentaje({total: 200, usada: 50}), porcentaje({total: 0, usada: 0}), porcentaje(null)], [25, null, null]);
    igual(resumen({arranque: 7200, memoria: {total: 4, usada: 1}, disco: {total: 10, usada: 9}, actualizaciones: 0}),
        '↑ 2 h · RAM 25% · / 90%');
    igual(resumen(null), '');
});

ejecutar();

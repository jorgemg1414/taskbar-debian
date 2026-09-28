/*
 * Pruebas de vnc-menu/connections.js: cómo se leen los archivos de conexión.
 *
 * Tres formatos que dicen lo mismo de formas distintas: el .vnc de RealVNC, el
 * de TigerVNC/TightVNC y el .remmina. Lo que importa es que de los tres salga
 * el mismo host y el mismo puerto que usaría el propio cliente.
 */

import GLib from 'gi://GLib';

import {prueba, igual, cierto, ejecutar, escribir, carpetaTemporal} from './marco.js';
import {escanearConexiones, agruparConexiones, GRUPO_SIN_NOMBRE} from '../vnc-menu@jorgemg1414/connections.js';

/**
 * Escribe unos archivos en una carpeta nueva y la escanea.
 *
 * @param {object} archivos ruta relativa -> contenido
 * @returns {Promise<object>} lo que devuelve escanearConexiones
 */
async function escanear(archivos) {
    const carpeta = carpetaTemporal();
    for (const [ruta, texto] of Object.entries(archivos))
        escribir(GLib.build_filenamev([carpeta, ruta]), texto);
    return escanearConexiones(carpeta, null);
}

/**
 * Host y puerto de la única conexión de un archivo con ese Host=.
 *
 * @param {string} valor lo que va detrás de «Host=»
 * @returns {Promise<[string, number]>} host y puerto
 */
async function hostPuerto(valor) {
    const r = await escanear({'a.vnc': `Host=${valor}\n`});
    return [r.conexiones[0].host, r.conexiones[0].port];
}

prueba('RealVNC: el nombre es el del archivo, sin extensión', async () => {
    const r = await escanear({'OFICINA NORTE.vnc': 'Host=10.0.0.1\nUserName=ana\n'});
    const c = r.conexiones[0];
    igual([c.nombre, c.extension, c.host, c.port, c.usuario], ['OFICINA NORTE', '.vnc', '10.0.0.1', 5900, 'ana']);
});

prueba('host:puerto, y un número pequeño es un display', async () => {
    igual(await hostPuerto('10.0.0.1:5901'), ['10.0.0.1', 5901]);
    igual(await hostPuerto('10.0.0.1:2'), ['10.0.0.1', 5902]);
    igual(await hostPuerto('pc.local'), ['pc.local', 5900]);
});

prueba('host::puerto es el puerto tal cual, sin la cuenta del display', async () => {
    igual(await hostPuerto('pc.local::5901'), ['pc.local', 5901]);
    igual(await hostPuerto('10.0.0.1::22'), ['10.0.0.1', 22]);
});

prueba('IPv6: entre corchetes con puerto, o suelta sin él', async () => {
    igual(await hostPuerto('[fe80::1]:5901'), ['fe80::1', 5901]);
    igual(await hostPuerto('fe80::1'), ['fe80::1', 5900], 'fe80::1 no es «fe80» con puerto 1');
    igual(await hostPuerto('2001:db8::5'), ['2001:db8::5', 5900]);
});

prueba('TigerVNC: host= y port= en claves separadas', async () => {
    const r = await escanear({'a.vnc': 'host=10.0.0.9\nport=5905\n', 'b.vnc': 'host=10.0.0.8\nport=3\n'});
    igual(r.conexiones.map(c => [c.nombre, c.port]), [['a', 5905], ['b', 5903]]);
});

prueba('Remmina: server=, username= y group=', async () => {
    const r = await escanear({'x.remmina': '[remmina]\nserver=10.0.0.2:5900\nusername=root\ngroup=CASA\nprotocol=VNC\n'});
    const c = r.conexiones[0];
    igual([c.extension, c.host, c.port, c.usuario, c.grupo], ['.remmina', '10.0.0.2', 5900, 'root', 'CASA']);
});

prueba('las credenciales no llegan a leerse', async () => {
    const r = await escanear({'a.vnc': 'Host=h\nPassword=abc123\nIdentity=secreto\nAuthCertificate=x\n'});
    const texto = JSON.stringify(r.conexiones[0]);
    cierto(!texto.includes('abc123') && !texto.includes('secreto'), 'aparece una credencial en la conexión');
});

prueba('sin host no hay conexión, y lo que no es de conexión se ignora', async () => {
    const r = await escanear({'a.vnc': 'UserName=ana\n', 'notas.txt': 'Host=h\n', 'b.vnc': 'Host=h\n'});
    igual(r.conexiones.map(c => c.nombre), ['b']);
});

prueba('la subcarpeta manda sobre las etiquetas', async () => {
    const r = await escanear({'SUCURSALES/a.vnc': 'Host=h\nLabels=OTRA\n'});
    igual(r.conexiones[0].grupo, 'SUCURSALES');
});

prueba('sin subcarpeta, gana la etiqueta que comparten más, y solo su último tramo', async () => {
    const r = await escanear({
        'a.vnc': 'Host=h1\nLabels=EMPRESA/SUCURSALES,MAPELO\n',
        'b.vnc': 'Host=h2\nLabels=EMPRESA/SUCURSALES\n',
        'c.vnc': 'Host=h3\n',
    });
    igual(r.conexiones.map(c => [c.nombre, c.grupo]),
        [['c', GRUPO_SIN_NOMBRE], ['a', 'SUCURSALES'], ['b', 'SUCURSALES']]);
    igual(agruparConexiones(r.conexiones).map(g => g.nombre), [GRUPO_SIN_NOMBRE, 'SUCURSALES']);
});

prueba('los archivos ocultos no salen', async () => {
    const r = await escanear({'.oculto.vnc': 'Host=h\n', 'visible.vnc': 'Host=h\n'});
    igual(r.conexiones.map(c => c.nombre), ['visible']);
});

prueba('una carpeta que no existe se dice, no revienta', async () => {
    const r = await escanearConexiones('/no/existe/de/verdad', null);
    igual([r.ok, r.motivo], [false, 'inexistente']);
});

ejecutar();

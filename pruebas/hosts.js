/*
 * Pruebas de comun/hosts.js: cómo se lee el ~/.ssh/config.
 *
 * La vara de medir es lo que hace ssh con el mismo archivo: si el menú lee otra
 * cosa, conecta a un sitio y pinta el punto de otro.
 */

import GLib from 'gi://GLib';

import {prueba, igual, ejecutar, escribir} from './marco.js';
import {escanearHosts, agruparHosts, uriSftp, destinoSsh, GRUPO_SIN_NOMBRE} from '../comun/hosts.js';

const SSH = GLib.build_filenamev([GLib.get_home_dir(), '.ssh']);
let vuelta = 0;

/**
 * Escribe una configuración en una carpeta nueva de ~/.ssh y la escanea.
 *
 * @param {object} archivos ruta relativa a ~/.ssh -> contenido; «config» es
 *   el principal
 * @returns {Promise<object>} lo que devuelve escanearHosts
 */
async function escanear(archivos) {
    // Cada prueba con su propio config, para que no se pisen.
    vuelta++;
    for (const [ruta, texto] of Object.entries(archivos)) {
        const destino = ruta === 'config' ? `config-${vuelta}` : ruta;
        escribir(GLib.build_filenamev([SSH, destino]), texto);
    }
    return escanearHosts(`~/.ssh/config-${vuelta}`, null);
}

/**
 * El equipo de un alias, o null.
 *
 * @param {object} resultado lo que devuelve escanearHosts
 * @param {string} alias alias buscado
 * @returns {object|null} equipo
 */
const de = (resultado, alias) => resultado.hosts.find(h => h.alias === alias) ?? null;

prueba('lee alias, HostName, Port y User', async () => {
    const r = await escanear({config: `
Host web
    HostName 10.0.0.5
    Port 2222
    User ana
`});
    const h = de(r, 'web');
    igual([h.host, h.port, h.usuario, h.salto], ['10.0.0.5', 2222, 'ana', '']);
});

prueba('sin HostName, el host es el alias; sin Port, el 22', async () => {
    const r = await escanear({config: 'Host servidor\n'});
    igual([de(r, 'servidor').host, de(r, 'servidor').port], ['servidor', 22]);
});

prueba('un puerto imposible se queda en el 22', async () => {
    const r = await escanear({config: 'Host a\n  Port 99999\nHost b\n  Port nada\n'});
    igual([de(r, 'a').port, de(r, 'b').port], [22, 22]);
});

prueba('admite «Clave=valor», mayúsculas en la clave y valores entrecomillados', async () => {
    const r = await escanear({config: 'Host a\n  HOSTNAME=10.0.0.1\n  user = "ana maría"\n'});
    igual([de(r, 'a').host, de(r, 'a').usuario], ['10.0.0.1', 'ana maría']);
});

prueba('en un bloque manda el primer valor, como en ssh', async () => {
    const r = await escanear({config: 'Host a\n  HostName uno\n  HostName dos\n'});
    igual(de(r, 'a').host, 'uno');
});

prueba('si un alias sale dos veces, manda el primero', async () => {
    const r = await escanear({config: 'Host a\n  HostName uno\nHost a\n  HostName dos\n'});
    igual([r.hosts.length, de(r, 'a').host], [1, 'uno']);
});

prueba('%h en HostName es el alias', async () => {
    const r = await escanear({config: 'Host nas\n  HostName %h.casa.lan\n'});
    igual(de(r, 'nas').host, 'nas.casa.lan');
});

prueba('un bloque con varios alias da una entrada por alias', async () => {
    const r = await escanear({config: 'Host uno dos\n  HostName 10.0.0.1\n'});
    igual(r.hosts.map(h => [h.alias, h.host]), [['dos', '10.0.0.1'], ['uno', '10.0.0.1']]);
});

prueba('los patrones no son equipos, y Host * da los valores por omisión', async () => {
    const r = await escanear({config: `
Host *.ejemplo.net !malo
    User nadie
Host a
    HostName 10.0.0.1
Host b
    User propio
Host *
    User comun
    Port 2200
`});
    igual(r.hosts.map(h => h.alias), ['a', 'b']);
    igual([de(r, 'a').usuario, de(r, 'a').port], ['comun', 2200]);
    igual(de(r, 'b').usuario, 'propio', 'lo del bloque gana a Host *');
});

prueba('un Match cierra el bloque de antes', async () => {
    const r = await escanear({config: 'Host a\n  HostName uno\nMatch user root\n  HostName otro\n'});
    igual(de(r, 'a').host, 'uno');
});

prueba('# Grupo: agrupa lo que viene detrás', async () => {
    const r = await escanear({config: `
Host suelto
# Grupo: OFICINA
Host a
Host b
# group = CASA
Host c
`});
    igual(r.hosts.map(h => [h.alias, h.grupo]),
        [['c', 'CASA'], ['a', 'OFICINA'], ['b', 'OFICINA'], ['suelto', GRUPO_SIN_NOMBRE]]);
    igual(agruparHosts(r.hosts).map(g => [g.nombre, g.hosts.length]),
        [['CASA', 1], ['OFICINA', 2], [GRUPO_SIN_NOMBRE, 1]]);
});

prueba('# MAC:, # Difusión: y # Sistema:, encima del Host o dentro', async () => {
    const r = await escanear({config: `
# MAC: AA-BB-CC-DD-EE-01
# Difusión: 10.0.0.255
Host a
Host b
    # mac = aa:bb:cc:dd:ee:02
    # Sistema: Windows
`});
    igual([de(r, 'a').mac, de(r, 'a').difusion, de(r, 'a').sistema], ['AA-BB-CC-DD-EE-01', '10.0.0.255', '']);
    igual([de(r, 'b').mac, de(r, 'b').sistema], ['aa:bb:cc:dd:ee:02', 'windows']);
});

prueba('Include relativo se busca en ~/.ssh, también anidado', async () => {
    const r = await escanear({
        'config': 'Include conf.d/*.conf\nHost principal\n',
        'conf.d/trabajo.conf': 'Include otro.conf\nHost de-trabajo\n',
        'otro.conf': 'Host del-otro\n',
    });
    // Los de cada archivo incluido se agrupan por el nombre del archivo.
    igual(r.hosts.map(h => [h.alias, h.grupo]),
        [['del-otro', 'otro'], ['principal', GRUPO_SIN_NOMBRE], ['de-trabajo', 'trabajo']]);
});

prueba('un Include que se incluye a sí mismo no da vueltas', async () => {
    const r = await escanear({
        'config': 'Include bucle.conf\n',
        'bucle.conf': 'Include bucle.conf\nHost dentro\n',
    });
    igual(r.hosts.map(h => h.alias), ['dentro']);
});

prueba('ProxyJump y ProxyCommand marcan el salto; «none» lo quita', async () => {
    const r = await escanear({config: `
Host saltado
    ProxyJump bastion
Host tunel
    ProxyCommand /usr/bin/cloudflared access ssh --hostname %h
Host directo
    ProxyJump none
Host *
    ProxyJump comun
`});
    igual([de(r, 'saltado').salto, de(r, 'tunel').salto, de(r, 'directo').salto],
        ['bastion', 'cloudflared', '']);
});

prueba('ProxyJump de Host * también cuenta', async () => {
    const r = await escanear({config: 'Host a\nHost *\n  ProxyJump bastion\n'});
    igual(de(r, 'a').salto, 'bastion');
});

prueba('un config que no existe se dice, no revienta', async () => {
    const r = await escanearHosts('~/.ssh/no-existe', null);
    igual([r.ok, r.motivo, r.hosts.length], [false, 'inexistente', 0]);
});

prueba('uriSftp: usuario escapado, IPv6 entre corchetes, puerto y carpeta', () => {
    igual(uriSftp({usuario: 'ana@casa', host: '10.0.0.1', port: 22}), 'sftp://ana%40casa@10.0.0.1');
    igual(uriSftp({usuario: '', host: 'fe80::1', port: 2222}, 'datos'), 'sftp://[fe80::1]:2222/datos');
    igual(uriSftp({usuario: 'x', host: 'h', port: 22}, '/srv/'), 'sftp://x@h/srv/');
});

prueba('destinoSsh', () => {
    igual(destinoSsh({usuario: 'ana', host: 'h'}), 'ana@h');
    igual(destinoSsh({usuario: '', host: 'h'}), 'h');
});

ejecutar();

/*
 * Pruebas de comun/wol.js: MAC, direcciones de sondeo, la tabla ARP y de dónde
 * sale la MAC con la que se enciende cada equipo.
 */

import Gio from 'gi://Gio';

import {prueba, igual, ejecutar} from './marco.js';
import {
    despertar, parsearMac, formatearMac, parsearSonda, parsearTablaArp, datosWolDe, esIPv4,
    PUERTO_POR_DEFECTO, PUERTO_SONDA,
} from '../comun/wol.js';

prueba('una MAC se entiende escrita de cualquier forma habitual', () => {
    for (const texto of ['aa:bb:cc:dd:ee:ff', 'AA-BB-CC-DD-EE-FF', 'aabb.ccdd.eeff', ' aabbccddeeff '])
        igual(formatearMac(texto), 'aa:bb:cc:dd:ee:ff', texto);
    igual(parsearMac('01:02:03:04:05:0a'), [1, 2, 3, 4, 5, 10]);
});

prueba('una MAC con cifras de más o de menos no vale', () => {
    igual(parsearMac('aa:bb:cc:dd:ee'), null);
    igual(parsearMac('aa:bb:cc:dd:ee:ff:00'), null);
    igual(parsearMac(''), null);
    igual(parsearMac(null), null);
});

prueba('la dirección de sondeo: host, host:puerto e IPv6', () => {
    igual(parsearSonda('pc.local'), {host: 'pc.local', port: PUERTO_SONDA});
    igual(parsearSonda('10.0.0.1:3389'), {host: '10.0.0.1', port: 3389});
    igual(parsearSonda('[fe80::1]:445'), {host: 'fe80::1', port: 445});
    igual(parsearSonda('fe80::1'), {host: 'fe80::1', port: PUERTO_SONDA});
    igual(parsearSonda('10.0.0.1:99999'), {host: '10.0.0.1', port: PUERTO_SONDA});
    igual(parsearSonda('  '), null);
});

prueba('la tabla ARP: se quedan las entradas completas, con la MAC canónica', () => {
    const tabla = parsearTablaArp(`IP address       HW type     Flags       HW address            Mask     Device
10.0.0.1         0x1         0x2         AA:BB:CC:00:00:01     *        eth0
10.0.0.2         0x1         0x0         00:00:00:00:00:00     *        eth0
10.0.0.3         0x1         0x2         00:00:00:00:00:00     *        eth0
10.0.0.4         0x1         0x6         aa:bb:cc:00:00:04     *        wlan0
`);
    igual([...tabla.entries()], [['10.0.0.1', 'aa:bb:cc:00:00:01'], ['10.0.0.4', 'aa:bb:cc:00:00:04']]);
});

prueba('solo una IPv4 literal sirve para aprender de la tabla ARP', () => {
    igual([esIPv4('10.0.0.1'), esIPv4('pc.local'), esIPv4('fe80::1'), esIPv4('')], [true, false, false, false]);
});

prueba('manda la MAC del propio bloque, luego la de Wake on LAN, luego la aprendida', () => {
    const equipos = [{nombre: 'NAS', mac: '11:11:11:11:11:11', destino: '10.0.0.255', puerto: 7}];

    igual(datosWolDe({nombre: 'nas', host: 'x', mac: '22:22:22:22:22:22', difusion: '10.1.0.255'}, equipos, '33:33:33:33:33:33'),
        {mac: '22:22:22:22:22:22', destino: '10.1.0.255', puerto: PUERTO_POR_DEFECTO}, 'el bloque');
    igual(datosWolDe({nombre: 'nas', host: 'x', mac: ''}, equipos, '33:33:33:33:33:33'),
        {mac: '11:11:11:11:11:11', destino: '10.0.0.255', puerto: 7}, 'Wake on LAN, por nombre y sin mayúsculas');
    igual(datosWolDe({nombre: 'otro', host: 'x', mac: ''}, equipos, '33:33:33:33:33:33'),
        {mac: '33:33:33:33:33:33', destino: '', puerto: PUERTO_POR_DEFECTO}, 'la aprendida');
    igual(datosWolDe({nombre: 'otro', host: 'x', mac: 'basura'}, equipos, ''), null, 'nada que valga');
});

prueba('en Wake on LAN también se empareja por el host, no solo por el alias', () => {
    const equipos = [{nombre: '10.0.0.9', mac: '44:44:44:44:44:44', destino: '', puerto: 9}];
    igual(datosWolDe({nombre: 'servidor', host: '10.0.0.9', mac: ''}, equipos)?.mac, '44:44:44:44:44:44');
});

prueba('el paquete mágico: 102 bytes, y se manda tres veces', async () => {
    // Un socket en la máquina propia hace de tarjeta de red dormida.
    const oido = Gio.Socket.new(Gio.SocketFamily.IPV4, Gio.SocketType.DATAGRAM, Gio.SocketProtocol.UDP);
    oido.bind(Gio.InetSocketAddress.new_from_string('127.0.0.1', 0), false);
    const puerto = oido.get_local_address().get_port();

    igual(await despertar({mac: '01:02:03:04:05:06', destino: '127.0.0.1', puerto}), null);

    const recibidos = [];
    for (;;) {
        let bytes;
        try {
            bytes = oido.receive_bytes(1024, 200000, null);
        } catch {
            break;          // se agotó la espera: no llegan más
        }
        recibidos.push(bytes.toArray());
    }
    oido.close();

    igual(recibidos.length, 3, 'paquetes que llegaron');
    const paquete = [...recibidos[0]];
    igual(paquete.length, 102);
    igual(paquete.slice(0, 6), [255, 255, 255, 255, 255, 255]);
    igual(paquete.slice(6, 12), [1, 2, 3, 4, 5, 6]);
    igual(paquete.slice(96), [1, 2, 3, 4, 5, 6], 'la MAC, dieciséis veces');
});

prueba('una MAC mala no manda nada y dice por qué', async () => {
    igual(await despertar({mac: 'zz', destino: '127.0.0.1', puerto: 9}), 'MAC no válida: «zz»');
});

ejecutar();

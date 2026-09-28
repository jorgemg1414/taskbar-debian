/*
 * Pruebas de comun/lanzar.js y comun/rutas.js: cómo una orden escrita en los
 * ajustes se convierte en un programa lanzado, y cómo se entienden las rutas.
 *
 * Lo que más importa aquí es que un valor —un alias, una ruta con espacios—
 * nunca pueda convertirse en argumentos de más ni en otra orden.
 */

import GLib from 'gi://GLib';

import {prueba, igual, ejecutar, carpetaTemporal} from './marco.js';
import {construirArgv, lanzarPrimera} from '../comun/lanzar.js';
import {expandirRuta} from '../comun/rutas.js';

prueba('trocea la plantilla y sustituye los marcadores', () => {
    igual(construirArgv('remmina -c vnc://%h:%p', {'%h': '10.0.0.1', '%p': '5901'}),
        ['remmina', '-c', 'vnc://10.0.0.1:5901']);
});

prueba('un valor con espacios o con órdenes se queda en su argumento', () => {
    igual(construirArgv('gedit %f', {'%f': '/home/yo/mis notas; rm -rf ~.md'}),
        ['gedit', '/home/yo/mis notas; rm -rf ~.md']);
    igual(construirArgv('tilix -e "ssh %n"', {'%n': 'a b'}), ['tilix', '-e', 'ssh a b']);
});

prueba('un valor que contiene un marcador no se vuelve a sustituir', () => {
    igual(construirArgv('x %n %h', {'%n': '%h', '%h': 'host'}), ['x', '%h', 'host']);
});

prueba('un marcador sin valor se deja como está', () => {
    igual(construirArgv('x %z 100%', {'%h': 'h'}), ['x', '%z', '100%']);
});

prueba('una plantilla vacía o mal cerrada no se lanza', () => {
    igual(construirArgv('', {}), null);
    igual(construirArgv('   ', {}), null);
    igual(construirArgv('tilix -e "ssh %n', {'%n': 'a'}, 'prueba'), null);
});

prueba('lanza la primera cuyo programa existe, saltando las que no', () => {
    const marca = GLib.build_filenamev([carpetaTemporal(), 'lanzado']);
    const lanzado = lanzarPrimera(
        ['', 'programa-que-no-existe-jamas %f', 'touch %f', 'touch %f.segundo'], {'%f': marca}, 'prueba');
    igual(lanzado, true);

    // touch va por su cuenta; se le da un momento.
    for (let i = 0; i < 50 && !GLib.file_test(marca, GLib.FileTest.EXISTS); i++)
        GLib.usleep(20000);
    igual(GLib.file_test(marca, GLib.FileTest.EXISTS), true, 'no se lanzó la buena');
    igual(GLib.file_test(`${marca}.segundo`, GLib.FileTest.EXISTS), false, 'se lanzó también la siguiente');
});

prueba('sin ninguna que valga, dice que no', () => {
    igual(lanzarPrimera(['programa-que-no-existe-jamas', ''], {}, 'prueba'), false);
});

prueba('expandirRuta: ~, relativas a casa y absolutas', () => {
    const casa = GLib.get_home_dir();
    igual(expandirRuta('~'), casa);
    igual(expandirRuta('~/.ssh/config'), `${casa}/.ssh/config`);
    igual(expandirRuta('  Documentos/VNC  '), `${casa}/Documentos/VNC`);
    igual(expandirRuta('/srv/notas'), '/srv/notas');
    igual(expandirRuta(''), '');
});

ejecutar();

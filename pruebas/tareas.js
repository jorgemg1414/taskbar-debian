/*
 * Pruebas de pendientes/tareas.js: leer y reescribir tareas en Markdown.
 *
 * Es el único módulo del repositorio que escribe en archivos tuyos, así que lo
 * que más se mira aquí es lo que NO debe pasar: que cambie algo más que la
 * línea que toca, que se pierda el final de línea, o que se escriba encima de
 * un archivo que ha cambiado desde que se leyó.
 */

import GLib from 'gi://GLib';

import {prueba, igual, ejecutar, escribir, leer, carpetaTemporal} from './marco.js';
import {
    parsearTareas, escanearTareas, agruparTareas, alternarTarea, editarTexto,
    contarSubtareas, borrarTarea, limpiarHechas, moverTarea, sangrarTarea,
    anadirTarea, anadirGrupo, SIN_ENCABEZADO, SIN_SITIO,
} from '../pendientes@jorgemg1414/tareas.js';

/**
 * Crea un archivo de notas y devuelve su ruta y sus tareas.
 *
 * @param {string} texto contenido
 * @returns {{ruta: string, tareas: object[]}} ruta y tareas leídas
 */
function notas(texto) {
    const ruta = GLib.build_filenamev([carpetaTemporal(), 'notas.md']);
    escribir(ruta, texto);
    return {ruta, tareas: parsearTareas(texto, ruta)};
}

/**
 * La tarea con ese texto.
 *
 * @param {object[]} tareas tareas leídas
 * @param {string} texto texto buscado
 * @returns {object} tarea
 */
const tarea = (tareas, texto) => tareas.find(t => t.texto === texto);

/* ----------------------------- Lectura ------------------------------ */

prueba('lee casillas con -, * y +, hechas con x o X, y su encabezado', () => {
    const {tareas} = notas(`
- [ ] suelta
# Casa
* [x] barrer
+ [X] fregar
## Trabajo ##
  - [ ] sub
`);
    igual(tareas.map(t => [t.texto, t.hecha, t.grupo, t.sangria]), [
        ['suelta', false, SIN_ENCABEZADO, 0],
        ['barrer', true, 'Casa', 0],
        ['fregar', true, 'Casa', 0],
        ['sub', false, 'Trabajo', 2],
    ]);
});

prueba('lo que parece una tarea dentro de un bloque de código no lo es', () => {
    const {tareas} = notas('- [ ] real\n```\n- [ ] ejemplo\n```\n~~~\n- [ ] otro\n~~~\n');
    igual(tareas.map(t => t.texto), ['real']);
});

prueba('una casilla sin texto, o sin viñeta, no es una tarea', () => {
    const {tareas} = notas('- [ ]\n[ ] sin viñeta\n- [ ] buena\n');
    igual(tareas.map(t => t.texto), ['buena']);
});

prueba('una carpeta: lee .md, .markdown y .txt, en orden', async () => {
    const carpeta = carpetaTemporal();
    escribir(`${carpeta}/b.md`, '- [ ] de b\n');
    escribir(`${carpeta}/a.txt`, '- [ ] de a\n');
    escribir(`${carpeta}/c.markdown`, '- [ ] de c\n');
    escribir(`${carpeta}/d.png`, '- [ ] no\n');
    const r = await escanearTareas(carpeta, null);
    igual([r.ok, r.carpeta, r.tareas.map(t => t.texto)], [true, true, ['de a', 'de b', 'de c']]);
    igual(agruparTareas(r.tareas, true).map(g => g.nombre),
        [`a · ${SIN_ENCABEZADO}`, `b · ${SIN_ENCABEZADO}`, `c · ${SIN_ENCABEZADO}`]);
});

/* ---------------------------- Escritura ----------------------------- */

prueba('marcar cambia un carácter y ni uno más', async () => {
    const {ruta, tareas} = notas('# Lista\n\n- [ ] uno  \n- [ ] dos\n');
    igual(await alternarTarea(tarea(tareas, 'uno')), null);
    igual(leer(ruta), '# Lista\n\n- [x] uno  \n- [ ] dos\n');
});

prueba('desmarcar, y no se le da la vuelta a lo que ya cambiaste por fuera', async () => {
    const {ruta, tareas} = notas('- [x] hecha\n');
    igual(await alternarTarea(tarea(tareas, 'hecha')), null);
    igual(leer(ruta), '- [ ] hecha\n');
    // La tarea leída aún dice «hecha», pero el archivo ya dice que no.
    igual(await alternarTarea(tarea(tareas, 'hecha')), 'esa tarea ya la habías marcado en el archivo');
    igual(leer(ruta), '- [ ] hecha\n');
});

prueba('si la línea ya no es la que era, no se toca nada', async () => {
    const {ruta, tareas} = notas('- [ ] uno\n- [ ] dos\n');
    escribir(ruta, '- [ ] nueva\n- [ ] uno\n- [ ] dos\n');
    const motivo = await alternarTarea(tarea(tareas, 'uno'));
    igual(motivo, 'la tarea ya no está donde estaba: el archivo ha cambiado');
    igual(leer(ruta), '- [ ] nueva\n- [ ] uno\n- [ ] dos\n');
});

prueba('se conservan los finales de línea de Windows', async () => {
    const {ruta, tareas} = notas('- [ ] uno\r\n- [ ] dos\r\n');
    await alternarTarea(tarea(tareas, 'dos'));
    igual(leer(ruta), '- [ ] uno\r\n- [x] dos\r\n');
});

prueba('editar cambia solo el texto, y una línea nueva no parte la tarea', async () => {
    const {ruta, tareas} = notas('\t* [x] viejo\n');
    igual(await editarTexto(tarea(tareas, 'viejo'), 'nuevo\ncon salto'), null);
    igual(leer(ruta), '\t* [x] nuevo con salto\n');
    igual(await editarTexto(tarea(parsearTareas(leer(ruta), ruta), 'nuevo con salto'), '  '),
        'una tarea sin texto no es una tarea');
});

prueba('borrar se lleva la tarea con sus subtareas y notas', async () => {
    const {ruta, tareas} = notas(`- [ ] uno
- [ ] padre
  - [ ] hija
    nota de la hija
  - [x] otra hija
- [ ] tres
`);
    const padre = tarea(tareas, 'padre');
    igual(contarSubtareas(tareas, padre), 2);
    igual(contarSubtareas(tareas, tarea(tareas, 'uno')), 0);
    igual(await borrarTarea(padre, 2), null);
    igual(leer(ruta), '- [ ] uno\n- [ ] tres\n');
});

prueba('borrar no toca nada si las subtareas no son las que se contaron', async () => {
    const texto = '- [ ] padre\n  - [ ] hija\n';
    const {ruta, tareas} = notas(texto);
    igual(await borrarTarea(tarea(tareas, 'padre'), 0),
        'lo que cuelga de la tarea no es lo que se contó: bórrala desde el editor');
    igual(leer(ruta), texto);
});

prueba('mover intercambia con la hermana, llevándose las subtareas', async () => {
    const {ruta, tareas} = notas(`# G
- [ ] a
  - [ ] a1
- [ ] b
`);
    igual(await moverTarea(tarea(tareas, 'b'), -1), null);
    igual(leer(ruta), '# G\n- [ ] b\n- [ ] a\n  - [ ] a1\n');
});

prueba('mover no cruza un encabezado', async () => {
    const {ruta, tareas} = notas('# A\n- [ ] a\n# B\n- [ ] b\n');
    igual(await moverTarea(tarea(tareas, 'b'), -1), SIN_SITIO);
    igual(await moverTarea(tarea(tareas, 'a'), 1), SIN_SITIO);
    igual(leer(ruta), '# A\n- [ ] a\n# B\n- [ ] b\n');
});

prueba('sangrar la convierte en subtarea, con la sangría que ya use el archivo', async () => {
    const {ruta, tareas} = notas('- [ ] a\n    - [ ] a1\n- [ ] b\n');
    igual(await sangrarTarea(tarea(tareas, 'b'), 1), null);
    igual(leer(ruta), '- [ ] a\n    - [ ] a1\n    - [ ] b\n');
    // La primera no tiene de quién colgar.
    igual(await sangrarTarea(tarea(tareas, 'a'), 1), SIN_SITIO);
});

prueba('desangrar la saca un nivel, con lo suyo', async () => {
    const {ruta, tareas} = notas('- [ ] a\n\t- [ ] a1\n\t\t- [ ] a11\n');
    igual(await sangrarTarea(tarea(tareas, 'a1'), -1), null);
    igual(leer(ruta), '- [ ] a\n- [ ] a1\n\t- [ ] a11\n');
});

prueba('añadir debajo va detrás de sus subtareas, con su sangría', async () => {
    const {ruta, tareas} = notas('- [ ] a\n  - [ ] a1\n- [ ] b\n');
    igual(await anadirTarea({ruta, despuesDe: tarea(tareas, 'a')}, 'nueva'), null);
    igual(leer(ruta), '- [ ] a\n  - [ ] a1\n- [ ] nueva\n- [ ] b\n');
});

prueba('añadir al final no deja la tarea pegada a un párrafo ni tras los blancos', async () => {
    const {ruta} = notas('# Notas\nUn párrafo.\n\n\n');
    igual(await anadirTarea({ruta}, 'nueva'), null);
    igual(leer(ruta), '# Notas\nUn párrafo.\n\n- [ ] nueva\n\n\n');
});

prueba('un grupo nuevo copia el nivel de los encabezados que ya hay', async () => {
    const {ruta} = notas('# Título\n\n## Uno\n- [ ] a\n');
    igual(await anadirGrupo(ruta, '## Dos', 'b'), null);
    igual(leer(ruta), '# Título\n\n## Uno\n- [ ] a\n\n## Dos\n\n- [ ] b\n');
});

prueba('barrer las hechas deja las que tienen subtareas pendientes', async () => {
    const {ruta} = notas(`- [x] hecha
- [x] con pendientes
  - [ ] pendiente
  - [x] hecha dentro
- [ ] sin hacer
`);
    const r = await limpiarHechas(ruta, 3);
    igual(r, {motivo: null, borradas: 2, conservadas: 1});
    igual(leer(ruta), '- [x] con pendientes\n  - [ ] pendiente\n- [ ] sin hacer\n');
});

prueba('barrer no toca nada si el número de hechas ya no es el que se contó', async () => {
    const texto = '- [x] una\n- [x] dos\n';
    const {ruta} = notas(texto);
    igual((await limpiarHechas(ruta, 1)).motivo, 'el archivo ya no tiene las mismas tareas hechas');
    igual(leer(ruta), texto);
});

ejecutar();

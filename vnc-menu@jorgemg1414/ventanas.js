/*
 * ventanas.js — Localiza las ventanas de las sesiones VNC ya abiertas.
 *
 * Sirve para que el menú muestre a qué sucursales estás conectado ahora mismo
 * y puedas saltar a esa ventana en vez de abrir una segunda sesión.
 */

import Meta from 'gi://Meta';

// Trozos de WM_CLASS de los clientes que puede lanzar la extensión:
// «org.remmina.Remmina», «TigerVNC Viewer», «xtigervncviewer», «rvncconnect»…
const CLASES_VNC = ['remmina', 'vnc'];

// Ventanas de gestión del propio programa: no son una sesión remota.
const TITULOS_NO_SESION = [
    'remmina remote desktop client',
    'remmina',
    'vnc viewer',
    'realvnc viewer',
];

/**
 * Quita acentos y mayúsculas para comparar títulos y nombres.
 *
 * @param {string} texto texto a normalizar
 * @returns {string} texto comparable
 */
function normalizar(texto) {
    return (texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Devuelve las ventanas que parecen sesiones VNC abiertas.
 *
 * Cuando el título de la ventana contiene el nombre de una conexión conocida
 * se usa ese nombre: es más corto que el título del cliente y coincide con lo
 * que ya ves en la lista.
 *
 * @param {object[]} conexiones conexiones cargadas, para reconocer los títulos
 * @returns {{ventana: Meta.Window, titulo: string, id: string|null}[]} sesiones abiertas
 */
export function listarSesiones(conexiones = []) {
    const sesiones = [];

    for (const ventana of global.display.list_all_windows()) {
        if (ventana.get_window_type() !== Meta.WindowType.NORMAL)
            continue;
        if (ventana.is_skip_taskbar())
            continue;

        const clase = normalizar(ventana.get_wm_class());
        if (!CLASES_VNC.some(trozo => clase.includes(trozo)))
            continue;

        const titulo = ventana.get_title() ?? '';
        const tituloNorm = normalizar(titulo);
        if (!titulo || TITULOS_NO_SESION.includes(tituloNorm))
            continue;

        const conexion = conexiones.find(
            c => c.nombre && tituloNorm.includes(normalizar(c.nombre)));

        sesiones.push({
            ventana,
            titulo: conexion?.nombre ?? titulo,
            id: conexion?.id ?? null,
        });
    }

    sesiones.sort((a, b) =>
        a.titulo.localeCompare(b.titulo, undefined, {sensitivity: 'base', numeric: true}));

    return sesiones;
}

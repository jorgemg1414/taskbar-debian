/*
 * barra.js — Dónde se pone el indicador dentro de la barra superior.
 *
 * GNOME no deja reordenar la barra: el sitio lo decide cada extensión al
 * registrarse, con la caja —izquierda, centro o derecha— y la posición dentro
 * de ella. Este módulo saca esas dos cosas de los ajustes de la extensión, en
 * vez de dejarlas escritas en el código, y recoloca el indicador cuando
 * cambian.
 *
 * El contrato con quien lo use son dos claves en su esquema de GSettings:
 * «panel-box» (una de left, center, right) y «panel-position» (entero). Los
 * nombres se pueden cambiar por parámetro.
 *
 * La posición es el hueco en el que se mete el indicador al colocarlo, no una
 * posición fija: en la caja están también los indicadores del propio shell, y
 * las extensiones no se activan siempre en el mismo orden, así que dos números
 * seguidos pueden acabar cambiados. No hay forma de arreglarlo desde aquí: el
 * panel no ordena, inserta.
 *
 * A diferencia de los demás módulos de esta carpeta, este habla con el shell
 * (`Main.panel`), así que solo vale dentro de una extensión, no en la ventana
 * de preferencias: las filas para editar esos dos ajustes están en
 * `barraprefs.js`.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Las tres cajas de la barra, como las llama el shell.
export const CAJAS = ['left', 'center', 'right'];

const CAJA_POR_DEFECTO = 'right';

/**
 * Mantiene el indicador de una extensión en el sitio que digan sus ajustes.
 */
export class SitioEnLaBarra {
    /**
     * @param {object} opciones configuración
     * @param {object} opciones.extension extensión dueña del indicador (uuid y getSettings)
     * @param {Function} opciones.crear devuelve un indicador nuevo, ya construido
     * @param {string} [opciones.claveCaja] ajuste con la caja de la barra
     * @param {string} [opciones.clavePosicion] ajuste con la posición dentro de la caja
     */
    constructor({extension, crear, claveCaja = 'panel-box', clavePosicion = 'panel-position'}) {
        this._uuid = extension.uuid;
        this._crear = crear;
        this._settings = extension.getSettings();
        this._claveCaja = claveCaja;
        this._clavePosicion = clavePosicion;
        this._indicador = null;

        this._idsSettings = [claveCaja, clavePosicion].map(clave =>
            this._settings.connect(`changed::${clave}`, () => this._colocar()));

        this._colocar();
    }

    /** @returns {object|null} indicador que está puesto ahora mismo */
    get indicador() {
        return this._indicador;
    }

    /**
     * Pone el indicador donde toca, tirando el anterior si lo había.
     */
    _colocar() {
        // Un indicador ya puesto no se puede mudar: el panel lo tiene metido en
        // una de sus tres cajas y anotado por su papel. Se tira y se hace otro,
        // que es exactamente lo que pasa al desactivar y volver a activar la
        // extensión. Cambiar de sitio es cosa de una vez, no de cada rato.
        this._indicador?.destroy();
        this._indicador = this._crear();

        const caja = this._settings.get_string(this._claveCaja);
        Main.panel.addToStatusArea(
            this._uuid,
            this._indicador,
            Math.max(0, this._settings.get_int(this._clavePosicion)),
            CAJAS.includes(caja) ? caja : CAJA_POR_DEFECTO);
    }

    /**
     * Suelta el indicador y las señales. Se llama desde disable().
     */
    destruir() {
        for (const id of this._idsSettings)
            this._settings.disconnect(id);
        this._idsSettings = [];

        this._indicador?.destroy();
        this._indicador = null;
        this._settings = null;
        this._crear = null;
    }
}

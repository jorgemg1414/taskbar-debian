#!/usr/bin/env bash
#
# install.sh — Instala la extensión «pendientes» en tu carpeta de usuario.
#
# Uso:
#   ./install.sh            instala y compila los esquemas
#   ./install.sh --enable   instala y además activa la extensión
#   ./install.sh --uninstall  desinstala
#
# Lo que hace de verdad está en comun/instalar.sh, que es el mismo para todas
# las extensiones: aquí solo va lo que cambia de una a otra.
#
set -euo pipefail

UUID="pendientes@jorgemg1414"
PROPIOS=(metadata.json extension.js prefs.js tareas.js)
COMUNES=(asyncgio.js barra.js barraprefs.js menu.js)
ESTILOS_COMUNES=si

# --------------------- Requisitos de esta extensión ---------------------
requisitos() {
    # No hace falta ningún programa: lee y escribe archivos de texto con Gio.
    # Para «Editar» conviene tener un editor, pero si no hay ninguno se abre con
    # la aplicación predeterminada del sistema.
    if ! command -v gnome-text-editor >/dev/null 2>&1 \
       && ! command -v gedit >/dev/null 2>&1 \
       && ! command -v kate >/dev/null 2>&1; then
        aviso "No se encontró un editor de texto conocido; «Editar» usará el predeterminado."
    fi
}

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../comun/instalar.sh"

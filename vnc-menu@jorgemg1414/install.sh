#!/usr/bin/env bash
#
# install.sh — Instala la extensión «vnc-menu» en tu carpeta de usuario.
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

UUID="vnc-menu@jorgemg1414"
PROPIOS=(metadata.json extension.js prefs.js connections.js ventanas.js)
COMUNES=(asyncgio.js barra.js barraprefs.js checker.js menu.js wol.js)
ESTILOS_COMUNES=si


# --------------------- Requisitos de esta extensión ---------------------
requisitos() {
    if ! command -v remmina >/dev/null 2>&1 \
       && ! command -v vncviewer >/dev/null 2>&1 \
       && ! command -v xtigervncviewer >/dev/null 2>&1; then
        aviso "No se encontró ningún cliente VNC. Instala uno, por ejemplo:"
        aviso "  sudo apt install remmina remmina-plugin-vnc"
    fi
}

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../comun/instalar.sh"

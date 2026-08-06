#!/usr/bin/env bash
#
# install.sh — Instala la extensión «spotify-menu» en tu carpeta de usuario.
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

UUID="spotify-menu@jorgemg1414"
PROPIOS=(metadata.json extension.js prefs.js caratula.js)
COMUNES=(asyncgio.js barra.js barraprefs.js mpris.js)


# --------------------- Requisitos de esta extensión ---------------------
requisitos() {
    # La extensión no necesita ningún programa externo: habla con el reproductor
    # por el bus de sesión, que ya está ahí. Sí necesita libsoup 3 para bajar las
    # portadas, que en Debian 13 viene con el propio GNOME.
    if [[ ! -f /usr/lib/x86_64-linux-gnu/girepository-1.0/Soup-3.0.typelib &&
          ! -f /usr/lib/girepository-1.0/Soup-3.0.typelib ]]; then
        aviso "No encuentro Soup-3.0.typelib: el menú funcionará, pero sin portadas."
        aviso "Se instala con:  sudo apt install gir1.2-soup-3.0"
    fi
}

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../comun/instalar.sh"

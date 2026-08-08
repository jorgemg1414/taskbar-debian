#!/usr/bin/env bash
#
# install.sh — Instala la extensión «portapapeles» en tu carpeta de usuario.
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

UUID="portapapeles@jorgemg1414"
PROPIOS=(metadata.json extension.js prefs.js copyq.js)
COMUNES=(asyncgio.js barra.js barraprefs.js menu.js)
ESTILOS_COMUNES=si

# --------------------- Requisitos de esta extensión ---------------------
requisitos() {
    # El historial no es suyo: sin CopyQ el menú se abre igual, pero solo para
    # decir que falta. La carpeta portapapeles/ del repositorio lo instala y le
    # pone los atajos de teclado.
    if ! command -v copyq >/dev/null 2>&1; then
        aviso "No está CopyQ, que es de donde sale el historial. Instálalo con:"
        aviso "    ../portapapeles/instalar.sh"
        aviso "o, si solo quieres el programa:  sudo apt install copyq"
    fi
}

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../comun/instalar.sh"

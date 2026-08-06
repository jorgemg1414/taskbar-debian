#!/usr/bin/env bash
#
# install.sh — Instala la extensión «ssh-menu» en tu carpeta de usuario.
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

UUID="ssh-menu@jorgemg1414"
PROPIOS=(metadata.json extension.js prefs.js montajes.js)
COMUNES=(asyncgio.js barra.js barraprefs.js checker.js hosts.js menu.js wol.js)
ESTILOS_COMUNES=si


# --------------------- Requisitos de esta extensión ---------------------
requisitos() {
    if ! command -v ssh >/dev/null 2>&1; then
        aviso "No se encontró el cliente ssh. Instálalo con:"
        aviso "  sudo apt install openssh-client"
    fi

    # El SFTP lo monta GVfs; sin su backend, el gestor de archivos no sabe abrirlo.
    if ! dpkg -s gvfs-backends >/dev/null 2>&1; then
        aviso "Falta gvfs-backends: el botón de SFTP no podrá montar nada."
        aviso "  sudo apt install gvfs-backends"
    fi
}

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../comun/instalar.sh"

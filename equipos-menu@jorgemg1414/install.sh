#!/usr/bin/env bash
#
# install.sh — Instala la extensión «equipos-menu» en tu carpeta de usuario.
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

UUID="equipos-menu@jorgemg1414"
PROPIOS=(metadata.json extension.js prefs.js vitales.js)
COMUNES=(asyncgio.js barra.js barraprefs.js checker.js hosts.js menu.js wol.js)
ESTILOS_COMUNES=si


# --------------------- Requisitos de esta extensión ---------------------
requisitos() {
    if ! command -v ssh >/dev/null 2>&1; then
        error "No se encontró el cliente ssh, que es con lo que se pregunta a los equipos."
        error "  sudo apt install openssh-client"
        exit 1
    fi

    if [[ ! -f "${HOME}/.ssh/config" ]]; then
        aviso "No tienes ~/.ssh/config: el menú saldrá vacío hasta que añadas equipos."
    fi

    # El menú pregunta con BatchMode: sin clave propia no hay forma de entrar sin
    # contraseña, y todas las consultas fallarían.
    if ! ls "${HOME}"/.ssh/id_* >/dev/null 2>&1; then
        aviso "No se ve ninguna clave SSH en ~/.ssh: genera una con «ssh-keygen -t ed25519»"
        aviso "y autorízala en cada equipo con herramientas/autorizar-clave.sh."
    fi
}

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../comun/instalar.sh"

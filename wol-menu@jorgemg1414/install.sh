#!/usr/bin/env bash
#
# install.sh — Instala la extensión «wol-menu» en tu carpeta de usuario.
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

UUID="wol-menu@jorgemg1414"
PROPIOS=(metadata.json extension.js prefs.js)
COMUNES=(asyncgio.js barra.js barraprefs.js checker.js hosts.js wol.js)
ESTILOS_COMUNES=si


# Wake-on-LAN no necesita ningún programa externo: el paquete lo manda la
# propia extensión con Gio. Lo que sí hace falta es activarlo en la BIOS del
# equipo que quieres encender, y a menudo también en su tarjeta de red.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../comun/instalar.sh"

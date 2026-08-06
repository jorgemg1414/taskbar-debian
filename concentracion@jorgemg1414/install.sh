#!/usr/bin/env bash
#
# install.sh — Instala la extensión «concentracion» en tu carpeta de usuario.
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

UUID="concentracion@jorgemg1414"
PROPIOS=(metadata.json extension.js prefs.js)
COMUNES=()


# No necesita ningún programa externo: lo que apaga son ajustes de GNOME y
# llamadas por el bus de sesión, que ya está ahí. Esconder la dock solo hace
# algo si tienes Dash to Dock instalada.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../comun/instalar.sh"

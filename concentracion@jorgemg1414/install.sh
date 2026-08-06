#!/usr/bin/env bash
#
# install.sh — Instala la extensión «concentracion» en tu carpeta de usuario.
#
# Uso:
#   ./install.sh            instala y compila los esquemas
#   ./install.sh --enable   instala y además activa la extensión
#   ./install.sh --uninstall  desinstala
#
set -euo pipefail

UUID="concentracion@jorgemg1414"
ORIGEN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESTINO="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

# Colores discretos para los mensajes.
verde()  { printf '\033[1;32m%s\033[0m\n' "$*"; }
aviso()  { printf '\033[1;33m%s\033[0m\n' "$*"; }
error()  { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }

# ------------------------- Desinstalación -------------------------
if [[ "${1:-}" == "--uninstall" ]]; then
    gnome-extensions disable "$UUID" 2>/dev/null || true
    rm -rf "$DESTINO"
    verde "Extensión desinstalada de ${DESTINO}"
    exit 0
fi

# --------------------------- Requisitos ---------------------------
if ! command -v glib-compile-schemas >/dev/null 2>&1; then
    error "Falta glib-compile-schemas. Instálalo con:  sudo apt install libglib2.0-dev-bin"
    exit 1
fi

# No necesita ningún programa externo: lo que apaga son ajustes de GNOME y
# llamadas por el bus de sesión, que ya está ahí. Esconder la dock solo hace
# algo si tienes Dash to Dock instalada.

# ---------------------------- Copia -------------------------------
# Los módulos compartidos con las demás extensiones viven en «comun/», en la
# raíz del repositorio. Se copian junto a los propios para que lo instalado sea
# autocontenido, que es como GNOME carga las extensiones.
COMUN="$(cd "${ORIGEN}/.." && pwd)/comun"
if [[ ! -d "$COMUN" ]]; then
    error "Falta la carpeta «comun/» del repositorio: ${COMUN}"
    error "Clona el repositorio entero, no solo la carpeta de la extensión."
    exit 1
fi

mkdir -p "$DESTINO/schemas"

for archivo in metadata.json extension.js prefs.js stylesheet.css; do
    install -m 644 "${ORIGEN}/${archivo}" "${DESTINO}/${archivo}"
done

for archivo in barra.js barraprefs.js mpris.js; do
    install -m 644 "${COMUN}/${archivo}" "${DESTINO}/${archivo}"
done

install -m 644 "${ORIGEN}/schemas/org.gnome.shell.extensions.concentracion.gschema.xml" \
               "${DESTINO}/schemas/"

# Compila el esquema de GSettings (necesario para las preferencias).
glib-compile-schemas "${DESTINO}/schemas"

verde "Instalada en: ${DESTINO}"

# --------------------------- Activación ---------------------------
if [[ "${1:-}" == "--enable" ]]; then
    gnome-extensions enable "$UUID" && verde "Extensión activada."
fi

echo
echo "Para que GNOME Shell vea los cambios:"
if [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
    aviso "  Estás en Wayland: hay que cerrar sesión y volver a entrar."
    echo  "  (Alternativa rápida sin cerrar sesión, recarga solo la extensión:)"
    echo  "     gnome-extensions disable ${UUID} && gnome-extensions enable ${UUID}"
else
    echo  "  Pulsa Alt+F2, escribe 'r' y Enter (X11), o cierra sesión y vuelve a entrar."
fi
echo
echo "Después, actívala si aún no lo has hecho:"
echo "     gnome-extensions enable ${UUID}"
echo
echo "Para ver errores en vivo:"
echo "     journalctl -f -o cat /usr/bin/gnome-shell"

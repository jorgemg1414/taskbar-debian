#!/usr/bin/env bash
#
# instalar.sh — El instalador que comparten las extensiones del repositorio.
#
# Los seis install.sh eran el mismo archivo de noventa y tantas líneas: solo
# cambiaban el UUID, la lista de archivos y los programas que conviene tener.
# Aquí está una vez, y cada extensión se queda con lo suyo.
#
# Contrato: antes de cargar este archivo, el install.sh de la extensión define
#
#   UUID              nombre de la carpeta que se instala
#   PROPIOS           archivos de la propia extensión que se copian
#   COMUNES           módulos de comun/ que necesita
#   ESTILOS_COMUNES   «si» si su hoja usa las clases «tb-» (opcional)
#   requisitos()      comprobaciones propias, si tiene (opcional)
#
# y termina con:
#
#   source "$(dirname "${BASH_SOURCE[0]}")/../comun/instalar.sh"
#
# Los argumentos (--enable, --uninstall) los ve tal cual, porque un archivo
# cargado con «source» comparte los parámetros de quien lo carga.

# Colores discretos para los mensajes.
verde()  { printf '\033[1;32m%s\033[0m\n' "$*"; }
aviso()  { printf '\033[1;33m%s\033[0m\n' "$*"; }
error()  { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }

# BASH_SOURCE[-1] es el script que se ejecutó, no este: la carpeta que hace
# falta es la de la extensión.
ORIGEN="$(cd "$(dirname "${BASH_SOURCE[-1]}")" && pwd)"
DESTINO="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
COMUN="$(cd "${ORIGEN}/.." && pwd)/comun"

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

if [[ ! -d "$COMUN" ]]; then
    error "Falta la carpeta «comun/» del repositorio: ${COMUN}"
    error "Clona el repositorio entero, no solo la carpeta de la extensión."
    exit 1
fi

# Lo que solo le hace falta a esta extensión.
if declare -F requisitos >/dev/null; then
    requisitos
fi

# ---------------------------- Copia -------------------------------
mkdir -p "$DESTINO/schemas"

for archivo in "${PROPIOS[@]}"; do
    install -m 644 "${ORIGEN}/${archivo}" "${DESTINO}/${archivo}"
done

# Los módulos compartidos se copian junto a los propios para que lo instalado
# sea autocontenido, que es como GNOME carga las extensiones.
for archivo in "${COMUNES[@]}"; do
    install -m 644 "${COMUN}/${archivo}" "${DESTINO}/${archivo}"
done

# La hoja de estilos que se instala son las reglas comunes seguidas de las
# propias: GNOME carga una sola por extensión y no admite importar otra.
if [[ "${ESTILOS_COMUNES:-no}" == "si" ]]; then
    cat "${COMUN}/estilos.css" "${ORIGEN}/stylesheet.css" > "${DESTINO}/stylesheet.css"
else
    cat "${ORIGEN}/stylesheet.css" > "${DESTINO}/stylesheet.css"
fi
chmod 644 "${DESTINO}/stylesheet.css"

install -m 644 "${ORIGEN}/schemas/org.gnome.shell.extensions.${UUID%@*}.gschema.xml" \
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

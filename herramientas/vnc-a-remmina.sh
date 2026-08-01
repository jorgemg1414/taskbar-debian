#!/usr/bin/env bash
#
# vnc-a-remmina.sh — Convierte archivos .vnc (RealVNC) en perfiles de Remmina.
#
# Genera un .remmina por cada .vnc encontrado, con el nombre, el servidor, el
# usuario y el grupo. NO copia contraseñas: las de RealVNC están cifradas con
# una clave distinta y no sirven aquí. Para guardarlas usa, después:
#
#     ./guardar-password.sh
#
# Uso:
#   ./vnc-a-remmina.sh [ORIGEN] [DESTINO]
#
#   ORIGEN   carpeta con los .vnc      (por omisión ~/Documentos/VNC)
#   DESTINO  carpeta de perfiles       (por omisión ~/.config/remmina)
#
set -euo pipefail

ORIGEN="${1:-$HOME/Documentos/VNC}"
DESTINO="${2:-$HOME/.config/remmina}"

verde() { printf '\033[1;32m%s\033[0m\n' "$*"; }
aviso() { printf '\033[1;33m%s\033[0m\n' "$*"; }

if [[ ! -d "$ORIGEN" ]]; then
    printf '\033[1;31mNo existe la carpeta de origen: %s\033[0m\n' "$ORIGEN" >&2
    exit 1
fi

mkdir -p "$DESTINO"

# Lee el valor de una clave del .vnc (formato Clave=Valor, sin secciones).
valor_de() {
    local archivo="$1" clave="$2"
    sed -n "s/^${clave}=//p" "$archivo" | head -1 | tr -d '\r'
}

creados=0
omitidos=0

while IFS= read -r -d '' vnc; do
    nombre="$(basename "$vnc")"
    nombre="${nombre%.*}"

    host_completo="$(valor_de "$vnc" 'Host')"
    [[ -z "$host_completo" ]] && { aviso "Sin Host=, se omite: $nombre"; omitidos=$((omitidos + 1)); continue; }

    # Si no trae puerto, Remmina usa el 5900 por omisión.
    servidor="$host_completo"
    usuario="$(valor_de "$vnc" 'UserName')"

    # El grupo sale de la subcarpeta si la hay; si no, de la primera etiqueta.
    relativa="${vnc#"$ORIGEN"/}"
    subcarpeta="$(dirname "$relativa")"
    if [[ "$subcarpeta" != "." ]]; then
        grupo="$subcarpeta"
    else
        grupo="$(valor_de "$vnc" 'Labels' | cut -d, -f1)"
        # Las etiquetas jerárquicas de RealVNC (A/B) se quedan con el último tramo.
        grupo="${grupo##*/}"
    fi

    destino="$DESTINO/${nombre}.remmina"

    cat > "$destino" <<EOF
[remmina]
name=$nombre
protocol=VNC
server=$servidor
username=$usuario
group=$grupo
password=
colordepth=32
quality=9
viewmode=1
disableencryption=0
disableserverinput=0
disableclipboard=0
showcursor=0
EOF
    chmod 600 "$destino"
    creados=$((creados + 1))
    printf '  %-20s -> %s\n' "$nombre" "$servidor"
done < <(find "$ORIGEN" -type f -iname '*.vnc' -print0 | sort -z)

echo
verde "Perfiles creados: $creados en $DESTINO"
[[ $omitidos -gt 0 ]] && aviso "Omitidos por no tener Host=: $omitidos"

cat <<'FIN'

Siguientes pasos:

  1. Guardar la contraseña en el llavero de GNOME (te la pedirá por teclado):

       ./guardar-password.sh

  2. Apuntar la extensión a los perfiles de Remmina:

       gsettings --schemadir ~/.local/share/gnome-shell/extensions/vnc-menu@jorgemg1414/schemas \
         set org.gnome.shell.extensions.vnc-menu connections-dir '~/.config/remmina'

FIN

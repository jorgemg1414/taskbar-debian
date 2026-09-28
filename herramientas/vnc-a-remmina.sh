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
# Perfiles escritos en esta pasada: dos .vnc con el mismo nombre en carpetas
# distintas irían al mismo .remmina, y el segundo borraría el primero.
declare -A escritos=()

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

    if [[ -n "${escritos[$destino]:-}" ]]; then
        aviso "Nombre repetido, se omite: $relativa (ya salió de ${escritos[$destino]})"
        omitidos=$((omitidos + 1))
        continue
    fi
    escritos[$destino]="$relativa"

    # «password=.» es la marca de Remmina para «la contraseña está en el
    # llavero», y la pone guardar-password.sh. Si el perfil ya la tenía, se
    # conserva: sin ella, Remmina deja de mirar el llavero y la vuelve a pedir.
    clave=''
    if [[ -f "$destino" ]] && grep -qx 'password=\.' "$destino"; then
        clave='.'
    fi

    cat > "$destino" <<EOF
[remmina]
name=$nombre
protocol=VNC
server=$servidor
username=$usuario
group=$grupo
password=$clave
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
[[ $omitidos -gt 0 ]] && aviso "Omitidos (sin Host= o con el nombre repetido): $omitidos"

cat <<'FIN'

Siguientes pasos:

  1. Guardar la contraseña en el llavero de GNOME (te la pedirá por teclado):

       ./guardar-password.sh

  2. Apuntar la extensión a los perfiles de Remmina:

       gsettings --schemadir ~/.local/share/gnome-shell/extensions/vnc-menu@jorgemg1414/schemas \
         set org.gnome.shell.extensions.vnc-menu connections-dir '~/.config/remmina'

FIN

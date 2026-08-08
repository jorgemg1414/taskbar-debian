#!/usr/bin/env bash
#
# instalar.sh — Historial del portapapeles con CopyQ.
#
# Instala CopyQ, lo deja arrancando con la sesión y le pone dos atajos:
#
#   Super+V         la lista de lo último copiado, donde tengas el ratón
#   Super+Shift+V   la ventana entera, con buscador, para lo de hace días
#
# Uso:
#   ./instalar.sh                instala
#   ./instalar.sh --desinstalar  quita los atajos y el arranque automático
#
set -euo pipefail

verde() { printf '\033[1;32m%s\033[0m\n' "$*"; }
aviso() { printf '\033[1;33m%s\033[0m\n' "$*"; }
error() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }

RUTA_BASE='/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings'
ESQUEMA='org.gnome.settings-daemon.plugins.media-keys.custom-keybinding'
LISTA='org.gnome.settings-daemon.plugins.media-keys custom-keybindings'

# Los atajos que se van a crear: nombre | comando | combinación.
ATAJOS=(
    'Portapapeles: lo último|copyq menu|<Super>v'
    'Portapapeles: buscar|copyq toggle|<Super><Shift>v'
)

# ------------------- Ayudas para los atajos de GNOME -------------------

# Devuelve las rutas de atajos personalizados que hay ahora, una por línea.
# Cuando no hay ninguna, gsettings contesta «@as []», de ahí el filtro por la
# barra inicial en vez de por línea no vacía.
rutas_actuales() {
    gsettings get $LISTA \
        | tr -d "[]' " | tr ',' '\n' | grep '^/' || true
}

# Escribe la lista de rutas (una por línea en la entrada) en el formato de
# GVariant que espera gsettings: ['/ruta/uno/', '/ruta/dos/'].
# El «|| [[ -n $ruta ]]» es para no perder la última línea cuando el texto que
# llega no termina en salto de línea.
guardar_rutas() {
    local lista='' ruta
    while IFS= read -r ruta || [[ -n "$ruta" ]]; do
        [[ -z "$ruta" ]] && continue
        lista+="${lista:+, }'${ruta}'"
    done
    gsettings set $LISTA "[${lista}]"
}

# La ruta que ya usa este comando, si existe; si no, la primera libre.
ruta_para() {
    local comando="$1" actuales i ruta
    actuales="$(rutas_actuales)"

    while IFS= read -r ruta; do
        [[ -z "$ruta" ]] && continue
        if [[ "$(gsettings get "${ESQUEMA}:${ruta}" command 2>/dev/null)" == "'${comando}'" ]]; then
            printf '%s\n' "$ruta"
            return
        fi
    done <<< "$actuales"

    # Se busca el primer customN que no esté en la lista, sin dar por hecho
    # que están numerados seguidos.
    for (( i = 0; i < 100; i++ )); do
        ruta="${RUTA_BASE}/custom${i}/"
        grep -qxF "$ruta" <<< "$actuales" || { printf '%s\n' "$ruta"; return; }
    done

    error "Cien atajos personalizados y ninguno libre. Algo raro pasa."
    exit 1
}

# ------------------------- Desinstalación -------------------------
if [[ "${1:-}" == "--desinstalar" ]]; then
    conservadas=''
    while IFS= read -r ruta; do
        [[ -z "$ruta" ]] && continue
        comando="$(gsettings get "${ESQUEMA}:${ruta}" command 2>/dev/null || echo '')"
        if [[ "$comando" == "'copyq menu'" || "$comando" == "'copyq toggle'" ]]; then
            for clave in name command binding; do
                gsettings reset "${ESQUEMA}:${ruta}" "$clave" 2>/dev/null || true
            done
        else
            conservadas+="${ruta}"$'\n'
        fi
    done <<< "$(rutas_actuales)"
    printf '%s' "$conservadas" | guardar_rutas

    # Super+V vuelve a abrir el panel de notificaciones.
    gsettings reset org.gnome.shell.keybindings toggle-message-tray

    command -v copyq >/dev/null 2>&1 && copyq exit >/dev/null 2>&1 || true
    rm -f "${HOME}/.config/autostart/copyq.desktop"

    verde "Atajos y arranque automático quitados."
    aviso "CopyQ y su historial siguen ahí. Para borrarlos del todo:"
    aviso "    sudo apt remove copyq && rm -rf ~/.local/share/copyq ~/.config/copyq"
    exit 0
fi

# --------------------------- Requisitos ---------------------------
if [[ "${XDG_CURRENT_DESKTOP:-}" != *GNOME* ]]; then
    aviso "Esto pone los atajos con gsettings, que es cosa de GNOME."
    aviso "Escritorio detectado: ${XDG_CURRENT_DESKTOP:-ninguno}. Sigo, pero avisado quedas."
fi

if ! dpkg -s copyq >/dev/null 2>&1; then
    verde "Instalando CopyQ"
    sudo apt-get update -qq
    sudo apt-get install -y copyq
else
    verde "CopyQ ya estaba instalado."
fi

# --------------------------- Ajustes ------------------------------
# La configuración se toca con «copyq config», no escribiendo el .conf a mano:
# CopyQ guarda su copia en memoria al salir y se llevaría por delante lo que
# hubiéramos escrito.
if ! copyq size >/dev/null 2>&1; then
    verde "Arrancando CopyQ"
    copyq --start-server >/dev/null 2>&1 &
    for _ in $(seq 40); do
        copyq size >/dev/null 2>&1 && break
        sleep 0.25
    done
fi

if ! copyq size >/dev/null 2>&1; then
    error "CopyQ no responde. Arráncalo a mano («copyq &») y vuelve a ejecutar esto."
    exit 1
fi

# Solo se cambia lo que esta versión de CopyQ reconozca: los nombres de los
# ajustes cambian de una versión a otra y no merece la pena parar por uno.
ajuste() {
    local clave="$1" valor="$2"
    if copyq config "$clave" >/dev/null 2>&1; then
        copyq config "$clave" "$valor" >/dev/null
    else
        aviso "Esta versión de CopyQ no conoce «${clave}»; lo dejo."
    fi
}

ajuste autostart true          # arranca con la sesión
ajuste maxitems 500            # 200 se quedan cortos en un día de trabajo
ajuste activate_closes true    # al elegir algo, se cierra la lista
ajuste activate_pastes true    # y se pega solo donde estuviera el cursor
ajuste activate_focuses false
ajuste move true               # lo que eliges sube al principio de la lista
ajuste check_clipboard true    # guardar lo que se copia con Ctrl+C
ajuste check_selection false   # NO guardar cada cosa que se marca con el ratón
ajuste close_on_unfocus true
ajuste confirm_exit false
ajuste text_wrap true
ajuste tray_items 12
ajuste maxitem_size 512        # KiB: corta las capturas enormes, no el texto
ajuste save_filter_history true

verde "CopyQ configurado."

# ---------------------------- Atajos ------------------------------
# GNOME tiene Super+V cogido para el panel de notificaciones, y Super+M hace
# exactamente lo mismo. Se le deja Super+M y se libera Super+V.
if [[ "$(gsettings get org.gnome.shell.keybindings toggle-message-tray)" == *"<Super>v"* ]]; then
    gsettings set org.gnome.shell.keybindings toggle-message-tray "['<Super>m']"
    aviso "Super+V ya no abre las notificaciones; Super+M sigue haciéndolo."
fi

rutas="$(rutas_actuales)"
for atajo in "${ATAJOS[@]}"; do
    IFS='|' read -r nombre comando combinacion <<< "$atajo"
    ruta="$(ruta_para "$comando")"

    gsettings set "${ESQUEMA}:${ruta}" name "$nombre"
    gsettings set "${ESQUEMA}:${ruta}" command "$comando"
    gsettings set "${ESQUEMA}:${ruta}" binding "$combinacion"

    grep -qxF "$ruta" <<< "$rutas" || rutas+=$'\n'"$ruta"
    # Se guarda en cada vuelta: si no, el segundo atajo volvería a ver libre
    # el hueco que acaba de coger el primero y los dos irían al mismo customN.
    printf '%s\n' "$rutas" | guardar_rutas
    verde "Atajo ${combinacion} → ${comando}"
done

echo
verde "Listo. Copia tres cosas seguidas y prueba:"
cat <<'FIN'

    Super+V         la lista de lo último copiado, junto al ratón
    Super+Shift+V   la ventana con buscador, para lo de hace días
    Super+M         las notificaciones, que antes estaban en Super+V

FIN

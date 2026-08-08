#!/usr/bin/env bash
#
# tilix.sh — El aspecto de Tilix: fuente, colores y comportamiento.
#
# Tilix guarda todo en dconf, así que esto no escribe ningún archivo de
# configuración: son llamadas a gsettings sobre el perfil que tengas puesto
# como predeterminado. Lo que se toca se puede deshacer con --desinstalar, que
# devuelve cada clave a su valor de fábrica.
#
# Uso:
#   ./tilix.sh [ESQUEMA]        aplica el aspecto
#   ./tilix.sh --listar         enseña los esquemas de color disponibles
#   ./tilix.sh --desinstalar    deja Tilix como venía
#
#   ESQUEMA  uno de los que trae Tilix en /usr/share/tilix/schemes/
#            (por omisión «material»)
#
set -euo pipefail

verde() { printf '\033[1;32m%s\033[0m\n' "$*"; }
aviso() { printf '\033[1;33m%s\033[0m\n' "$*"; }
error() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }

ESQUEMAS='/usr/share/tilix/schemes'

# Copia de tu configuración de Tilix antes de tocarla. Sin esto, deshacer solo
# puede devolver las claves a los valores DE FÁBRICA, que no son «como lo tenías
# tú»: si llevabas la transparencia al 27 y el valor de fábrica es otro, un
# «reset» te la cambia sin avisar y encima parece que ha funcionado.
COPIA="${HOME}/.config/tilix-antes-de-taskbar-debian.dconf"

# Lo que se cambia. Está aquí arriba y no repartido por el script para que se
# vea de un vistazo y se pueda tocar sin buscar.
FUENTE='JetBrains Mono 11'
ALTO_LINEA=1.1          # un pelín de aire entre líneas: se lee bastante mejor
TRANSPARENCIA=10        # 27 dejaba el texto peleándose con el fondo de pantalla
HISTORIAL=100000        # líneas hacia atrás en cada terminal

# La fuente. Debian no empaqueta ninguna Nerd Font, así que aquí no hay iconos:
# JetBrains Mono es de las más legibles a tamaños pequeños y distingue bien la
# O de la 0 y la l de la 1, que en una terminal importa.
PAQUETES=(fonts-jetbrains-mono)

# ------------------------------ Esquemas -------------------------------
if [[ "${1:-}" == "--listar" ]]; then
    verde "Esquemas de color que trae Tilix:"
    for archivo in "${ESQUEMAS}"/*.json; do
        nombre="$(basename "$archivo" .json)"
        printf '    %-24s %s\n' "$nombre" "$(jq -r '.comment // .name // ""' "$archivo")"
    done
    exit 0
fi

# --------------------------- Requisitos --------------------------------
if ! command -v tilix >/dev/null 2>&1; then
    error "Tilix no está instalado."
    exit 1
fi

UUID="$(gsettings get com.gexperts.Tilix.ProfilesList default | tr -d "'")"
if [[ -z "$UUID" ]]; then
    error "Tilix no tiene un perfil predeterminado. Abre sus preferencias una vez."
    exit 1
fi
PERFIL="com.gexperts.Tilix.Profile:/com/gexperts/Tilix/profiles/${UUID}/"

# ------------------------- Desinstalación ------------------------------
if [[ "${1:-}" == "--desinstalar" ]]; then
    if [[ -f "$COPIA" ]]; then
        # Se borra el árbol entero y se vuelve a cargar el de antes. Así vuelve
        # exactamente lo que tenías, incluido lo que ya habías configurado tú y
        # este script no llegó a tocar.
        dconf reset -f /com/gexperts/Tilix/
        dconf load /com/gexperts/Tilix/ < "$COPIA"
        verde "Tilix restaurado tal y como estaba, desde ${COPIA}"
    else
        aviso "No hay copia previa: se devuelven las claves a los valores de fábrica,"
        aviso "que pueden no ser los que tú tenías."
        for clave in font use-system-font cell-height-scale use-theme-colors \
                     foreground-color background-color palette \
                     background-transparency-percent scrollback-lines \
                     scrollback-unlimited cursor-shape cursor-blink-mode; do
            gsettings reset "$PERFIL" "$clave" 2>/dev/null || true
        done
        for clave in enable-transparency copy-on-select notify-on-process-complete \
                     enable-wide-handle; do
            gsettings reset com.gexperts.Tilix.Settings "$clave" 2>/dev/null || true
        done
    fi

    gsettings reset org.gnome.desktop.default-applications.terminal exec 2>/dev/null || true
    gsettings reset org.gnome.desktop.default-applications.terminal exec-arg 2>/dev/null || true

    verde "Abre una ventana nueva de Tilix para verlo."
    aviso "La fuente sigue instalada. Para quitarla:  sudo apt remove ${PAQUETES[*]}"
    exit 0
fi

# ------------------------------ Fuentes --------------------------------
faltan=()
for paquete in "${PAQUETES[@]}"; do
    dpkg -s "$paquete" >/dev/null 2>&1 || faltan+=("$paquete")
done

if (( ${#faltan[@]} )); then
    verde "Instalando: ${faltan[*]}"
    sudo apt-get update -qq
    sudo apt-get install -y "${faltan[@]}"
    fc-cache -f >/dev/null 2>&1 || true
else
    verde "La fuente ya estaba instalada."
fi

# --------------------------- Copia de seguridad -------------------------
# Solo la primera vez: la segunda, «lo de antes» ya sería lo que puso esto.
if [[ ! -f "$COPIA" ]]; then
    dconf dump /com/gexperts/Tilix/ > "$COPIA"
    verde "Tu configuración de Tilix, guardada en ${COPIA}"
    verde "«./tilix.sh --desinstalar» la devuelve tal cual."
fi

# ------------------------------ Colores --------------------------------
ESQUEMA="${1:-material}"
ARCHIVO="${ESQUEMAS}/${ESQUEMA}.json"

if [[ ! -f "$ARCHIVO" ]]; then
    error "No existe el esquema «${ESQUEMA}»."
    error "Los que hay se ven con:  ./tilix.sh --listar"
    exit 1
fi

# La paleta del JSON ya es una lista de cadenas entre comillas, que es
# exactamente la sintaxis que gsettings espera para un array de cadenas.
gsettings set "$PERFIL" use-theme-colors false
gsettings set "$PERFIL" foreground-color "$(jq -r '."foreground-color"' "$ARCHIVO")"
gsettings set "$PERFIL" background-color "$(jq -r '."background-color"' "$ARCHIVO")"
gsettings set "$PERFIL" palette "$(jq -c '.palette' "$ARCHIVO")"
verde "Esquema de color: ${ESQUEMA}"

# ------------------------------- Perfil --------------------------------
gsettings set "$PERFIL" use-system-font false
gsettings set "$PERFIL" font "$FUENTE"
gsettings set "$PERFIL" cell-height-scale "$ALTO_LINEA"

gsettings set "$PERFIL" background-transparency-percent "$TRANSPARENCIA"
gsettings set "$PERFIL" scrollback-unlimited false
gsettings set "$PERFIL" scrollback-lines "$HISTORIAL"

gsettings set "$PERFIL" cursor-shape 'block'
gsettings set "$PERFIL" cursor-blink-mode 'on'
verde "Fuente: ${FUENTE}   ·   historial: ${HISTORIAL} líneas"

# ------------------------------ Globales -------------------------------
gsettings set com.gexperts.Tilix.Settings enable-transparency true

# Marcar con el ratón ya copia: en una terminal es lo que espera la mano, y el
# Ctrl+Shift+C sigue estando para cuando no.
gsettings set com.gexperts.Tilix.Settings copy-on-select true

# Aviso del escritorio cuando termina algo largo en una terminal que no estás
# mirando. Con equipos remotos de por medio, esto se agradece.
gsettings set com.gexperts.Tilix.Settings notify-on-process-complete true

# El tirador entre paneles divididos, más ancho: acertarle con el ratón deja de
# ser puntería.
gsettings set com.gexperts.Tilix.Settings enable-wide-handle true
verde "Copiar al marcar, aviso al terminar, tirador ancho."

# -------------------------- Terminal por omisión -----------------------
gsettings set org.gnome.desktop.default-applications.terminal exec 'tilix'
gsettings set org.gnome.desktop.default-applications.terminal exec-arg '-e'

# Lo anterior vale para GNOME. Los programas que abren «x-terminal-emulator» a
# secas van por las alternativas de Debian, que son del sistema y piden sudo.
#
# Ojo con la ruta: lo que Debian registra no es /usr/bin/tilix sino
# /usr/bin/tilix.wrapper, y update-alternatives --set rechaza cualquier ruta
# que no esté en su lista. Por eso se saca de la lista en vez de darla por
# supuesta; el nombre del wrapper es cosa del paquete y puede cambiar.
ALTERNATIVA="$(update-alternatives --list x-terminal-emulator 2>/dev/null | grep -m1 '/tilix' || true)"

if [[ -z "$ALTERNATIVA" ]]; then
    aviso "Tilix no está registrado como alternativa de x-terminal-emulator."
    aviso "Los programas que abran «una terminal» seguirán usando otra."
elif [[ "$(readlink -f /etc/alternatives/x-terminal-emulator 2>/dev/null)" == "$ALTERNATIVA" ]]; then
    verde "Tilix es ya el terminal por omisión."
elif sudo update-alternatives --set x-terminal-emulator "$ALTERNATIVA" >/dev/null 2>&1; then
    verde "Tilix es ya el terminal por omisión, también para x-terminal-emulator."
else
    aviso "No se pudo cambiar x-terminal-emulator. A mano:"
    aviso "    sudo update-alternatives --config x-terminal-emulator"
fi

echo
verde "Listo. Los cambios se ven en las ventanas nuevas de Tilix."
cat <<FIN

Para probar otro esquema de color, sin repetir lo demás:
    ./tilix.sh --listar
    ./tilix.sh solarized-dark

La transparencia quedó en ${TRANSPARENCIA}% (venía al 27, y con el fondo claro
que tienes el texto salía peleado). Para cambiarla sin tocar nada más:
    gsettings set ${PERFIL} background-transparency-percent 20

FIN

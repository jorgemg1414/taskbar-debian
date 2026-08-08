#!/usr/bin/env bash
#
# instalar.sh — Deja la terminal como debería venir de fábrica.
#
# Instala lo que le falta a zsh (sugerencias, colores, búsqueda difusa y salto
# de carpetas), amplía la lista de plugins de Oh My Zsh y copia terminal.zsh a
# ~/.oh-my-zsh/custom/, que es donde Oh My Zsh carga lo de cada uno.
#
# Uso:
#   ./instalar.sh              instala
#   ./instalar.sh --desinstalar  deja el .zshrc como estaba
#
# No toca ningún archivo sin guardar antes una copia: la primera vez que se
# ejecuta, el .zshrc original queda en ~/.zshrc.antes-de-terminal.
#
set -euo pipefail

verde() { printf '\033[1;32m%s\033[0m\n' "$*"; }
aviso() { printf '\033[1;33m%s\033[0m\n' "$*"; }
error() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }

ORIGEN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZSHRC="${HOME}/.zshrc"
CUSTOM="${HOME}/.oh-my-zsh/custom"
COPIA="${HOME}/.zshrc.antes-de-terminal"

# Los plugins que trae Oh My Zsh y que aquí se activan. Los otros cuatro
# programas no son plugins suyos: son paquetes de Debian que carga
# terminal.zsh.
PLUGINS='git sudo colored-man-pages command-not-found extract systemd safe-paste fzf zoxide'

# Paquetes de Debian. fzf ya suele estar; el resto no venía.
PAQUETES=(
    zsh-autosuggestions         # el resto del comando, en gris, según escribes
    zsh-syntax-highlighting     # verde si el comando existe, rojo si no
    zoxide                      # «z documentos» salta a la carpeta desde donde sea
    fzf                         # Ctrl+R, Ctrl+T y Alt+C con búsqueda difusa
    ripgrep                     # buscar dentro de los archivos, rápido
    fd-find                     # buscar archivos por nombre, rápido (binario: fdfind)
    command-not-found           # «no existe htop, instálalo con apt install htop»
    xclip                       # copiar la salida de un comando al portapapeles
    starship                    # el prompt: rama, duración, código de error, aviso de SSH
)

# --------------------------- Solo colores --------------------------
# La parte más barata de todo esto —el comando en verde o en rojo según lo
# escribes— sin nada más: sin prompt nuevo, sin sugerencias, sin tocar el
# .zshrc. Solo hace falta un paquete, y si ya está no pide ni contraseña.
if [[ "${1:-}" == "--solo-colores" ]]; then
    if ! dpkg -s zsh-syntax-highlighting >/dev/null 2>&1; then
        verde "Instalando zsh-syntax-highlighting"
        sudo apt-get update -qq
        sudo apt-get install -y zsh-syntax-highlighting
    fi

    mkdir -p "$CUSTOM"
    # terminal.zsh ya trae los colores dentro: los dos juntos cargarían el
    # plugin dos veces y duplicarían los widgets de la línea.
    if [[ -f "${CUSTOM}/terminal.zsh" ]]; then
        rm -f "${CUSTOM}/terminal.zsh"
        aviso "Quitado terminal.zsh: los colores ya iban dentro, y no pueden estar los dos."
        aviso "Lo demás que traía —sugerencias, Ctrl+R, z, el prompt— ya no está."
    fi
    install -m 644 "${ORIGEN}/colores.zsh" "${CUSTOM}/colores.zsh"

    verde "Puesto. Abre una terminal nueva (o ejecuta: exec zsh)."
    verde "Tu tema y tu lista de plugins se quedan como están; el .zshrc no se toca."
    exit 0
fi

# ------------------------- Desinstalación -------------------------
if [[ "${1:-}" == "--desinstalar" ]]; then
    rm -f "${CUSTOM}/terminal.zsh" "${CUSTOM}/colores.zsh"
    # El prompt de antes vuelve solo con el .zshrc, que es donde estaba el tema.
    if [[ -f "${HOME}/.config/starship.toml.anterior" ]]; then
        mv "${HOME}/.config/starship.toml.anterior" "${HOME}/.config/starship.toml"
        verde "Restaurado tu starship.toml de antes."
    else
        rm -f "${HOME}/.config/starship.toml"
    fi
    if [[ -f "$COPIA" ]]; then
        cp "$COPIA" "$ZSHRC"
        verde "Restaurado el .zshrc de antes de instalar."
    else
        aviso "No hay copia del .zshrc original; la lista de plugins se queda como está."
    fi
    verde "Quitado. Abre una terminal nueva."
    aviso "Los paquetes siguen instalados. Para quitarlos:"
    aviso "    sudo apt remove ${PAQUETES[*]}"
    exit 0
fi

# --------------------------- Requisitos ---------------------------
if [[ ! -d "${HOME}/.oh-my-zsh" ]]; then
    error "No encuentro ~/.oh-my-zsh. Esto está pensado para zsh con Oh My Zsh."
    exit 1
fi

if [[ ! -f "$ZSHRC" ]]; then
    error "No existe ${ZSHRC}."
    exit 1
fi

# ---------------------------- Paquetes ----------------------------
faltan=()
for paquete in "${PAQUETES[@]}"; do
    dpkg -s "$paquete" >/dev/null 2>&1 || faltan+=("$paquete")
done

if (( ${#faltan[@]} )); then
    verde "Instalando: ${faltan[*]}"
    sudo apt-get update -qq
    sudo apt-get install -y "${faltan[@]}"
    # La base de datos de «no existe ese comando» se genera aparte y tarda un
    # poco; si falla no es motivo para parar.
    sudo update-command-not-found >/dev/null 2>&1 || true
else
    verde "Los paquetes ya estaban instalados."
fi

# ------------------------ Copia del .zshrc ------------------------
[[ -f "$COPIA" ]] || cp "$ZSHRC" "$COPIA"

# --------------------------- Plugins ------------------------------
# Solo se toca la línea «plugins=(...)» cuando abre y cierra en el mismo
# renglón, que es como la deja Oh My Zsh. Con un rango de sed la cosa se
# tuerce: el paréntesis de cierre lo encontraría veinte líneas más abajo, en
# el «$(uname -m)» de los comentarios, y se llevaría por delante el
# «source $ZSH/oh-my-zsh.sh».
if grep -q "^plugins=(${PLUGINS})\$" "$ZSHRC"; then
    verde "La lista de plugins ya estaba puesta."
elif grep -qE '^plugins=\(.*\)[[:space:]]*$' "$ZSHRC"; then
    sed -i "s/^plugins=(.*)[[:space:]]*\$/plugins=(${PLUGINS})/" "$ZSHRC"
    verde "Lista de plugins actualizada."
elif grep -qE '^plugins=\(' "$ZSHRC"; then
    error "La línea «plugins=(...)» de ${ZSHRC} ocupa varios renglones."
    error "Déjala en uno solo y vuelve a ejecutar esto."
    exit 1
else
    error "No encuentro la línea «plugins=(...)» en ${ZSHRC}. No toco nada."
    exit 1
fi

# ---------------------------- El prompt ---------------------------
# El tema de Oh My Zsh y starship no pueden convivir: el tema se carga después
# de esta carpeta y pondría su PROMPT encima. Vaciando ZSH_THEME, Oh My Zsh no
# toca el prompt y lo pone starship desde terminal.zsh.
if grep -qE '^ZSH_THEME="[^"]*"$' "$ZSHRC"; then
    tema_actual="$(sed -n 's/^ZSH_THEME="\(.*\)"$/\1/p' "$ZSHRC")"
    if [[ -n "$tema_actual" ]]; then
        sed -i 's/^ZSH_THEME=".*"$/ZSH_THEME=""/' "$ZSHRC"
        verde "Tema de Oh My Zsh «${tema_actual}» apagado: el prompt lo pone starship."
    fi
else
    aviso "No encuentro la línea ZSH_THEME=\"...\"; si tenías un tema puesto, se"
    aviso "comerá el prompt de starship. Déjala en ZSH_THEME=\"\" a mano."
fi

mkdir -p "${HOME}/.config"
CONFIG_PROMPT="${HOME}/.config/starship.toml"
# Un starship.toml que no sea el nuestro se guarda antes de pisarlo, y solo la
# primera vez: la segunda, «el anterior» ya sería el nuestro.
if [[ -f "$CONFIG_PROMPT" ]] \
   && ! cmp -s "${ORIGEN}/starship.toml" "$CONFIG_PROMPT" \
   && [[ ! -f "${CONFIG_PROMPT}.anterior" ]]; then
    cp "$CONFIG_PROMPT" "${CONFIG_PROMPT}.anterior"
    aviso "Tu starship.toml de antes está en ${CONFIG_PROMPT}.anterior"
fi
install -m 644 "${ORIGEN}/starship.toml" "$CONFIG_PROMPT"
verde "Copiado starship.toml a ${CONFIG_PROMPT}"

# ------------------------- Ajustes propios ------------------------
mkdir -p "$CUSTOM"
# Al revés que en --solo-colores: si estaba puesta la parte suelta, se quita,
# porque terminal.zsh ya la trae dentro.
rm -f "${CUSTOM}/colores.zsh"
install -m 644 "${ORIGEN}/terminal.zsh" "${CUSTOM}/terminal.zsh"
verde "Copiado terminal.zsh a ${CUSTOM}/"

echo
verde "Listo. Abre una terminal nueva (o ejecuta: exec zsh) y prueba:"
cat <<'FIN'

    Ctrl+R      buscar en el historial escribiendo trozos sueltos
    Ctrl+T      insertar la ruta de un archivo en el comando que escribes
    Alt+C       entrar en una carpeta de las de abajo
    Esc Esc     repetir el último comando con sudo delante
    →           aceptar el comando que sale en gris
    z nombre    saltar a una carpeta que ya hayas visitado
    x archivo   descomprimir sea cual sea el formato

El prompt ahora dice la rama, lo que tardó el comando anterior si pasó de
medio segundo, y con qué código falló si falló. Al entrar por SSH sale
delante «usuario@equipo» en amarillo, para que no te confundas de máquina.

FIN

#!/usr/bin/env bash
#
# guardar-password.sh — Guarda una contraseña en el llavero de GNOME para los
# perfiles de Remmina que elijas, preguntándola una sola vez.
#
# La contraseña se teclea sin eco y viaja por una tubería hacia el ayudante,
# nunca como argumento: no aparece en `ps` ni en el historial del intérprete.
#
# Uso:
#   ./guardar-password.sh                      todos los perfiles de ~/.config/remmina
#   ./guardar-password.sh PERFIL [PERFIL...]   solo los indicados
#
# Ejemplos:
#   ./guardar-password.sh
#   ./guardar-password.sh ~/.config/remmina/OFICINA.remmina
#
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AYUDANTE="$AQUI/guardar-password.js"
PERFILES_DIR="${REMMINA_DIR:-$HOME/.config/remmina}"

verde() { printf '\033[1;32m%s\033[0m\n' "$*"; }
error() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }

if [[ ! -f "$AYUDANTE" ]]; then
    error "No se encontró $AYUDANTE"
    exit 1
fi

# Perfiles: los indicados, o todos los de la carpeta de Remmina.
if [[ $# -gt 0 ]]; then
    PERFILES=("$@")
else
    mapfile -t PERFILES < <(find "$PERFILES_DIR" -maxdepth 1 -type f -name '*.remmina' | sort)
fi

if [[ ${#PERFILES[@]} -eq 0 ]]; then
    error "No hay perfiles .remmina en $PERFILES_DIR (ejecuta antes vnc-a-remmina.sh)"
    exit 1
fi

echo "Se guardará la misma contraseña para ${#PERFILES[@]} perfil(es):"
for p in "${PERFILES[@]}"; do
    printf '  %s\n' "$(basename "$p" .remmina)"
done
echo

# -s: sin eco en pantalla.
read -rsp 'Contraseña: ' CLAVE
echo
read -rsp 'Repítela:   ' CLAVE2
echo

if [[ "$CLAVE" != "$CLAVE2" ]]; then
    error 'Las contraseñas no coinciden. No se ha guardado nada.'
    exit 1
fi

if [[ -z "$CLAVE" ]]; then
    error 'Contraseña vacía. No se ha guardado nada.'
    exit 1
fi

printf '%s' "$CLAVE" | gjs -m "$AYUDANTE" "${PERFILES[@]}"
unset CLAVE CLAVE2

echo
verde 'Listo. Remmina tomará la contraseña del llavero al conectar.'
echo 'Puedes revisarlas o borrarlas con la aplicación «Contraseñas y claves» (seahorse).'

#!/usr/bin/env bash
#
# ejecutar.sh — Pasa las pruebas de los módulos que no dependen del shell.
#
# Los parsers y las funciones de cálculo (el ~/.ssh/config, los archivos de
# VNC, las tareas de Markdown, las MAC, lo que contesta cada equipo) se pueden
# probar fuera de GNOME: solo usan Gio y GLib. Lo que pinta menús, no.
#
# Los módulos se montan en una carpeta temporal igual que los deja el
# instalador —los de comun/ junto a los de cada extensión—, porque en el
# repositorio un «import './asyncgio.js'» de una extensión no encuentra nada.
# Y cada archivo de pruebas se ejecuta con su propio HOME de usar y tirar:
# lo que escriba no puede tocar tu ~/.ssh ni tus notas.
#
# Uso:
#   ./pruebas/ejecutar.sh              todas
#   ./pruebas/ejecutar.sh hosts wol    solo esas (el nombre del archivo, sin .js)
#
# Devuelve 0 si todas pasan, y 1 si falla alguna.
#
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v gjs >/dev/null 2>&1; then
    printf '\033[1;33m%s\033[0m\n' "No está gjs: no se pueden pasar las pruebas." >&2
    exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# El mismo árbol que el repositorio, con cada extensión autocontenida.
cp -r "$RAIZ/comun" "$TMP/comun"
for ext in "$RAIZ"/*@jorgemg1414; do
    destino="$TMP/$(basename "$ext")"
    mkdir -p "$destino"
    cp "$RAIZ"/comun/*.js "$ext"/*.js "$destino/"
done
cp -r "$RAIZ/pruebas" "$TMP/pruebas"

if (( $# )); then
    archivos=()
    for nombre in "$@"; do
        archivos+=("$TMP/pruebas/${nombre%.js}.js")
    done
else
    archivos=()
    for archivo in "$TMP"/pruebas/*.js; do
        [[ "$(basename "$archivo")" == marco.js ]] || archivos+=("$archivo")
    done
fi

fallidos=0
for archivo in "${archivos[@]}"; do
    if [[ ! -f "$archivo" ]]; then
        printf '\033[1;31m%s\033[0m\n' "No existe la prueba $(basename "$archivo")" >&2
        fallidos=$((fallidos + 1))
        continue
    fi

    printf '\033[1m%s\033[0m\n' "$(basename "$archivo" .js)"
    casa="$(mktemp -d "$TMP/casa-XXXXXX")"
    # TMPDIR también: carpetaTemporal() crea sus carpetas ahí.
    if ! (cd "$TMP/pruebas" && HOME="$casa" TMPDIR="$casa" gjs -m "$archivo"); then
        fallidos=$((fallidos + 1))
    fi
done

echo
if (( fallidos )); then
    printf '\033[1;31m%s\033[0m\n' "Fallan ${fallidos} archivo(s) de pruebas." >&2
    exit 1
fi
printf '\033[1;32m%s\033[0m\n' "Todas las pruebas pasan."

#!/usr/bin/env bash
#
# comprobar.sh — Repasa el repositorio antes de instalar nada.
#
# No prueba que las extensiones funcionen —para eso hay que cargarlas en GNOME—,
# sino las cosas que se rompen al mover archivos de sitio, que es lo que más se
# hace aquí: que todo parsee, que cada import exista, que el instalador copie lo
# que se importa, que los esquemas compilen y que no haya clases de estilo
# huérfanas.
#
# Uso:
#   ./comprobar.sh
#
# Devuelve 0 si todo está en orden, y 1 si encuentra algo.
#
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$RAIZ"

verde()  { printf '\033[1;32m%s\033[0m\n' "$*"; }
aviso()  { printf '\033[1;33m%s\033[0m\n' "$*"; }
fallo()  { printf '\033[1;31m%s\033[0m\n' "$*" >&2; problemas=$((problemas + 1)); }

problemas=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ------------------------- 1. Sintaxis de JavaScript -------------------------
#
# node solo mira la sintaxis, que es justo lo que se quiere: los import de
# «gi://» y de «resource://» no existen fuera de GNOME. La extensión .mjs es lo
# que le dice que el archivo es un módulo.
if command -v node >/dev/null 2>&1; then
    while IFS= read -r archivo; do
        cp "$archivo" "$TMP/x.mjs"
        if ! salida=$(node --check "$TMP/x.mjs" 2>&1); then
            fallo "SINTAXIS  $archivo"
            printf '%s\n' "$salida" | head -3
        fi
    done < <(find comun herramientas ./*@jorgemg1414 -maxdepth 1 -name '*.js' 2>/dev/null)
else
    aviso "No está node: no se comprueba la sintaxis de los .js."
fi

# --------------------------- 2. Sintaxis de bash -----------------------------
while IFS= read -r archivo; do
    bash -n "$archivo" 2>/dev/null || fallo "SINTAXIS  $archivo"
done < <(find . -name '*.sh' -not -path './.git/*')

# ------------------- 3. Imports, y que el instalador los copie ---------------
for ext in ./*@jorgemg1414; do
    uuid="$(basename "$ext")"
    instalador="$ext/install.sh"
    [[ -f "$instalador" ]] || { fallo "FALTA     $uuid no tiene install.sh"; continue; }

    # Las dos listas del instalador, tal como las declara.
    propios=$(sed -n 's/^PROPIOS=(\(.*\))$/\1/p' "$instalador" | tr ' ' '\n')
    comunes=$(sed -n 's/^COMUNES=(\(.*\))$/\1/p' "$instalador" | tr ' ' '\n')

    for archivo in "$ext"/*.js; do
        while IFS= read -r imp; do
            [[ -n "$imp" ]] || continue
            if [[ -f "$ext/$imp" ]]; then
                grep -qx "$imp" <<<"$propios" ||
                    fallo "INSTALL   $uuid/$(basename "$archivo") importa «$imp», que no está en PROPIOS"
            elif [[ -f "comun/$imp" ]]; then
                grep -qx "$imp" <<<"$comunes" ||
                    fallo "INSTALL   $uuid/$(basename "$archivo") importa «$imp», que no está en COMUNES"
            else
                fallo "IMPORT    $uuid/$(basename "$archivo") importa «$imp», que no existe"
            fi
        done < <(grep -oP "from '\./\K[^']+" "$archivo" | sort -u)
    done

    # Lo que el instalador promete copiar tiene que existir.
    while IFS= read -r archivo; do
        [[ -n "$archivo" ]] || continue
        [[ -f "$ext/$archivo" ]] || fallo "FALTA     $uuid declara «$archivo» en PROPIOS y no está"
    done <<<"$propios"
    while IFS= read -r archivo; do
        [[ -n "$archivo" ]] || continue
        [[ -f "comun/$archivo" ]] || fallo "FALTA     $uuid declara «$archivo» en COMUNES y no está en comun/"
    done <<<"$comunes"
done

# ----------------------------- 4. Esquemas -----------------------------------
for esquemas in ./*@jorgemg1414/schemas; do
    salida=$(glib-compile-schemas --dry-run "$esquemas" 2>&1) ||
        fallo "ESQUEMA   $esquemas: $salida"
done

# ------------------------- 5. Clases de estilo comunes -----------------------
#
# Una clase «tb-» que se usa y no existe no pinta nada, y una que existe y no se
# usa es basura que se arrastra.
usadas=$(grep -ohE 'tb-[a-z-]+' ./*@jorgemg1414/*.js comun/*.js 2>/dev/null | sort -u)
definidas=$(grep -oE '^\.tb-[a-z-]+' comun/estilos.css 2>/dev/null | tr -d '.' | sort -u)

while IFS= read -r clase; do
    [[ -n "$clase" ]] || continue
    fallo "ESTILO    se usa «$clase» y no está en comun/estilos.css"
done < <(comm -23 <(echo "$usadas") <(echo "$definidas"))

while IFS= read -r clase; do
    [[ -n "$clase" ]] || continue
    aviso "ESTILO    «$clase» está definida en comun/estilos.css y no la usa nadie"
done < <(comm -13 <(echo "$usadas") <(echo "$definidas"))

# Quien use esas clases tiene que pedir la hoja común.
for ext in ./*@jorgemg1414; do
    grep -qhE "'tb-" "$ext"/*.js 2>/dev/null || continue
    grep -q '^ESTILOS_COMUNES=si$' "$ext/install.sh" ||
        fallo "ESTILO    $(basename "$ext") usa clases «tb-» y su install.sh no pone ESTILOS_COMUNES=si"
done

# ------------------------------- Resultado -----------------------------------
echo
if [[ $problemas -eq 0 ]]; then
    verde "Todo en orden."
else
    fallo "$problemas problema(s)."
    exit 1
fi

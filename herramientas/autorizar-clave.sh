#!/usr/bin/env bash
#
# autorizar-clave.sh — Autoriza tu clave pública en un equipo remoto para dejar
# de escribir la contraseña en cada conexión.
#
# Sirve tanto para Linux como para el OpenSSH de Windows, que guarda las claves
# en otro sitio y con otros permisos según si la cuenta es administradora:
#
#   Linux/BSD          ~/.ssh/authorized_keys                         (600)
#   Windows, usuario   %USERPROFILE%\.ssh\authorized_keys
#   Windows, admin     %ProgramData%\ssh\administrators_authorized_keys
#
# Ese último es el que se atraganta: sshd solo lo lee si la ACL deja
# únicamente a SYSTEM y a Administradores. Si los permisos no son exactos,
# ignora la clave sin decir nada y te sigue pidiendo la contraseña.
#
# Uso:
#   ./autorizar-clave.sh <destino> [más destinos...]
#   ./autorizar-clave.sh -i ~/.ssh/otra_clave.pub <destino>
#
# «destino» es lo mismo que le pasarías a ssh: un alias de ~/.ssh/config
# (los que salen en el menú de la barra) o usuario@host.
#
# La contraseña la pide ssh, nunca este script: no se lee, no se guarda, no se
# pasa por la línea de comandos y no aparece en «ps» ni en el historial. Se
# abre una sola conexión multiplexada por equipo, así que solo hay que
# teclearla una vez aunque el script haga varias cosas por dentro.
#
set -euo pipefail

# Colores discretos para los mensajes.
verde()  { printf '\033[1;32m%s\033[0m\n' "$*"; }
aviso()  { printf '\033[1;33m%s\033[0m\n' "$*"; }
error()  { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }
paso()   { printf '\033[1m%s\033[0m\n' "$*"; }

uso() {
    cat <<'FIN'
Uso: ./autorizar-clave.sh [-i CLAVE.pub] <destino> [más destinos...]

  -i, --identidad CLAVE.pub   Clave pública a autorizar.
                              Por omisión, la primera que haya en ~/.ssh.
  -h, --ayuda                 Esta ayuda.

Ejemplos:
  ./autorizar-clave.sh servidor
  ./autorizar-clave.sh oficina-norte oficina-sur
  ./autorizar-clave.sh -i ~/.ssh/trabajo.pub usuario@192.168.1.10
FIN
}

# ----------------------------- Argumentos -----------------------------
CLAVE=""
DESTINOS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        -i|--identidad)
            [[ $# -ge 2 ]] || { error "Falta la ruta después de $1"; exit 1; }
            CLAVE="$2"; shift 2 ;;
        -h|--ayuda|--help)
            uso; exit 0 ;;
        -*)
            error "Opción desconocida: $1"; uso; exit 1 ;;
        *)
            DESTINOS+=("$1"); shift ;;
    esac
done

if [[ ${#DESTINOS[@]} -eq 0 ]]; then
    uso
    exit 1
fi

# ------------------------------- Clave --------------------------------
if [[ -z "$CLAVE" ]]; then
    for candidata in "$HOME"/.ssh/id_ed25519.pub "$HOME"/.ssh/id_ecdsa.pub "$HOME"/.ssh/id_rsa.pub; do
        if [[ -f "$candidata" ]]; then
            CLAVE="$candidata"
            break
        fi
    done
fi

if [[ -z "$CLAVE" ]]; then
    error "No se encontró ninguna clave pública en ~/.ssh."
    echo "Crea una con:"
    echo "    ssh-keygen -t ed25519 -C \"\$USER@\$(hostname)\""
    exit 1
fi

[[ -f "$CLAVE" ]] || { error "No existe el archivo «$CLAVE»."; exit 1; }

# Salvaguarda: aquí solo viaja la mitad pública. La privada no sale de tu
# equipo ni por accidente.
if grep -q "PRIVATE KEY" "$CLAVE"; then
    error "«$CLAVE» es una clave PRIVADA."
    error "Se autoriza la pública, la que termina en .pub."
    exit 1
fi

if ! HUELLA=$(ssh-keygen -l -f "$CLAVE" 2>/dev/null); then
    error "«$CLAVE» no parece una clave pública válida."
    exit 1
fi

TEXTO_CLAVE=$(tr -d '\r\n' < "$CLAVE")

# Los scripts remotos entrecomillan la clave con comillas simples; una comilla
# dentro del comentario los rompería.
case "$TEXTO_CLAVE" in
    *"'"*)
        error "La clave lleva una comilla simple en su comentario."
        error "Cámbiale el comentario con:  ssh-keygen -c -C \"nuevo\" -f ${CLAVE%.pub}"
        exit 1 ;;
esac

command -v iconv >/dev/null || { error "Falta «iconv» (paquete libc-bin)."; exit 1; }

paso "Clave a autorizar:"
echo "  $CLAVE"
echo "  $HUELLA"
echo

# --------------------------- Scripts remotos ---------------------------

# Lo que se ejecuta en un equipo POSIX. La clave se añade solo si no estaba.
script_posix() {
    cat <<FIN
umask 077
mkdir -p "\$HOME/.ssh"
touch "\$HOME/.ssh/authorized_keys"
chmod 700 "\$HOME/.ssh"
chmod 600 "\$HOME/.ssh/authorized_keys"
if grep -qxF '$TEXTO_CLAVE' "\$HOME/.ssh/authorized_keys"; then
    echo "ESTADO=YA"
else
    printf '%s\n' '$TEXTO_CLAVE' >> "\$HOME/.ssh/authorized_keys"
    echo "ESTADO=NUEVA"
fi
echo "RUTA=\$HOME/.ssh/authorized_keys"
FIN
}

# Lo que se ejecuta en Windows, en PowerShell.
#
# Los permisos se dan por SID y no por nombre de grupo: «Administrators» se
# llama «Administradores» en un Windows en español, y icacls fallaría.
#   *S-1-5-32-544  Administradores (el grupo local)
#   *S-1-5-18      SYSTEM
script_windows() {
    local admin="$1"
    local destino_archivo permisos

    if [[ "$admin" == "si" ]]; then
        destino_archivo='$archivo = Join-Path $env:ProgramData "ssh\administrators_authorized_keys"'
        permisos="icacls.exe \$archivo /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F' | Out-Null"
    else
        destino_archivo='$archivo = Join-Path $env:USERPROFILE ".ssh\authorized_keys"'
        # Para una cuenta normal, solo ella y SYSTEM.
        permisos="\$sid = ([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
icacls.exe \$archivo /inheritance:r /grant (\"*{0}:F\" -f \$sid) /grant '*S-1-5-18:F' | Out-Null"
    fi

    cat <<FIN
\$ErrorActionPreference = 'Stop'
\$clave = '$TEXTO_CLAVE'
$destino_archivo
\$carpeta = Split-Path -Parent \$archivo
if (-not (Test-Path \$carpeta)) { New-Item -ItemType Directory -Path \$carpeta -Force | Out-Null }
if (-not (Test-Path \$archivo)) { New-Item -ItemType File -Path \$archivo -Force | Out-Null }
\$actual = @(Get-Content -Path \$archivo -ErrorAction SilentlyContinue)
if (\$actual -contains \$clave) {
    Write-Output 'ESTADO=YA'
} else {
    # ASCII a propósito: un BOM al principio del archivo deja ciega a sshd.
    Add-Content -Path \$archivo -Value \$clave -Encoding ascii
    Write-Output 'ESTADO=NUEVA'
}
$permisos
Write-Output ("RUTA=" + \$archivo)
FIN
}

# PowerShell admite el script en base64 UTF-16LE, que evita pelearse con el
# entrecomillado de cmd.exe: da igual cuál sea el shell por omisión del equipo.
codificar_ps() {
    iconv -f UTF-8 -t UTF-16LE | base64 -w0
}

# ------------------------------ Por equipo -----------------------------
autorizar() {
    local destino="$1"
    local dir_control ctl salida so ver admin resultado estado ruta

    paso "── $destino"

    dir_control=$(mktemp -d)
    ctl="$dir_control/cm"
    # Con la conexión multiplexada, la contraseña se teclea una sola vez y las
    # órdenes siguientes reutilizan esa sesión.
    if ! ssh -o ControlMaster=yes -o ControlPath="$ctl" -o ControlPersist=120 \
             -N -f "$destino"; then
        error "No se pudo conectar con «$destino»."
        rm -rf "$dir_control"
        return 1
    fi

    remoto() { ssh -o ControlPath="$ctl" "$destino" "$@"; }

    # ¿Qué sistema hay al otro lado? En Windows «uname» no existe, así que se
    # pregunta después por la versión con cmd.
    so=$(remoto 'uname -s' 2>/dev/null | tr -d '\r' | head -n1 || true)

    case "$so" in
        Linux|Darwin|SunOS|*BSD*)
            echo "  Sistema: $so"
            resultado=$(remoto "$(script_posix)")
            ;;
        *)
            ver=$(remoto 'cmd /c ver' 2>/dev/null | tr -d '\r' || true)
            if [[ "$ver" != *Windows* ]]; then
                error "  No se reconoce el sistema del equipo; no se toca nada."
                ssh -O exit -o ControlPath="$ctl" "$destino" 2>/dev/null || true
                rm -rf "$dir_control"
                return 1
            fi

            # El grupo se comprueba por SID, que no cambia con el idioma.
            if remoto 'whoami /groups | findstr /i S-1-5-32-544' >/dev/null 2>&1; then
                admin="si"
                echo "  Sistema: Windows (cuenta administradora)"
            else
                admin="no"
                echo "  Sistema: Windows"
            fi

            resultado=$(remoto "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $(script_windows "$admin" | codificar_ps)")
            ;;
    esac

    estado=$(printf '%s\n' "$resultado" | tr -d '\r' | sed -n 's/^ESTADO=//p')
    ruta=$(printf '%s\n' "$resultado" | tr -d '\r' | sed -n 's/^RUTA=//p')

    case "$estado" in
        NUEVA) echo "  Clave añadida en: $ruta" ;;
        YA)    echo "  La clave ya estaba en: $ruta" ;;
        *)     aviso "  Respuesta inesperada del equipo:"; printf '%s\n' "$resultado" ;;
    esac

    # Se cierra la sesión multiplexada para que la comprobación sea de verdad
    # una conexión nueva.
    ssh -O exit -o ControlPath="$ctl" "$destino" 2>/dev/null || true
    rm -rf "$dir_control"

    if ssh -o ControlPath=none -o BatchMode=yes -o PreferredAuthentications=publickey \
           -o ConnectTimeout=10 "$destino" true 2>/dev/null; then
        verde "  ✔ Entra con la clave, sin contraseña."
        return 0
    fi

    aviso "  La clave está puesta, pero entrar con ella todavía falla."
    echo  "  Para ver por qué:"
    echo  "     ssh -v -o PreferredAuthentications=publickey $destino true"
    echo  "  En Windows suele ser que sshd no relee los permisos hasta reiniciarse:"
    echo  "     Restart-Service sshd     (en PowerShell como administrador)"
    return 1
}

fallos=0
for destino in "${DESTINOS[@]}"; do
    autorizar "$destino" || fallos=$((fallos + 1))
    echo
done

if [[ $fallos -eq 0 ]]; then
    verde "Listo: ${#DESTINOS[@]} equipo(s) sin contraseña."
else
    aviso "Terminado con $fallos equipo(s) por revisar."
    exit 1
fi

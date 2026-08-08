#!/usr/bin/env bash
#
# instalar.sh — Que los parches de seguridad entren solos.
#
# Debian trae el temporizador «apt-daily» encendido de fábrica, pero ese solo
# refresca las listas de paquetes: no instala nada, nunca. El resultado es que
# un parche de seguridad se queda esperando hasta que te acuerdas de hacer
# «apt upgrade» a mano.
#
# Esto instala unattended-upgrades y lo deja atado en corto:
#
#   - Solo «trixie-security». Los cambios de versión normales los sigues
#     decidiendo tú, y los repositorios de terceros no se tocan.
#   - Sin reinicios automáticos, jamás.
#   - needrestart avisa de qué servicios siguen con la biblioteca vieja
#     cargada, pero no reinicia ninguno por su cuenta.
#
# Uso:
#   ./instalar.sh               configura y aplica lo que haya pendiente
#   ./instalar.sh --solo-ver    enseña qué haría, sin instalar nada
#   ./instalar.sh --desinstalar deja el sistema como estaba
#
set -euo pipefail

verde() { printf '\033[1;32m%s\033[0m\n' "$*"; }
aviso() { printf '\033[1;33m%s\033[0m\n' "$*"; }
error() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }

PERIODICO='/etc/apt/apt.conf.d/20auto-upgrades'
NUESTRO='/etc/apt/apt.conf.d/52parches-seguridad'
NEEDRESTART='/etc/needrestart/conf.d/50-solo-avisar.conf'

PAQUETES=(
    unattended-upgrades     # el que instala los parches sin que estés delante
    needrestart             # qué servicios siguen con la versión vieja en memoria
)

# --------------------------- Solo mirar ---------------------------
if [[ "${1:-}" == "--solo-ver" ]]; then
    if ! command -v unattended-upgrade >/dev/null 2>&1; then
        error "unattended-upgrades no está instalado todavía; no hay nada que simular."
        exit 1
    fi
    verde "Lo que haría ahora mismo, sin tocar nada:"
    sudo unattended-upgrade --dry-run --verbose
    exit 0
fi

# ------------------------- Desinstalación -------------------------
if [[ "${1:-}" == "--desinstalar" ]]; then
    # Solo se quitan los archivos que pone este script. El 50unattended-upgrades
    # que trae el paquete no se toca, porque no es nuestro.
    sudo rm -f "$PERIODICO" "$NUESTRO" "$NEEDRESTART"
    verde "Quitada la configuración. Los parches vuelven a esperarte a ti."
    aviso "Los paquetes siguen instalados. Para quitarlos también:"
    aviso "    sudo apt purge ${PAQUETES[*]}"
    exit 0
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
else
    verde "Los paquetes ya estaban instalados."
fi

# ------------------------ Cada cuánto se mira ---------------------
verde "Escribiendo ${PERIODICO}"
sudo tee "$PERIODICO" >/dev/null <<'FIN'
// Escrito por taskbar-debian/actualizaciones/instalar.sh
//
// Los cuatro números que gobiernan el temporizador apt-daily. Van en días:
// «1» es «cada vez que el temporizador se dispara», que es dos veces al día.

APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::Unattended-Upgrade "1";

// Vaciar de vez en cuando los .deb ya instalados que quedan en la caché.
APT::Periodic::AutocleanInterval "7";
FIN

# ----------------------- Qué se instala solo ----------------------
verde "Escribiendo ${NUESTRO}"
sudo tee "$NUESTRO" >/dev/null <<'FIN'
// Escrito por taskbar-debian/actualizaciones/instalar.sh
//
// Va en un archivo aparte, y con un número más alto que el 50 del paquete,
// para que una actualización de unattended-upgrades no se lleve esto por
// delante: el 50 es suyo y lo puede reescribir cuando quiera.

// Solo los parches de seguridad, y solo los de Debian.
//
// La línea vacía de arriba no sobra: en un bloque con el mismo nombre, APT
// AÑADE a la lista en vez de sustituirla. Sin vaciarla primero, la lista de
// fábrica —que incluye las actualizaciones normales de la estable— seguiría
// dentro y esto no serviría de nada.
//
// Como el patrón exige origin=Debian, los repositorios de terceros que tengas
// (Steam, Spotify, Claude…) quedan fuera por construcción, sin nombrarlos.
Unattended-Upgrade::Origins-Pattern "";
Unattended-Upgrade::Origins-Pattern {
    "origin=Debian,codename=${distro_codename}-security,label=Debian-Security";
};

// Nunca, bajo ningún concepto, reiniciar el equipo por su cuenta.
Unattended-Upgrade::Automatic-Reboot "false";

// Que no se acumulen núcleos viejos ni dependencias que ya no usa nadie.
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-New-Unused-Dependencies "true";

// Deja rastro en el journal, además de en /var/log/unattended-upgrades/.
Unattended-Upgrade::SyslogEnable "true";
FIN

# --------------------------- needrestart --------------------------
# Actualizar libheif no cambia el libheif que Nautilus ya tiene cargado en
# memoria: hasta que el proceso se reinicie, sigue usando el de antes. Esto
# hace que te lo digan; reiniciar lo decides tú.
verde "Escribiendo ${NEEDRESTART}"
sudo mkdir -p "$(dirname "$NEEDRESTART")"
sudo tee "$NEEDRESTART" >/dev/null <<'FIN'
# Escrito por taskbar-debian/actualizaciones/instalar.sh
#
# 'l' = list: enumera los servicios que siguen con la biblioteca vieja y se
# calla. Con 'a' los reiniciaría solo, y un reinicio de servicio a media
# mañana no es algo que deba decidir un temporizador.
$nrconf{restart} = 'l';
FIN

# --------------------------- Comprobación -------------------------
verde "Encendiendo los temporizadores"
sudo systemctl enable --now apt-daily.timer apt-daily-upgrade.timer >/dev/null 2>&1 || true

echo
verde "De dónde acepta paquetes (debería salir solo trixie-security):"
apt-config dump 2>/dev/null | grep -i 'Unattended-Upgrade::Origins-Pattern::' || \
    aviso "No se pudo leer el patrón. Míralo con: apt-config dump | grep -i origins-pattern"

# ------------------------ Aplicar lo pendiente --------------------
echo
verde "Aplicando los parches de seguridad que hubiera esperando"
sudo unattended-upgrade --verbose

echo
verde "Listo."
cat <<'FIN'

A partir de ahora los parches de seguridad entran solos, dos veces al día.

    ./instalar.sh --solo-ver      qué haría ahora mismo, sin tocar nada
    systemctl list-timers apt-daily-upgrade.timer     cuándo toca la próxima
    less /var/log/unattended-upgrades/unattended-upgrades.log    qué ha hecho

Si needrestart ha nombrado algún servicio, sigue con la biblioteca vieja
cargada hasta que lo reinicies tú. Para los del sistema:

    sudo systemctl restart <servicio>

Y si el que sale es gnome-shell o tu sesión, se arregla cerrando sesión.

FIN

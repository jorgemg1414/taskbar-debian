#!/usr/bin/env bash
#
# despertar.sh — Manda el paquete mágico de Wake-on-LAN desde cualquier Linux.
#
# La extensión de la barra solo sirve en GNOME, y desde un equipo no puedes
# encenderte a ti mismo: este script es para mandar el paquete desde otra
# máquina cualquiera, sin instalar nada (usa Python 3, que ya viene en Debian).
#
# Uso:
#   ./despertar.sh aa:bb:cc:dd:ee:ff
#   ./despertar.sh aa:bb:cc:dd:ee:ff 192.168.10.255
#   ./despertar.sh aa:bb:cc:dd:ee:ff 192.168.10.255 9
#
set -euo pipefail

MAC="${1:-}"
DESTINO="${2:-255.255.255.255}"
PUERTO="${3:-9}"

if [[ -z "$MAC" ]]; then
    echo "Uso: $0 <MAC> [difusión] [puerto]" >&2
    echo "Ejemplo: $0 aa:bb:cc:dd:ee:ff 192.168.10.255" >&2
    exit 1
fi

python3 - "$MAC" "$DESTINO" "$PUERTO" <<'PY'
import re, socket, sys

mac_cruda, destino, puerto = sys.argv[1], sys.argv[2], int(sys.argv[3])

limpia = re.sub(r'[^0-9a-fA-F]', '', mac_cruda)
if len(limpia) != 12:
    sys.exit(f"MAC no válida: «{mac_cruda}»")

mac = bytes.fromhex(limpia)
# Seis 0xFF y la MAC repetida dieciséis veces: 102 bytes en total.
paquete = b'\xff' * 6 + mac * 16

s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
# Sin esto el núcleo rechaza el envío a una dirección de difusión.
s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
try:
    s.sendto(paquete, (destino, puerto))
finally:
    s.close()

bonita = ':'.join(limpia[i:i+2] for i in range(0, 12, 2)).lower()
print(f"Paquete enviado a {bonita} vía {destino}:{puerto}")
print("El protocolo no tiene respuesta: esto confirma que salió, no que arrancara.")
PY

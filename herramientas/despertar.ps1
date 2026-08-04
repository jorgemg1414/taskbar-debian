# despertar.ps1 — Manda el paquete mágico de Wake-on-LAN desde Windows.
#
# El equivalente de despertar.sh para cuando el mensajero es una máquina
# Windows: no necesita instalar nada, PowerShell trae todo lo que hace falta.
#
# Uso:
#   .\despertar.ps1 -Mac AA:BB:CC:DD:EE:FF
#   .\despertar.ps1 -Mac AA:BB:CC:DD:EE:FF -Destino 192.168.10.255
#
# Si tu equipo tiene máscara /16 o mayor, ojo: la difusión de tu subred no es
# «x.x.x.255». Con 255.255.255.255 sale siempre por el cable local y funciona
# sin tener que calcularla.

param(
    [Parameter(Mandatory = $true)]
    [string]$Mac,

    [string]$Destino = "255.255.255.255",

    [int]$Puerto = 9
)

# Se aceptan AA:BB:.., AA-BB-.. y AABBCC...
$limpia = ($Mac -replace '[^0-9A-Fa-f]', '')
if ($limpia.Length -ne 12) {
    Write-Error "MAC no valida: «$Mac»"
    exit 1
}

$bytesMac = for ($i = 0; $i -lt 12; $i += 2) {
    [byte]::Parse($limpia.Substring($i, 2), 'HexNumber')
}

# Seis 0xFF y la MAC repetida dieciseis veces: 102 bytes en total.
$paquete = @()
1..6 | ForEach-Object { $paquete += [byte]255 }
1..16 | ForEach-Object { $bytesMac | ForEach-Object { $paquete += $_ } }
$paquete = [byte[]]$paquete

$udp = New-Object System.Net.Sockets.UdpClient
try {
    # Sin esto Windows rechaza el envio a una direccion de difusion.
    $udp.EnableBroadcast = $true
    $udp.Send($paquete, $paquete.Length, $Destino, $Puerto) | Out-Null
} finally {
    $udp.Close()
}

$bonita = (($limpia -split '(..)' | Where-Object { $_ }) -join ':').ToLower()
Write-Host "Paquete enviado a $bonita via ${Destino}:${Puerto} ($($paquete.Length) bytes)"
Write-Host "El protocolo no tiene respuesta: esto confirma que salio, no que arrancara."

@echo off
REM ---------------------------------------------------------------------------
REM  encender-pc.bat - Enciende un equipo por Wake-on-LAN con un doble clic.
REM
REM  Pensado para dejarlo en el Escritorio de la maquina Windows que se queda
REM  encendida y hace de mensajero. No instala nada: usa el PowerShell que ya
REM  trae Windows.
REM
REM  CONFIGURACION: cambia las cuatro lineas de abajo y listo.
REM
REM  DESTINO: a donde se manda el paquete. El equipo apagado no tiene IP, asi
REM  que va a una direccion de difusion, no a la suya. 255.255.255.255 sale
REM  siempre por el cable local y funciona sin importar la mascara de red, por
REM  eso es la opcion por defecto.
REM
REM  NOTA: la orden de PowerShell va en una sola linea a proposito. Partirla
REM  con ^ no funciona dentro de comillas, y por lo mismo se evita cualquier ^
REM  en la propia orden (de ahi los .Replace en vez de una expresion regular).
REM ---------------------------------------------------------------------------

set NOMBRE=Mi PC
set MAC=AA:BB:CC:DD:EE:FF
set DESTINO=255.255.255.255
set PUERTO=9

REM ---------------------------------------------------------------------------

title Encender %NOMBRE%
echo.
echo   Encendiendo %NOMBRE% (%MAC%)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$h = '%MAC%'.Replace(':','').Replace('-','').Replace('.',''); if ($h.Length -ne 12) { Write-Host '  MAC no valida' -ForegroundColor Red; exit 1 }; $b = @(); for ($i=0; $i -lt 12; $i+=2) { $b += [byte]::Parse($h.Substring($i,2),'HexNumber') }; $m = @(); 1..6 | ForEach-Object { $m += [byte]255 }; 1..16 | ForEach-Object { $m += $b }; $u = New-Object System.Net.Sockets.UdpClient; $u.EnableBroadcast = $true; try { $u.Send([byte[]]$m, $m.Count, '%DESTINO%', %PUERTO%) | Out-Null; Write-Host ('  Paquete enviado: ' + $m.Count + ' bytes a %DESTINO%:%PUERTO%') -ForegroundColor Green } catch { Write-Host ('  Fallo: ' + $_.Exception.Message) -ForegroundColor Red } finally { $u.Close() }"

echo.
echo   El protocolo no responde: esto confirma que el paquete salio,
echo   no que el equipo haya arrancado. Dale unos segundos.
echo.
timeout /t 6 >nul

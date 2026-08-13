@echo off
setlocal
REM ---------------------------------------------------------------------------
REM  encender-pc.bat - Enciende un equipo por Wake-on-LAN con un doble clic.
REM
REM  Pensado para dejarlo en el Escritorio de la maquina Windows que se queda
REM  encendida y hace de mensajero. No instala nada: usa el PowerShell que ya
REM  trae Windows.
REM
REM  CONFIGURACION: no hace falta tocar nada. La primera vez pregunta la MAC y
REM  se ofrece a guardarla en un mac.txt junto a este archivo; a partir de ahi
REM  vuelve a ser un doble clic. Si prefieres dejarla escrita, rellena la linea
REM  MAC= de abajo y no volvera a preguntar. Se deja vacia a proposito para que
REM  este archivo pueda vivir en un repositorio publico sin filtrar la MAC de
REM  nadie: mac.txt es lo unico personal y va en el .gitignore.
REM
REM  DESTINO: a donde se manda el paquete. El equipo apagado no tiene IP, asi
REM  que va a una direccion de difusion, no a la suya. 255.255.255.255 sale
REM  siempre por el cable local y funciona sin importar la mascara de red, por
REM  eso es la opcion por defecto.
REM
REM  NOTA: la orden de PowerShell va en una sola linea a proposito. Partirla
REM  con ^ no funciona dentro de comillas, y por lo mismo se evita cualquier ^
REM  en la propia orden (de ahi los .Replace en vez de una expresion regular).
REM  La MAC se le pasa por el entorno ($env:MAC) y no incrustada en el texto:
REM  al venir de lo que teclea el usuario, cualquier comilla suelta romperia la
REM  orden.
REM ---------------------------------------------------------------------------

set NOMBRE=Mi PC
set MAC=
set DESTINO=255.255.255.255
set PUERTO=9

REM ---------------------------------------------------------------------------

set "CFG=%~dp0mac.txt"

if defined MAC goto enviar
if not exist "%CFG%" goto preguntar
set /p MAC=<"%CFG%"
if defined MAC goto enviar

:preguntar
title Encender un equipo por Wake-on-LAN
echo.
echo   No hay ninguna MAC guardada todavia.
echo.
set /p "MAC=  MAC del equipo a encender (AA:BB:CC:DD:EE:FF): "
if not defined MAC goto sinmac
set "GUARDAR="
set /p "GUARDAR=  Guardarla para no volver a teclearla? (s/n): "
if /i not "%GUARDAR%"=="s" goto enviar
REM  El redirector va delante a proposito: "echo %MAC%>archivo" se rompe si la
REM  MAC acaba en un digito, porque cmd lee ese digito como numero de flujo.
>"%CFG%" echo %MAC%
echo   Guardada en mac.txt, junto a este archivo.

:enviar
title Encender %NOMBRE%
echo.
echo   Encendiendo %NOMBRE% (%MAC%)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$h = $env:MAC.Trim().Replace(':','').Replace('-','').Replace('.',''); if ($h.Length -ne 12) { Write-Host '  MAC no valida' -ForegroundColor Red; exit 1 }; $u = New-Object System.Net.Sockets.UdpClient; $u.EnableBroadcast = $true; try { $b = @(); for ($i=0; $i -lt 12; $i+=2) { $b += [byte]::Parse($h.Substring($i,2),'HexNumber') }; $m = @(); 1..6 | ForEach-Object { $m += [byte]255 }; 1..16 | ForEach-Object { $m += $b }; $u.Send([byte[]]$m, $m.Count, '%DESTINO%', %PUERTO%) | Out-Null; Write-Host ('  Paquete enviado: ' + $m.Count + ' bytes a %DESTINO%:%PUERTO%') -ForegroundColor Green } catch { Write-Host ('  Fallo: ' + $_.Exception.Message) -ForegroundColor Red } finally { $u.Close() }"

echo.
echo   El protocolo no responde: esto confirma que el paquete salio,
echo   no que el equipo haya arrancado. Dale unos segundos.
echo.
echo   Si la MAC estaba mal, borra mac.txt y vuelve a ejecutar.
echo.
timeout /t 6 >nul
goto :eof

:sinmac
echo.
echo   No escribiste ninguna MAC. No se envio nada.
echo.
timeout /t 6 >nul

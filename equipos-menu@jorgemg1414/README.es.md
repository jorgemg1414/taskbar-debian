# Equipos

*[Read this in English](README.md)*

Indicador en la barra superior que dice **cómo está** cada equipo de tu
`~/.ssh/config`, y desde el que se puede **apagar, reiniciar o suspender** sin
abrir una terminal.

Es el paso siguiente al punto verde de los otros menús de este repositorio:
aquel dice que el puerto 22 acepta conexiones; este entra y pregunta.

```
● equipo-taller     ↑ 14 d · RAM 41% · / 78% · 12 act.
● servidor-copias   ↑ 96 d · RAM 12% · / 94%
● oficina-norte     la clave no está autorizada en el equipo
● portatil          sin respuesta
```

---

## Qué muestra

De cada equipo, cuando responde:

| Dato | De dónde sale en Linux | En Windows |
|---|---|---|
| Tiempo encendido | `/proc/uptime` | `Win32_OperatingSystem.LastBootUpTime` |
| Carga media | `/proc/loadavg` | uso de CPU (`Win32_Processor`) |
| Memoria usada | `/proc/meminfo` | `Win32_OperatingSystem` |
| Disco usado de `/` (o `C:`) | `df -P /` | `Win32_LogicalDisk` |
| Actualizaciones pendientes | `apt-get -s upgrade` | agente de Windows Update |

El **punto** de la izquierda es otra cosa distinta y va por su cuenta: sale de
abrir el puerto 22, que tarda milisegundos, mientras que la consulta completa
tarda segundos. Así se ve enseguida quién está encendido, y el detalle llega
después.

Cuando algo falla, en vez del resumen sale el motivo: que la clave no está
autorizada, que no contesta, que el nombre no se resuelve… Nunca se enseñan
datos viejos de un equipo que ha dejado de contestar.

---

## Cómo pregunta

Ejecuta **`ssh <alias>`**, igual que escribirías tú en la terminal, de forma que
es el propio ssh quien aplica el usuario, el puerto, la clave y el `ProxyJump`
que tengas en la configuración. La extensión no reimplementa nada de eso.

Tres decisiones que conviene conocer:

- **`BatchMode=yes`: nunca se pide una contraseña.** Si la clave no está
  autorizada en el equipo, la consulta falla y lo dice, que es justo lo que hay
  que arreglar —con
  [`herramientas/autorizar-clave.sh`](../herramientas/autorizar-clave.sh)—. Una
  extensión del shell no es sitio para un diálogo de contraseña.
- **`ControlMaster`: una sola conexión por equipo.** La primera consulta paga el
  saludo completo de SSH; las siguientes viajan por el mismo túnel, que sigue
  vivo dos minutos. Refrescar seis equipos cada minuto no abre seis conexiones
  cada minuto.
- **Con el menú cerrado no se pregunta nada.** Ni sondeos, ni consultas, ni
  conexiones abiertas.

El comando remoto viaja de una sola pieza y sin comillas que se puedan escapar:
en Linux va con `sh -c` y lo entrecomilla GLib; en Windows va con
`powershell -EncodedCommand`, que lo recibe en base64 y así no lo toca `cmd`.

### Equipos Windows

El sistema de cada equipo se averigua solo la primera vez, preguntando
`uname -s || ver`: en Linux contesta `uname` y en Windows contesta `ver`.

Eso funciona con el OpenSSH de Windows tal como viene, que da órdenes a través de
`cmd`. Si le has cambiado el intérprete por omisión a PowerShell, la pregunta no
se entiende y hay que decírselo a mano con un comentario en su bloque:

```
# Sistema: windows
Host pc-oficina
    HostName 192.168.10.50
    User usuario
```

---

## Apagar, reiniciar y suspender

Están en el **clic derecho** de cada equipo, no en el clic normal, y piden
confirmación en el propio menú. Son las únicas acciones de todo el repositorio
que no se pueden deshacer desde la barra de tareas.

El clic normal, en cambio, no hace nada irreversible: vuelve a preguntar.

Las órdenes son configurables porque no hay una que valga para todos:

| | Linux | Windows |
|---|---|---|
| Apagar | `systemctl poweroff` | `shutdown /s /t 0` |
| Reiniciar | `systemctl reboot` | `shutdown /r /t 0` |
| Suspender | `systemctl suspend` | `rundll32.exe powrprof.dll,SetSuspendState 0,1,0` |

### «Interactive authentication required»

Es el fallo con el que se topa casi todo el mundo, y no es un fallo de la
extensión: **logind no deja que una sesión SSH apague la máquina**. Para él, una
sesión remota está «inactiva» —no estás delante del equipo— y para eso exige
autenticación de administrador, que por SSH no hay forma de dar.

Hay dos maneras de autorizarlo en **el equipo que quieres apagar**. Cualquiera
de las dos, no las dos.

**1. Con una regla de polkit**, que es lo más limpio: se autoriza la acción, no
un comando. En `/etc/polkit-1/rules.d/49-apagado-remoto.rules`:

```javascript
// Deja apagar, reiniciar y suspender a los miembros del grupo sudo, también
// desde una sesión SSH.
polkit.addRule(function (action, subject) {
    var acciones = [
        "org.freedesktop.login1.power-off",
        "org.freedesktop.login1.power-off-multiple-sessions",
        "org.freedesktop.login1.reboot",
        "org.freedesktop.login1.reboot-multiple-sessions",
        "org.freedesktop.login1.suspend",
        "org.freedesktop.login1.suspend-multiple-sessions",
    ];
    if (acciones.indexOf(action.id) >= 0 && subject.isInGroup("sudo"))
        return polkit.Result.YES;
});
```

Las variantes `-multiple-sessions` son las que se consultan cuando hay más
usuarios con sesión abierta, que es justo el caso en el que te vas a encontrar.

**2. Con sudo**, si prefieres no tocar polkit. En un archivo de
`/etc/sudoers.d/` (créalo con `visudo -f`):

```
usuario ALL=(root) NOPASSWD: /usr/bin/systemctl poweroff, /usr/bin/systemctl reboot, /usr/bin/systemctl suspend
```

Y en las preferencias de la extensión, pon las órdenes con `sudo -n` delante:
`sudo -n systemctl poweroff`. El `-n` es importante: sin él, sudo se quedaría
esperando una contraseña que nadie va a escribir.

> Autorizar esto significa que **cualquiera que pueda entrar por SSH con esa
> cuenta puede apagar el equipo**. Es exactamente lo que estás pidiendo, pero
> conviene decirlo en voz alta.

### En Windows

`shutdown` necesita el privilegio de apagar el equipo. Con una cuenta de
administrador funciona tal cual; con una cuenta normal puede contestar «Acceso
denegado», y entonces hay que usar una cuenta de administrador o concederle ese
privilegio.

La orden de suspender **hiberna en vez de suspender** si el equipo tiene la
hibernación activada. Es cosa de `SetSuspendState`, no de aquí; se desactiva con
`powercfg /hibernate off`.

### Cuando la conexión se corta

Un equipo que se apaga corta la conexión SSH mientras la está atendiendo, así
que `ssh` suele terminar con error aunque todo haya ido bien. Los errores de
«conexión cerrada por el otro extremo» se cuentan como éxito, que es lo que son:
el equipo obedeciendo.

Después de una orden de energía, el equipo se marca en amarillo y se vuelve a
mirar a los quince segundos, para que el punto diga la verdad y no lo que había
antes.

---

## Ajustes

Desde el menú → **Ajustes**, o con `gnome-extensions prefs equipos-menu@jorgemg1414`.

| Ajuste | Por omisión | Descripción |
|---|---|---|
| Archivo de configuración | `~/.ssh/config` | De donde salen los equipos, `Include` incluidos |
| Refresco con el menú abierto | 60 s | Entre consultas mientras miras el menú |
| Contar las actualizaciones | sí | Añade el recuento a la consulta; tarda su segundo por equipo |
| Avisar del disco a partir de | 90 % | Porcentaje con el que la cifra se pinta en rojo |
| Espera al conectar | 5 s | `ConnectTimeout` de ssh |
| Reaprovechar la conexión | sí | `ControlMaster`: una sola conexión SSH por equipo |
| Vida de la conexión compartida | 120 s | `ControlPersist` |
| Comprobar disponibilidad | sí | El punto verde o rojo, sondeando el puerto |
| Tiempo de espera del sondeo | 2 s | Antes de dar un equipo por caído |
| Contador en el panel | sí | Cuántos equipos no responden, junto al icono |
| Icono del panel | `utilities-system-monitor-symbolic` | Cualquier icono simbólico del tema |
| Pedir confirmación | sí | Antes de apagar, reiniciar o suspender |
| Órdenes de energía | ver arriba | Tres para Linux y tres para Windows |

Los equipos se agrupan con los mismos comentarios `# Grupo: NOMBRE` que usa el
[menú de SSH](../ssh-menu@jorgemg1414/), porque leen el mismo archivo.

---

## Requisitos

- GNOME Shell 48
- `openssh-client` en tu equipo, y tu clave autorizada en cada equipo remoto
- En los equipos Linux: nada que instalar, todo sale de `/proc` y de `df`
- En los equipos Windows: OpenSSH Server, que trae el propio Windows

```bash
sudo apt install openssh-client
```

---

## Instalación

```bash
cd equipos-menu@jorgemg1414 && ./install.sh --enable
```

Después hay que recargar GNOME Shell: en Wayland, cerrar sesión y volver a
entrar; en X11, `Alt+F2`, `r` y Enter.

Para desinstalar:

```bash
./install.sh --uninstall
```

---

## Depuración

Lo primero, comprobar a mano lo mismo que hace la extensión. Si esto contesta,
el menú también:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=5 equipo-taller 'uname -s; cat /proc/uptime'
```

Si pide contraseña o dice «Permission denied», la clave no está autorizada:

```bash
cd herramientas && ./autorizar-clave.sh equipo-taller
```

Ver las conexiones compartidas que hay vivas ahora mismo:

```bash
ls /run/user/$(id -u)/equipos-menu-*
```

Errores de la extensión:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

---

## Estructura

```
equipos-menu@jorgemg1414/
├── extension.js       Indicador, menú, acciones de energía y limpieza en disable()
├── vitales.js         Consulta por SSH, guiones remotos, parseo y formato
├── prefs.js           Ventana de preferencias (libadwaita)
├── stylesheet.css     Estilos del menú
├── schemas/           Esquema de GSettings
└── install.sh         Instalador
```

Más los módulos compartidos que `install.sh` copia de [`comun/`](../comun/):
`hosts.js` (lectura de `~/.ssh/config`), `checker.js` (sondeo de puertos) y
`asyncgio.js` (envoltorios de `Promise` sobre las llamadas de Gio).

### Limpieza en `disable()`

GNOME exige que una extensión no deje nada vivo al desactivarse. Aquí se sueltan
los temporizadores (refresco, recarga diferida y la espera de quince segundos
tras apagar), los `Gio.Cancellable` de las consultas y de las acciones, los
`Gio.FileMonitor` de los archivos de configuración y todas las señales
conectadas a los ajustes y al menú.

Las conexiones compartidas de `ControlMaster` sobreviven a `disable()` a
propósito: son del sistema, no de la extensión, y se cierran solas al cumplirse
su `ControlPersist`.

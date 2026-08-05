# SSH Menu

*[Read this in English](README.md)*

Indicador en la barra superior con los equipos de tu `~/.ssh/config`. Cada
equipo tiene en su fila las tres formas de entrar: consola, archivos en ventana
y archivos por línea de comandos.

---

## Las tres formas de entrar

```
 ●  norte         usuario@10.20.0.5    12 ms   [📁] [⇅]
 └─ clic ─ ssh en la terminal            │    └─ sftp en la terminal (get, put)
                                         └─ la carpeta en el gestor de archivos
```

| Acción | Cómo | Qué lanza |
|---|---|---|
| Sesión SSH | Clic en la fila, o Intro en el buscador | `ssh <alias>` en la terminal |
| Carpeta remota | Botón 📁, Ctrl+clic, o Ctrl+Intro | La URL `sftp://…` en el gestor de archivos |
| Transferir por consola | Botón ⇅, Mayús+clic, o Mayús+Intro | `sftp <alias>` en la terminal |
| Acciones del equipo | Clic derecho | Copiar, comprobar, editar su bloque |

Las tres usan el **alias**, nunca `usuario@host`: así son `ssh` y `sftp` quienes
aplican el usuario, el puerto, la clave y el `ProxyJump` de tu configuración. La
extensión no la reimplementa.

Los dos botones se pueden ocultar por separado en los ajustes; los atajos de
teclado siguen funcionando aunque no se vean.

---

## Qué hace

- **Lee tu configuración tal cual está.** Cada bloque `Host` de `~/.ssh/config`
  es una entrada del menú. Se siguen las directivas `Include`, así que si tienes
  la configuración partida en varios archivos también salen.
- **SFTP de las dos maneras.** El botón de la carpeta abre `sftp://…` en el
  gestor de archivos, para arrastrar y soltar; el de las flechas abre `sftp
  <alias>` en la terminal, para `get`, `put`, `ls` y `cd`. Quien monta el modo
  gráfico es GVfs y quien pide la contraseña o la frase de la clave es el gestor
  de archivos: **la extensión no toca credenciales**.
- **Carpetas montadas al principio del menú.** Las conexiones SFTP siguen vivas
  aunque cierres la ventana de Archivos; el menú las lista y las desmonta con un
  clic en el botón de expulsar.
- **Estado de cada equipo.** Un punto verde o rojo indica si el puerto de SSH
  responde, con el tiempo de respuesta al lado. Se comprueba de forma asíncrona
  con `Gio.SocketClient`, ocho a la vez como mucho, y solo mientras el menú está
  abierto: con el menú cerrado no se toca la red, salvo que actives las
  comprobaciones en segundo plano.
- **Contador de caídos en el panel**, para no tener que abrir el menú a mirar.
- **Buscador.** Con muchos equipos aparece un campo de filtro: escribe parte del
  alias, del host o del usuario, ↓/↑ recorren los resultados e Intro abre la
  sesión (con Ctrl o Mayús, las otras dos formas de entrar).
- **Clic derecho en un equipo** para sus propias acciones: copiar `ssh <alias>`,
  comprobarlo ahora, abrir en el editor el archivo donde está definido y, si no
  responde, **encenderlo**.
- **Se actualiza sola.** Los archivos de configuración se vigilan con
  `Gio.FileMonitor`: al añadir o editar un bloque el menú cambia al momento, sin
  recargar el shell.

---

## Cómo se agrupan los equipos

Igual que el menú de VNC agrupa por subcarpetas, aquí se agrupa con comentarios.
Una línea `# Grupo: NOMBRE` marca todos los bloques que vienen detrás, hasta el
siguiente comentario de grupo:

```sshconfig
# Grupo: SUCURSALES

Host norte
    HostName 10.20.0.5
    User usuario

Host sur
    HostName 10.30.0.5
    User usuario

# Grupo: SERVIDORES

Host copias
    HostName copias.interno
    User root
```

Es un comentario normal: `ssh` lo ignora, así que no rompe nada.

Si tienes la configuración partida con `Include`, los equipos de cada archivo
incluido se agrupan por el nombre del archivo sin extensión (`clientes.conf` →
grupo *clientes*), salvo que el propio archivo traiga sus líneas de grupo.

---

## Qué se lee de cada bloque

| Directiva | Para qué se usa |
|---|---|
| `Host` | El alias: es el nombre que ves y lo que se le pasa a `ssh` |
| `HostName` | El host real, para comprobar la disponibilidad y montar el SFTP |
| `Port` | Puerto de la comprobación y del SFTP; se muestra si no es el 22 |
| `User` | Usuario que se muestra y que va en la URL de SFTP |
| `ProxyJump` | Marca el equipo como «a través de otro» y se salta su comprobación |

Los patrones con comodines no son equipos concretos, así que no salen en el
menú: `Host *` se usa como valores por omisión de los demás (típicamente `User`
y `Port`) y el resto (`Host *.ejemplo.net`, `Host !algo`) se descarta. Los
bloques `Match` se ignoran enteros, porque son condicionales.

Ninguna clave de credenciales se lee: la extensión no abre `IdentityFile`, ni
habla con el agente, ni guarda contraseñas en ningún sitio.

---

## Equipos detrás de un salto

Un equipo con `ProxyJump` no acepta conexión directa desde tu máquina, así que
comprobar su puerto diría que está caído aunque funcione perfectamente. Por eso
esos equipos **no se comprueban**: el punto se queda gris y a la derecha del
alias aparece `⇢ <salto>` para recordarte por dónde va.

La sesión de terminal sí funciona con normalidad, porque la abre `ssh` con tu
configuración. El SFTP puede no montar: GVfs lanza su propio `ssh` contra el
host real, sin pasar por el salto. Si lo necesitas, lo habitual es dejar el
túnel montado aparte:

```bash
ssh -f -N -L 2222:interno:22 salto
```

y añadir un bloque `Host interno-tunel` que apunte a `localhost` puerto `2222`.

---

## Encender un equipo caído

Cuando un equipo sale con el punto rojo, el clic derecho ofrece **Encender**: se
manda el paquete mágico de Wake-on-LAN sin tener que irse al otro menú. La
acción solo aparece si el equipo **no responde** —si contesta ya está
encendido— y si se le conoce la MAC.

Lo normal es que **no tengas que configurar nada**: mientras un equipo responde,
el menú aprende su MAC solo. Pero se puede escribir a mano, y entonces manda la
tuya. Los tres sitios de donde sale, por orden de preferencia:

**1. Un comentario en su bloque**, que es lo más directo y viaja con el resto de
la configuración:

```sshconfig
# MAC: aa:bb:cc:dd:ee:ff
# Difusión: 192.168.10.255
Host norte
    HostName 192.168.10.5
    User usuario
```

Valen las tres formas de escribir una MAC (`aa:bb:…`, `aa-bb-…`, `aabbcc…`), y
el comentario puede ir encima del `Host` o dentro del bloque. La difusión es
opcional: sin ella se usa `255.255.255.255`, que solo llega a tu propia red.

**2. Los equipos de la extensión Wake on LAN**, si la tienes instalada. Se leen
de sus ajustes y se emparejan **por nombre**: el nombre del equipo allí tiene
que ser igual que el alias del bloque `Host` (o que su `HostName`). Así no hay
que apuntar la MAC dos veces.

**3. La tabla ARP del sistema**, que es de donde sale sin que hagas nada. Para
pintar el punto verde, el menú abre un socket contra cada equipo; esa
conversación deja la MAC del equipo apuntada en `/proc/net/arp`, y de ahí se
copia mientras está encendido. Queda guardada, así que el día que aparezca en
rojo ya se le puede mandar el paquete.

Eso sí, tiene dos límites que conviene tener claros:

- **Solo equipos de tu mismo segmento de red**, y solo con direcciones IPv4. Si
  para llegar a un equipo hay que atravesar un router, lo que hay en la tabla es
  la MAC del router y no la suya, así que esas entradas se descartan: solo se
  acepta una fila cuya IP sea exactamente la del equipo. Es la misma frontera
  que tiene el propio Wake-on-LAN, que no cruza routers.
- **Hay que haberlo visto encendido una vez.** La primera vez que un equipo
  aparece ya caído no hay nada que aprender.

Se apagan desde los ajustes, y lo aprendido se puede vaciar con el botón
**Olvidar**: se vuelve a llenar solo.

> Como el protocolo no tiene respuesta, la notificación dice «paquete enviado»,
> no «equipo encendido»: es lo único que se puede afirmar. Y para que funcione
> hay que haberlo preparado antes en el equipo destino — está contado en el
> [README de Wake on LAN](../wol-menu@jorgemg1414/README.es.md).

---

## Ajustes

Desde el menú → **Ajustes**, o con `gnome-extensions prefs ssh-menu@jorgemg1414`.

| Ajuste | Por omisión | Descripción |
|---|---|---|
| Archivo de configuración | `~/.ssh/config` | De dónde se leen los bloques `Host` |
| Mostrar usuario@host | sí | El destino real a la derecha del alias |
| Icono del panel | `utilities-terminal-symbolic` | Cualquier icono simbólico del tema |
| Contador de caídos | sí | Cuántos equipos no responden, junto al icono |
| Buscador | sí, desde 8 equipos | Campo de filtro al principio del menú |
| Botón del gestor de archivos | sí | El 📁 de cada fila; oculto, sigue habiendo Ctrl+clic |
| Botón de sftp en terminal | sí | El ⇅ de cada fila; oculto, sigue habiendo Mayús+clic |
| Carpetas montadas | sí | La lista de montajes SFTP al principio del menú |
| Encender desde el menú | sí | «Encender» en el clic derecho de un equipo caído con MAC |
| Aprender la MAC sola | sí | La copia de la tabla ARP mientras el equipo responde |
| Carpeta remota de inicio | vacío | Vacío te deja en tu carpeta personal del servidor |
| Comprobar disponibilidad | sí | El punto verde/rojo |
| Mostrar la latencia | sí | Milisegundos de respuesta |
| Refresco con el menú abierto | 60 s | Cada cuánto se recomprueba mientras miras |
| Comprobar en segundo plano | 0 (desactivado) | Con el menú cerrado; 0 no toca la red |
| Tiempo de espera | 2 s | Antes de dar un equipo por caído |

### Comandos

Los tres son plantillas con marcadores, que se sustituyen **después** de trocear
la orden: un alias con espacios no puede convertirse en argumentos extra.

| Marcador | Valor |
|---|---|
| `%n` | Alias del bloque `Host` |
| `%h` | Host real (`HostName`) |
| `%p` | Puerto |
| `%u` | Usuario |
| `%d` | `usuario@host` |
| `%f` | Archivo de configuración donde está el equipo |
| `%s` | URL `sftp://…` |

| Comando | Por omisión |
|---|---|
| Abrir sesión SSH | `tilix -e "ssh %n"` |
| Abrir SFTP en el gestor de archivos | vacío (`nautilus %s`, o el gestor que tengas) |
| Abrir sftp en una terminal | `tilix -e "sftp %n"` |
| Editar configuración | `gnome-text-editor %f` |

Si el programa configurado no está instalado se prueban alternativas: para la
terminal, `gnome-terminal`, `ptyxis`, `kgx`, `konsole`, `xfce4-terminal`,
`alacritty`, `kitty`, `x-terminal-emulator` y `xterm`; para el editor, `gedit`,
`kate` y `xdg-open`.

**Sobre Tilix:** su `-e` ejecuta la orden directamente, sin pasar por un
intérprete, por eso la plantilla lleva `ssh %n` entre comillas: así llega como
una sola orden. Y ojo con el perfil de Tilix, que por omisión **cierra la
ventana en cuanto la orden termina** (`exit-action` = `close`): si la conexión
falla, el error se va con ella. Para poder leerlo, esta variante espera a que
pulses una tecla cuando `ssh` sale con error:

```
tilix -e "bash -c 'ssh %n || read -n1 -s -p \"[Enter] para cerrar\"'"
```

Para el SFTP, si no hay comando configurado se prueban `nautilus`, `nemo`,
`caja`, `thunar`, `dolphin` y `pcmanfm`, siempre con la URL como argumento. Si
prefieres otro programa, ahí tienes la plantilla:

```
nautilus %s
```

**Por qué se lanza el gestor de archivos en vez de «abrir la URL» sin más:** en
Debian 13 ningún programa declara `x-scheme-handler/sftp`, así que la vía
estándar de GIO (`launch_default_for_uri`, o `gio open`) contesta *«la ubicación
especificada no está montada»* sin llegar a intentar montarla. Se comprueba con:

```bash
gio mime x-scheme-handler/sftp
```

Nautilus, en cambio, monta él mismo cuando le pasas la URL como argumento.

---

## Si todavía no tienes configuración

Es lo normal: `~/.ssh/config` no existe hasta que lo creas. El menú lo dice, y
**Editar config** lo crea con un ejemplo comentado y permisos `600` antes de
abrir el editor.

Un bloque mínimo es esto:

```sshconfig
Host miservidor
    HostName 192.168.1.10
    User usuario
```

A partir de ahí, `ssh miservidor` funciona en la terminal y el equipo aparece en
el menú.

---

## Instalación

```bash
cd ssh-menu@jorgemg1414 && ./install.sh --enable
```

Después hay que recargar GNOME Shell: en Wayland, cerrar sesión y volver a
entrar; en X11, `Alt+F2`, `r` y Enter.

Requisitos, además de GNOME Shell 48:

```bash
sudo apt install libglib2.0-dev-bin openssh-client gvfs-backends
```

`gvfs-backends` es lo que hace que el gestor de archivos sepa abrir `sftp://`.
En una instalación normal de Debian con GNOME ya está.

Para desinstalar:

```bash
./install.sh --uninstall
```

---

## Depuración

Errores de la extensión:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Si un equipo sale gris con las comprobaciones activadas, mira si tiene
`ProxyJump`: esos no se comprueban a propósito.

Si el SFTP no monta, prueba lo mismo a mano para ver el error de verdad:

```bash
gio mount sftp://usuario@host
```

Y para ver qué hay montado ahora mismo:

```bash
gio mount --list
```

---

## Estructura

```
ssh-menu@jorgemg1414/
├── extension.js       Indicador, menú, lanzamiento y limpieza en disable()
├── montajes.js        Carpetas SFTP montadas (Gio.VolumeMonitor)
├── prefs.js           Ventana de preferencias (libadwaita)
├── stylesheet.css     Estilos del menú
├── schemas/           Esquema de GSettings
└── install.sh         Instalador
```

Más los módulos compartidos que `install.sh` copia de [`comun/`](../comun/):
`hosts.js` (lectura de `~/.ssh/config`), `checker.js` (comprobación de puertos),
`wol.js` (paquete mágico y MAC de los equipos) y `asyncgio.js` (envoltorios de
`Promise` sobre las llamadas de Gio).

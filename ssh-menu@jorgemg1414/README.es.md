# SSH Menu

*[Read this in English](README.md)*

Indicador en la barra superior con los equipos de tu `~/.ssh/config`. Al pulsar
uno se abre la sesión SSH en una terminal; el botón de la derecha abre esa misma
máquina por **SFTP** en el gestor de archivos.

La idea es que consola y archivos estén en el mismo sitio: el mismo equipo, la
misma fila, dos formas de entrar.

---

## Qué hace

- **Lee tu configuración tal cual está.** Cada bloque `Host` de `~/.ssh/config`
  es una entrada del menú. Se siguen las directivas `Include`, así que si tienes
  la configuración partida en varios archivos también salen.
- **Abre la sesión con el alias.** El comando que se lanza es `ssh <alias>`, no
  `ssh usuario@host`: así es el propio ssh quien aplica el usuario, el puerto,
  la clave, el `ProxyJump` y todo lo demás que tengas en el bloque. La extensión
  no reimplementa tu configuración.
- **SFTP en la misma fila.** El botón de la derecha abre `sftp://…` en el gestor
  de archivos. Quien monta es GVfs y quien pide la contraseña o la frase de la
  clave es el gestor de archivos: **la extensión no toca credenciales**.
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
  alias, del host o del usuario, ↓/↑ recorren los resultados, Intro abre la
  sesión y Ctrl+Intro el SFTP.
- **Clic derecho en un equipo** para sus propias acciones: copiar `ssh <alias>`,
  comprobarlo ahora o abrir en el editor el archivo donde está definido.
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
    User jorge

Host sur
    HostName 10.30.0.5
    User jorge

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

## Ajustes

Desde el menú → **Ajustes**, o con `gnome-extensions prefs ssh-menu@jorgemg1414`.

| Ajuste | Por omisión | Descripción |
|---|---|---|
| Archivo de configuración | `~/.ssh/config` | De dónde se leen los bloques `Host` |
| Mostrar usuario@host | sí | El destino real a la derecha del alias |
| Icono del panel | `utilities-terminal-symbolic` | Cualquier icono simbólico del tema |
| Contador de caídos | sí | Cuántos equipos no responden, junto al icono |
| Buscador | sí, desde 8 equipos | Campo de filtro al principio del menú |
| Botón de SFTP | sí | El botón de cada fila; con él oculto sigue habiendo Ctrl+clic |
| Carpetas montadas | sí | La lista de montajes SFTP al principio del menú |
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
| Abrir SFTP | vacío (el gestor de archivos predeterminado) |
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

Si prefieres que el SFTP lo abra otro programa, ahí tienes la plantilla:

```
nautilus %s
```

---

## Si todavía no tienes configuración

Es lo normal: `~/.ssh/config` no existe hasta que lo creas. El menú lo dice, y
**Editar config** lo crea con un ejemplo comentado y permisos `600` antes de
abrir el editor.

Un bloque mínimo es esto:

```sshconfig
Host miservidor
    HostName 192.168.1.10
    User jorge
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
├── hosts.js           Lectura y parseo de ~/.ssh/config, con sus Include
├── checker.js         Comprobación de puertos, asíncrona y cancelable
├── montajes.js        Carpetas SFTP montadas (Gio.VolumeMonitor)
├── asyncgio.js        Envoltorios de Promise sobre las llamadas de Gio
├── prefs.js           Ventana de preferencias (libadwaita)
├── stylesheet.css     Estilos del menú
├── schemas/           Esquema de GSettings
└── install.sh         Instalador
```

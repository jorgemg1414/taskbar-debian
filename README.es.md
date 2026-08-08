# taskbar-debian

*[Read this in English](README.md)*

Personalizaciones para **GNOME Shell** en **Debian 13 (trixie)**. Las carpetas
acabadas en `@jorgemg1414` son extensiones de la barra superior, independientes
entre sí, y cada una se instala con su `install.sh`. Las otras tres
—`terminal/`, `portapapeles/` y `actualizaciones/`— no tocan la barra: son el
resto del escritorio, y se instalan con `instalar.sh`.

Ojo con el parecido: `portapapeles/` instala **CopyQ**, que es quien guarda el
historial, y `portapapeles@jorgemg1414/` es la extensión que lo enseña en la
barra. La segunda no sirve de nada sin la primera; la primera funciona sola.

Todo el código está comentado en español y escrito con la API moderna de
extensiones (ESM, GNOME 45+): `import ... from 'gi://…'`, clase que extiende
`Extension` y limpieza completa en `disable()`.

---

## Contenido

| Carpeta | Contenido |
|---|---|
| [`vnc-menu@jorgemg1414/`](vnc-menu@jorgemg1414/) | **VNC Menu** — menú en la barra superior con tus conexiones VNC guardadas, agrupadas y con indicador de disponibilidad |
| [`ssh-menu@jorgemg1414/`](ssh-menu@jorgemg1414/) | **SSH Menu** — los equipos de tu `~/.ssh/config`: sesión en terminal o SFTP, desde la misma fila |
| [`wol-menu@jorgemg1414/`](wol-menu@jorgemg1414/) | **Wake on LAN** — encender equipos a distancia desde la barra superior |
| [`equipos-menu@jorgemg1414/`](equipos-menu@jorgemg1414/) | **Equipos** — cómo está cada equipo por dentro, y apagarlo, reiniciarlo o suspenderlo a distancia |
| [`spotify-menu@jorgemg1414/`](spotify-menu@jorgemg1414/) | **Spotify** — la canción que está sonando, con su portada y sus controles |
| [`concentracion@jorgemg1414/`](concentracion@jorgemg1414/) | **Concentración** — apagar de golpe lo que interrumpe, con temporizador |
| [`pendientes@jorgemg1414/`](pendientes@jorgemg1414/) | **Pendientes** — las tareas sin hacer de tus archivos Markdown, y marcarlas desde la barra |
| [`portapapeles@jorgemg1414/`](portapapeles@jorgemg1414/) | **Portapapeles** — lo último que has copiado, en la barra. Lee el historial de CopyQ, no guarda uno propio |
| [`terminal/`](terminal/) | **Terminal** — sugerencias en gris, colores según escribes, `Ctrl+R` con búsqueda difusa y salto de carpetas con `z` |
| [`portapapeles/`](portapapeles/) | **CopyQ** — el historial del portapapeles y sus atajos, `Super+V` y `Super+Shift+V`. Es lo que lee la extensión de arriba |
| [`actualizaciones/`](actualizaciones/) | **Actualizaciones** — que los parches de seguridad entren solos, y solo ellos |
| [`herramientas/`](herramientas/) | Scripts para convertir archivos `.vnc` en perfiles de Remmina y guardar su contraseña en el llavero de GNOME |
| [`comun/`](comun/) | Los módulos que comparten varias extensiones. El original está aquí; cada `install.sh` copia los que necesita |
| [`comprobar.sh`](comprobar.sh) | Repasa el repositorio: sintaxis, imports, instaladores, esquemas y estilos |

---

## VNC Menu

Un indicador en la barra superior que lee una carpeta de archivos de conexión y
los presenta como menú. Al pulsar una entrada se abre el cliente VNC.

**Qué ofrece:**

- **Lee tus archivos tal cual están.** Soporta `.vnc` de RealVNC Viewer (texto
  plano `Clave=Valor`), `.vnc` de TigerVNC/TightVNC (`host=` y `port=`) y
  `.remmina` (INI). El nombre visible es el del archivo sin extensión.
- **Agrupación automática.** Por subcarpetas, o por las etiquetas del propio
  archivo (`Labels=` en RealVNC, `group=` en Remmina) cuando no hay subcarpetas.
- **Estado de cada equipo.** Un punto verde o rojo indica si el puerto responde,
  con el tiempo de respuesta en milisegundos al lado. Se comprueba de forma
  asíncrona con `Gio.SocketClient` y 2 s de espera, ocho a la vez como mucho, y
  solo mientras el menú está abierto: con el menú cerrado no se toca la red,
  salvo que actives las comprobaciones en segundo plano.
- **Contador de caídas en el panel.** Cuántas conexiones no responden, junto al
  icono, para no tener que abrir el menú a mirar.
- **Sesiones abiertas.** Las ventanas VNC que ya tienes abiertas salen al
  principio del menú: pulsar una la trae al frente en vez de abrir otra sesión
  contra la misma sucursal.
- **Buscador.** Con muchas conexiones aparece un campo de filtro al principio del
  menú: escribe parte del nombre o del host, ↓/↑ recorren los resultados e Intro
  conecta.
- **Clic derecho en una conexión** para sus propias acciones: copiar el host,
  comprobarla ahora o abrir el archivo en el gestor de archivos. Y **encender el
  equipo** si no responde: la MAC, que un archivo `.vnc` no lleva, sale de los
  equipos de la extensión Wake on LAN o se aprende sola de la tabla ARP.
- **Se actualiza sola.** La carpeta se escanea con `Gio` y se vigila con
  `Gio.FileMonitor`: al añadir, borrar o editar una conexión el menú cambia al
  momento, sin recargar el shell.
- **Comandos configurables.** Por omisión `remmina -c vnc://%h:%p`, con
  alternativas automáticas a `vncviewer` o `xtigervncviewer` si Remmina no está
  instalado. Ventana de preferencias en libadwaita.
- **No toca tus credenciales.** Las claves `Password`, `Identity` y
  `AuthCertificate` se descartan en el parser: ni se leen ni se pasan a ningún
  sitio.

Para añadir, renombrar o reagrupar conexiones no hace falta tocar la extensión:
son archivos de una carpeta y basta con editarlos. Está explicado paso a paso en
**[Gestionar las conexiones](vnc-menu@jorgemg1414/README.es.md#gestionar-las-conexiones)**.

> **Aviso sobre los archivos de conexión:** la contraseña que guarda RealVNC en
> `Password=` no es un hash, es la contraseña cifrada con una clave fija y
> pública, recuperable en texto claro con herramientas comunes. No subas tu
> carpeta de conexiones a ningún repositorio, ni siquiera privado.

Documentación completa (formatos, ajustes, depuración):
**[vnc-menu@jorgemg1414/README.es.md](vnc-menu@jorgemg1414/README.es.md)**

---

## SSH Menu

La misma idea aplicada a `~/.ssh/config`: cada bloque `Host` es una entrada del
menú, de modo que la consola y los archivos de un equipo están en la misma fila.

- **Al pulsar un equipo se lanza `ssh <alias>`** en una terminal, para que sea el
  propio ssh quien aplique el usuario, el puerto, la clave y el `ProxyJump` que
  tengas configurados.
- **El botón de la derecha lo abre por SFTP** en el gestor de archivos. Quien
  monta es GVfs y quien pide la contraseña es el gestor de archivos: la
  extensión no toca credenciales.
- **Los montajes se quedan listados** al principio del menú, con su botón de
  expulsar, porque una conexión SFTP sigue viva aunque cierres la ventana desde
  la que la abriste.
- **La misma maquinaria que el menú de VNC:** agrupación (aquí con comentarios
  `# Grupo: NOMBRE`), punto verde/rojo con latencia, contador de caídos en el
  panel, buscador y `Gio.FileMonitor` sobre los archivos de configuración.
- **Los equipos detrás de un `ProxyJump` no se comprueban** — no aceptan
  conexión directa, así que un punto rojo sería mentira. En su lugar muestran
  `⇢ <salto>`.
- **Al que no responde se le puede encender desde ahí mismo**, con el paquete
  mágico, y sin configurar nada: la MAC se aprende sola de la tabla ARP mientras
  el equipo está encendido, porque el menú ya habla con él para pintar el punto
  verde. También se puede escribir a mano con un comentario `# MAC:`.

Documentación completa (agrupación, comandos, saltos, depuración):
**[ssh-menu@jorgemg1414/README.es.md](ssh-menu@jorgemg1414/README.es.md)**

---

## Equipos

Los mismos equipos del `~/.ssh/config`, pero contando **cómo están por dentro**.
El punto verde de los otros menús dice que el puerto 22 acepta conexiones; este
entra y pregunta.

- **Un resumen por equipo**: desde cuándo está encendido, cuánta memoria y
  cuánto disco le quedan y cuántas actualizaciones tiene pendientes. El disco
  casi lleno se pinta en rojo.
- **Pregunta con `ssh <alias>`** y `BatchMode` activado, así que nunca sale un
  diálogo de contraseña: si la clave no está autorizada, lo dice, y eso se
  arregla con `herramientas/autorizar-clave.sh`.
- **Una sola conexión por equipo.** Con `ControlMaster`, la primera consulta
  paga el saludo completo de SSH y las siguientes viajan por el mismo túnel.
  Con el menú cerrado no se pregunta nada.
- **Sirve igual para Windows**, que contesta lo mismo por PowerShell. El sistema
  se averigua solo la primera vez.
- **Apagar, reiniciar y suspender** desde el clic derecho, con confirmación en
  el propio menú. Son las únicas acciones del repositorio que no se pueden
  deshacer desde la barra, así que no están en el clic normal.

> Un Linux no deja que una sesión SSH lo apague sin autorizarlo antes. El README
> de la extensión trae la regla de polkit y la línea de sudoers que lo permiten,
> y explica lo que cada una implica.

Documentación completa (consulta remota, energía, permisos, depuración):
**[equipos-menu@jorgemg1414/README.es.md](equipos-menu@jorgemg1414/README.es.md)**

---

## Spotify

Qué canción está sonando, sin abrir nada: el artista y el título en la barra, y
en el menú la portada, el álbum, por dónde va y los botones.

- **Se lo pregunta al propio reproductor** por D-Bus, con la interfaz estándar
  MPRIS que ya usa GNOME para sus controles de música. Sin cuenta que enlazar,
  sin clave de la API web y sin nada que salga del equipo.
- **Los controles en la barra misma**: anterior, reproducir/pausar y siguiente,
  sin abrir el menú. Pulsarlos no lo abre: el clic se queda en el botón.
- **La barra la escribes tú**: `{artista} — {titulo}` por omisión, con el largo
  que quieras, o solo el icono.
- **La portada se baja una vez** y se guarda en `~/.cache`; volver a una canción
  ya no toca la red. Se puede apagar del todo.
- **Arrastrando la barra de progreso se salta** a otro punto de la canción, y
  los botones que el reproductor no atendería salen apagados en vez de fingir.
- **Botón central para pausar** sin abrir el menú, y rueda para cambiar de
  canción si la activas.
- **Sirve para otros reproductores**: con Spotify cerrado puede seguir al
  navegador o a cualquier programa que hable MPRIS.

> Con el menú cerrado el indicador solo escucha. La posición, que nadie anuncia
> por D-Bus, se pregunta una vez por segundo y únicamente con el menú abierto.

Documentación completa (portadas, otros reproductores, ajustes, depuración):
**[spotify-menu@jorgemg1414/README.es.md](spotify-menu@jorgemg1414/README.es.md)**

---

## Pendientes

Las tareas sin hacer de tus archivos Markdown —las líneas `- [ ] algo`—
agrupadas por el encabezado que tengan encima, y marcables desde la barra.

- **Lee tus archivos tal como están**, igual que el menú de VNC lee tus `.vnc` y
  el de SSH tu `~/.ssh/config`. Ni base de datos, ni servicio, ni formato
  propio: un `.md` que puedes seguir editando con cualquier editor, o una
  carpeta entera de ellos.
- **Marcar cambia un solo carácter** del archivo, el hueco de la casilla. Todo
  lo demás de la línea —sangría, viñeta, espacios— se copia tal cual.
- **Y se escribe sin abrir el editor**: editar el texto, apuntar una tarea
  nueva o borrar una se hacen en la propia fila, con un campo de texto que se
  cierra con Intro o con Escape.
- **Y no lo hace a ciegas**: antes de escribir relee el archivo para comprobar
  que la tarea sigue donde estaba, y escribe con el etag de lo que leyó, así que
  si lo tenías abierto en el editor la escritura se rechaza en vez de pisar tu
  cambio.
- **Se actualiza sola** con `Gio.FileMonitor`, tiene buscador y contador de lo
  que queda en el panel.

Es la única extensión del repositorio que escribe en un archivo tuyo, de ahí
tanto cuidado.

Documentación completa (formato, seguros de escritura, ajustes):
**[pendientes@jorgemg1414/README.es.md](pendientes@jorgemg1414/README.es.md)**

---

## Herramientas

Los archivos `.vnc` llevan la contraseña cifrada con la clave propia de RealVNC,
que Remmina no puede aprovechar: por eso te la pide en cada conexión. Estos
scripts lo resuelven de una vez:

```bash
cd herramientas && ./vnc-a-remmina.sh
```

Crea un perfil `.remmina` por cada `.vnc` (nombre, servidor, usuario y grupo) en
`~/.config/remmina`. No copia ninguna contraseña.

```bash
./guardar-password.sh
```

Pide una contraseña una sola vez, sin mostrarla, y la guarda en el llavero de
GNOME para todos los perfiles, con el mismo esquema `org.remmina.Password` que
lee Remmina. Si le pasas rutas de perfiles, solo hace esos. La contraseña viaja
por una tubería y nunca como argumento, así que no aparece en `ps` ni en el
historial del intérprete.

### Entrar sin contraseña

```bash
./autorizar-clave.sh <destino> [más destinos...]
```

Autoriza tu clave pública en el equipo remoto, que es lo que quita la
contraseña de las tres vías a la vez: la sesión SSH, el `sftp` de consola y el
montaje de la carpeta en Archivos. El destino es lo mismo que le pasarías a
`ssh`: un alias de `~/.ssh/config` —los que salen en el menú— o `usuario@host`.

Sabe dónde va la clave en cada sistema, que es justo lo que hace fallar a
`ssh-copy-id` contra un Windows:

| Sistema | Archivo |
|---|---|
| Linux, BSD | `~/.ssh/authorized_keys`, con permisos 600 |
| Windows, cuenta normal | `%USERPROFILE%\.ssh\authorized_keys` |
| Windows, cuenta administradora | `%ProgramData%\ssh\administrators_authorized_keys` |

El último es el que se atraganta: `sshd` solo lo lee si la ACL deja únicamente a
SYSTEM y a Administradores, y si no cuadra ignora la clave **sin decir nada**.
El script la arregla con `icacls`, dando los permisos **por SID** y no por
nombre de grupo, porque en un Windows en español el grupo se llama
«Administradores» y `icacls` fallaría.

Para saber a cuál de los tres archivos va, primero pregunta qué sistema hay al
otro lado: `uname -s`, y si no existe, `cmd /c ver` y, en último término,
PowerShell —hacen falta las tres porque el intérprete por omisión de un Windows
puede ser `cmd` o PowerShell, y no entienden lo mismo—. Si aun así no lo
reconoce, no toca nada y **enseña lo que contestó el equipo**, que es lo que
hace falta para saber por qué. Se puede saltar la pregunta:

```bash
./autorizar-clave.sh --sistema windows <destino>
```

La contraseña la pide `ssh`: el script no la lee, no la guarda y no la pasa por
la línea de comandos. Abre una sola conexión multiplexada por equipo, así que
solo hay que teclearla una vez. Y solo viaja la mitad pública de la clave —
si le pasas una privada por error, se planta y no la manda.

Después, apunta la extensión a los perfiles:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/vnc-menu@jorgemg1414/schemas set org.gnome.shell.extensions.vnc-menu connections-dir '~/.config/remmina'
```

---

## Concentración

Un interruptor que apaga de golpe lo que interrumpe, con temporizador: 25, 50 o
90 minutos, o sin límite.

- **No molestar**, con el mismo interruptor de GNOME. Las notificaciones no se
  pierden: esperan en el calendario.
- **Pausa lo que esté sonando** —Spotify, el navegador, un vídeo— y al terminar
  devuelve solo lo que pausó.
- **Esconde la dock del todo**, tampoco asoma al llevar el ratón al borde.
- **En la barra queda el tiempo que falta**, y al llegar a cero todo vuelve a
  como estaba.

> Lo difícil de esto no es apagar, es deshacer. Antes de tocar nada se apunta
> cómo estaba, y se guarda en los ajustes, no en memoria: si el shell se
> reinicia en mitad de una sesión, al volver se retoma la cuenta; y si el plazo
> venció mientras tanto, se deshace todo al arrancar. Lo que hayas cambiado tú a
> mano por el camino no se toca.

Documentación completa (qué apaga, cómo lo deshace, ajustes):
**[concentracion@jorgemg1414/README.es.md](concentracion@jorgemg1414/README.es.md)**

---

## El sitio en la barra

GNOME no deja reordenar la barra superior: el sitio lo pide cada extensión al
ponerse. Las cinco de aquí lo sacan de sus ajustes —**Barra superior** en sus
preferencias—, con la parte de la barra (izquierda, centro o derecha) y el orden
dentro de ella. Cambiarlo mueve el indicador al momento, sin recargar nada.

Vienen puestas en la derecha, en este orden:

| Extensión | Posición |
|---|---|
| VNC | 0 |
| Wake on LAN | 1 |
| SSH | 2 |
| Equipos | 3 |
| Spotify | 4 |
| Concentración | 5 |

Si el número pasa de los indicadores que hay en esa parte, el de la extensión se
queda el último. Y solo manda sobre estas cinco: para ordenar también las de
terceros hace falta una extensión organizadora, que si la instalas pasa a
decidir ella.

> **El número es el hueco en el que se mete el indicador al arrancar la
> extensión, no una posición fija.** En esa parte de la barra también están los
> indicadores del propio GNOME, y las extensiones no arrancan siempre en el
> mismo orden, así que dos que empiecen con números seguidos pueden acabar
> cambiadas. Se arregla probando un par de números hasta que quede como quieres:
> el cambio se ve al momento.

Desde consola, sin abrir las preferencias:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/spotify-menu@jorgemg1414/schemas set org.gnome.shell.extensions.spotify-menu panel-box 'left'
```

Lo pone [`comun/barra.js`](comun/), compartido por las cinco.

---

## Requisitos

- GNOME Shell 48 (probado en 48.7, Debian 13, sesión Wayland)
- `glib-compile-schemas` — paquete `libglib2.0-dev-bin`
- Para el menú de VNC: `remmina` + `remmina-plugin-vnc`, o `tigervnc-viewer`
- Para el menú de SSH: `openssh-client`, y `gvfs-backends` para el SFTP
- Para el menú de Equipos: `openssh-client`, y tu clave autorizada en cada
  equipo remoto (`herramientas/autorizar-clave.sh`)
- Para el menú de Spotify: un reproductor que hable MPRIS —el cliente oficial lo
  hace— y `gir1.2-soup-3.0` para las portadas, que ya viene con GNOME

```bash
sudo apt install libglib2.0-dev-bin remmina remmina-plugin-vnc openssh-client gvfs-backends
```

---

## Instalación

```bash
git clone https://github.com/jorgemg1414/taskbar-debian.git
```

```bash
cd taskbar-debian/vnc-menu@jorgemg1414 && ./install.sh --enable
```

El script copia los archivos a
`~/.local/share/gnome-shell/extensions/vnc-menu@jorgemg1414/`, compila el
esquema de GSettings y activa la extensión.

Después hay que recargar GNOME Shell:

- **Wayland:** cerrar sesión y volver a entrar. No hay forma de recargar el
  shell en caliente.
- **X11:** `Alt+F2`, escribir `r` y pulsar Enter.

Por omisión busca las conexiones en `~/Documentos/VNC`. Se cambia desde las
preferencias de la extensión.

Para desinstalar:

```bash
./install.sh --uninstall
```

---

## Depuración

Los errores de las extensiones salen en el registro de GNOME Shell:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Comprobar que el shell reconoce la extensión:

```bash
gnome-extensions info vnc-menu@jorgemg1414
```

Si dice «no existe» después de instalarla, es que falta reiniciar la sesión.

---

## Estructura del repositorio

```
taskbar-debian/
├── terminal/              Ajustes de zsh (ver su propio README)
├── portapapeles/          CopyQ y sus atajos (ver su propio README)
├── actualizaciones/       Parches de seguridad automáticos (ver su propio README)
├── herramientas/          Scripts auxiliares (ver arriba)
├── comun/                 Módulos compartidos (ver su propio README)
│   ├── asyncgio.js        Envoltorios de Promise sobre las llamadas de Gio
│   ├── barra.js           El sitio del indicador en la barra superior
│   ├── barraprefs.js      Las dos filas de preferencias que lo eligen
│   ├── checker.js         Comprobación de puertos, asíncrona y cancelable
│   ├── hosts.js           Lectura y parseo de ~/.ssh/config
│   ├── mpris.js           Qué suena, control del reproductor y pausar todo
│   └── wol.js             Paquete mágico, equipos y MAC aprendidas del ARP
├── ssh-menu@jorgemg1414/  SSH Menu (ver su propio README)
├── wol-menu@jorgemg1414/  Wake on LAN (ver su propio README)
├── equipos-menu@jorgemg1414/  Equipos (ver su propio README)
├── spotify-menu@jorgemg1414/  Spotify (ver su propio README)
├── concentracion@jorgemg1414/ Concentración (ver su propio README)
├── pendientes@jorgemg1414/ Pendientes (ver su propio README)
├── portapapeles@jorgemg1414/ Portapapeles (ver su propio README)
└── vnc-menu@jorgemg1414/
    ├── extension.js       Indicador, menú, lanzamiento y limpieza en disable()
    ├── connections.js     Escaneo asíncrono de la carpeta y parser de conexiones
    ├── ventanas.js        Localiza las ventanas de sesiones VNC abiertas
    ├── prefs.js           Ventana de preferencias (libadwaita)
    ├── stylesheet.css     Estilos del menú
    ├── schemas/           Esquema de GSettings
    ├── install.sh         Instalador
    ├── README.md          Documentación detallada (inglés)
    └── README.es.md       Documentación detallada (español)
```

Cada extensión que se añada al repositorio sigue el mismo patrón: una carpeta
con el UUID como nombre, su `install.sh` y su README. Lo que use más de una
extensión se sube a `comun/`, y su `install.sh` lo copia de ahí al instalar: en
el repositorio hay un solo archivo de cada cosa, y lo instalado sigue siendo
autocontenido.

# VNC Menu — extensión de GNOME Shell 48

*[Read this in English](README.md)*

Indicador en la barra superior con tus conexiones VNC guardadas. Al pulsar una
entrada se lanza el cliente VNC; junto a cada nombre un punto verde o rojo indica
si el equipo responde.

- **UUID:** `vnc-menu@jorgemg1414`
- **Shell:** GNOME 48 (probado en GNOME Shell 48.7, Debian 13)
- **Carpeta de conexiones por omisión:** `~/Documentos/VNC`

---

## Instalación

```bash
./install.sh --enable
```

Esto copia los archivos a `~/.local/share/gnome-shell/extensions/vnc-menu@jorgemg1414/`,
compila el esquema de GSettings y activa la extensión.

Después hay que recargar el shell:

- **X11:** `Alt+F2` → escribe `r` → Enter.
- **Wayland:** cerrar sesión y volver a entrar. Si solo has tocado el código de
  la extensión, basta con desactivar y volver a activar:

```bash
gnome-extensions disable vnc-menu@jorgemg1414 && gnome-extensions enable vnc-menu@jorgemg1414
```

Desinstalar:

```bash
./install.sh --uninstall
```

---

## Formato de conexiones que lee

La carpeta se escanea de forma asíncrona (`Gio`) y se vigila con `Gio.FileMonitor`,
así que al añadir, borrar o editar un archivo el menú se actualiza solo, **sin
recargar el shell**.

### RealVNC Viewer (`.vnc`) — el formato principal

Texto plano `Clave=Valor`, sin secciones INI:

```ini
FriendlyName=OFICINA
Host=servidor.ejemplo.net:5904
UserName=
Password=<cadena cifrada>
Labels=OFICINAS/OFICINAS (NORTE)
```

- **Nombre visible:** el del archivo sin extensión (`OFICINA.vnc` → `OFICINA`).
- **Host y puerto:** de `Host=`. Si no hay puerto se usa el 5900; un número menor
  que 100 se interpreta como *display* VNC (`:4` → 5904).
- **Grupo:** de `Labels=`. Cuando un archivo tiene varias etiquetas se elige la
  que comparten **más** conexiones, y del nombre jerárquico se muestra el último
  tramo tras `/` (`OFICINAS/OFICINAS (NORTE)` → *OFICINAS (NORTE)*).
- **`Password`, `Identity` y `AuthCertificate` se ignoran por completo**: vienen
  cifradas y la extensión ni las lee ni las pasa a ningún sitio.

### Otros formatos soportados

- **`.remmina`** (INI): `server=`, `group=`, `name=`. Se lanza con `remmina -c /ruta/al/archivo`.
- **`.vnc` estilo TigerVNC/TightVNC**: `host=` y `port=` en claves separadas.

### Subcarpetas

Si creas subcarpetas dentro de la carpeta de conexiones, cada una se convierte en
un grupo del menú (la subcarpeta manda sobre las etiquetas). Se recorren hasta 4
niveles de profundidad.

---

## Uso

| Elemento | Qué hace |
|---|---|
| Entrada de conexión | Lanza el cliente VNC con `Gio.Subprocess` (nunca bloquea el shell) |
| Clic derecho en una entrada | Abre debajo una fila de acciones: **Copiar** el host, **Comprobar** ahora y **Ver archivo** en el gestor de archivos |
| Punto verde | El puerto acepta conexiones |
| Punto rojo | Puerto cerrado, host inalcanzable o se agotó el tiempo de espera |
| Punto amarillo | Comprobación en curso (o esperando turno) |
| Punto gris | Sin comprobar todavía (o comprobaciones desactivadas) |
| Milisegundos | Lo que tardó el host en aceptar la conexión, resolución DNS incluida |
| Contador del panel | Cuántas conexiones no responden |
| **Recargar** | Vuelve a escanear la carpeta. No cierra el menú, así ves cómo se refrescan las entradas y su estado |
| **Carpeta** | Abre `~/Documentos/VNC` en Nautilus |
| **Ajustes** | Abre los ajustes de la extensión |

La lista se desplaza: tengas las conexiones que tengas, el menú no pasa de
alrededor del 60 % de la pantalla y la fila de acciones se queda en su sitio.

### Teclado

**↓/↑** recorren las conexiones visibles, saltando cabeceras de grupo y lo que
esconda el filtro, y desplazando la lista según haga falta. **↑** en la primera
devuelve el foco al buscador. **Intro** lanza la conexión enfocada.

### Buscador

Cuando hay 8 conexiones o más aparece un campo de búsqueda al principio del
menú, ya enfocado: escribe y la lista se filtra por **nombre, host y grupo**,
sin distinguir mayúsculas ni acentos. **Intro** conecta con la primera
coincidencia y **Escape** limpia el filtro (o cierra el menú si ya está vacío).
Se desactiva, o se cambia el número de conexiones a partir del cual aparece,
en las preferencias.

### Cuándo se consulta la red

Solo **mientras el menú está abierto**: al abrirlo se comprueban todos los
hosts y se refrescan cada 60 s mientras siga a la vista. Al cerrarlo se para el
refresco y se cancelan las comprobaciones en vuelo, así que con el menú cerrado
la extensión no abre ni una conexión.

Si prefieres tener el estado siempre al día, en las preferencias hay
**Comprobar en segundo plano**, desactivado por omisión. Piensa que activarlo
son tantas conexiones TCP como entradas tengas, cada intervalo, también cuando
estás fuera de la red donde viven esos equipos.

Todo es asíncrono (`Gio.SocketClient`, 2 s de tiempo de espera) y las
comprobaciones pendientes se cancelan en `disable()`. Como mucho corren **8 a la
vez**; el resto espera en cola y entra según se liberan huecos, así que veinte
sucursales no son veinte sockets simultáneos.

El **contador del panel** dice cuántos hosts están caídos sin abrir el menú. Con
el menú cerrado solo se mantiene al día si activas las comprobaciones en segundo
plano; si no, muestra lo que se sabía la última vez que lo miraste.

---

## Gestionar las conexiones

La extensión no trae editor: **cada entrada del menú es un archivo** de la
carpeta de conexiones. Se edita el archivo y el menú se actualiza solo, porque
un `Gio.FileMonitor` vigila la carpeta. Si algo no se refresca, está
**Recargar conexiones** en el menú.

Para llegar rápido a la carpeta: menú → **Abrir carpeta**.

### Editar con el programa que las creó

Es lo más seguro, porque mantiene coherentes las claves cifradas. Si usas
RealVNC Connect Viewer:

```bash
/usr/lib/rvncconnect/rvncconnect
```

### Editar a mano

Son archivos de texto, así que vale cualquier editor:

```bash
gnome-text-editor ~/Documentos/VNC/OFICINA.vnc
```

Lo que la extensión lee de cada archivo:

| Qué quieres cambiar | Dónde se cambia |
|---|---|
| Host o puerto | La línea `Host=servidor:puerto` (`server=` en `.remmina`) |
| **Nombre en el menú** | **El nombre del archivo**, no `FriendlyName=` |
| Grupo | La línea `Labels=`, o la subcarpeta donde esté el archivo |
| Usuario | `UserName=` |

El resto de claves (`Quality`, `Sequence`, `Uuid`, `ConnTime`…) se ignoran:
déjalas como están para que el cliente VNC siga entendiendo el archivo.

### Renombrar una entrada

El texto del menú sale del nombre del archivo, así que basta con renombrarlo:

```bash
mv ~/Documentos/VNC/LAMANGA.vnc "~/Documentos/VNC/LA MANGA.vnc"
```

### Añadir una conexión nueva

Con dos líneas es suficiente; el resto es opcional:

```bash
printf 'FriendlyName=NUEVA\nHost=servidor.ejemplo.net:5904\nLabels=OFICINAS\n' > ~/Documentos/VNC/NUEVA.vnc
```

### Reorganizar los grupos

Las subcarpetas mandan sobre las etiquetas. Para dejar **todo bajo un solo
grupo**, mueve los archivos a una subcarpeta con ese nombre:

```bash
mkdir -p ~/Documentos/VNC/OFICINAS && mv ~/Documentos/VNC/*.vnc ~/Documentos/VNC/OFICINAS/
```

Para dividir por zonas, una subcarpeta por grupo. El título del grupo es la ruta
relativa (`ZONA/NORTE`) y se admiten hasta 4 niveles de anidamiento.

Esto solo cambia dónde están los archivos, no su contenido: las contraseñas y las
etiquetas del cliente VNC quedan intactas. Ten en cuenta que si luego exportas
una conexión nueva desde el cliente, lo normal es que caiga en la raíz de la
carpeta y aparezca en un grupo aparte hasta que la muevas.

La alternativa —igualar la línea `Labels=` de todos los archivos— también
funciona, pero esas etiquetas son las que organiza tu cliente VNC, así que le
aplanarías el árbol de conexiones a él también. Haz copia antes:

```bash
cp -a ~/Documentos/VNC ~/Documentos/VNC.bak
```

### Sobre las contraseñas al conectar

El comando por omisión, `remmina -c vnc://%h:%p`, **no abre tu archivo**: solo
usa el host y el puerto. Por eso Remmina pedirá la contraseña la primera vez (y
la guardará en su propio llavero si se lo indicas), sin usar la que hay dentro
del `.vnc`.

Si prefieres que se abran tus archivos tal cual, con las credenciales que ya
guardan, cambia el comando de los `.vnc` en las preferencias por el de tu
cliente. Con RealVNC Connect Viewer, cuya opción `-config` carga todos los
parámetros del archivo:

```
/usr/lib/rvncconnect/rvncconnect -config %f
```

Así la contraseña no sale nunca del archivo. **No pongas contraseñas en el
comando**: quedarían visibles en `ps` para cualquier proceso de tu sesión y en
claro dentro de `~/.config/dconf`.

La otra opción limpia es usar perfiles `.remmina`, que guardan la credencial en
el llavero de GNOME. En [`herramientas/`](../herramientas/) hay dos scripts que
convierten tus `.vnc` en perfiles de Remmina y guardan la contraseña en el
llavero preguntándola una sola vez.

---

## Configuración

Desde el menú → **Preferencias**, o con `gnome-extensions prefs vnc-menu@jorgemg1414`.

| Ajuste | Por omisión | Descripción |
|---|---|---|
| Carpeta | `~/Documentos/VNC` | Dónde buscar las conexiones |
| Archivos `.vnc` | `remmina -c vnc://%h:%p` | Comando de conexión |
| Archivos `.remmina` | `remmina -c %f` | Comando de conexión |
| Abrir carpeta | `nautilus %f` | Gestor de archivos |
| Icono del panel | `computer-symbolic` | Cualquier icono simbólico del tema |
| Contador de caídas en el panel | sí | Cuántas conexiones no responden, junto al icono |
| Mostrar host y puerto | sí | `host:puerto` a la derecha del nombre |
| Buscador en el menú | sí | Filtrar escribiendo |
| Mostrarlo a partir de | 8 | Conexiones necesarias para que aparezca el buscador |
| Comprobar disponibilidad | sí | Punto verde/rojo |
| Mostrar la latencia | sí | Milisegundos que tarda cada host en responder |
| Refresco con el menú abierto | 60 s | Entre comprobaciones mientras miras el menú |
| Comprobar en segundo plano | 0 (desactivado) | Segundos entre comprobaciones con el menú cerrado |
| Tiempo de espera | 2 s | Antes de dar un host por caído |

**Marcadores de los comandos:** `%h` host · `%p` puerto · `%u` usuario ·
`%n` nombre · `%f` ruta del archivo.

La sustitución se hace **después** de trocear la orden, así que un host o una
ruta con espacios no puede colarse como argumentos extra.

**Alternativas automáticas:** si el programa del comando configurado no está
instalado, se prueban en orden `remmina -c vnc://%h:%p`, `vncviewer %h:%p`,
`xtigervncviewer %h:%p` y `gvncviewer %h:%p`. Si no hay ninguno, aparece una
notificación de error.

También puedes cambiar los ajustes desde la terminal:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/vnc-menu@jorgemg1414/schemas set org.gnome.shell.extensions.vnc-menu vnc-command 'xtigervncviewer %h:%p'
```

---

## Depuración

Registro del shell en vivo (aquí salen los errores de JavaScript de la extensión,
prefijados con `[vnc-menu]`):

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Solo los mensajes de esta extensión:

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i vnc-menu
```

Errores desde el arranque de la sesión actual:

```bash
journalctl -b -o cat /usr/bin/gnome-shell | grep -iE "vnc-menu|error"
```

Estado de la extensión:

```bash
gnome-extensions info vnc-menu@jorgemg1414
```

Ventana de preferencias con salida en la terminal (útil para depurar `prefs.js`):

```bash
gnome-extensions prefs vnc-menu@jorgemg1414
```

Comprobar a mano si un host responde (lo mismo que hace la extensión):

```bash
timeout 2 bash -c 'cat < /dev/null > /dev/tcp/servidor.ejemplo.net/5904' && echo ABIERTO || echo CERRADO
```

### Problemas frecuentes

- **El menú no aparece tras instalar:** falta recargar el shell (ver arriba) o
  activarla con `gnome-extensions enable vnc-menu@jorgemg1414`.
- **Las preferencias no abren / «Schema not found»:** no se compiló el esquema.
  Ejecuta de nuevo `./install.sh`, que llama a `glib-compile-schemas`.
- **Todos los puntos en rojo:** comprueba el firewall/VPN, o sube el tiempo de
  espera en las preferencias si la red es lenta.
- **No conecta al pulsar:** revisa `journalctl` y prueba el comando a mano, p. ej.
  `remmina -c vnc://servidor.ejemplo.net:5904`.

---

## Estructura del código

| Archivo | Contenido |
|---|---|
| `extension.js` | Indicador del panel, menú, lanzamiento del cliente y limpieza en `disable()` |
| `connections.js` | Escaneo asíncrono de la carpeta y parseo de los archivos de conexión |
| `checker.js` | Comprobación de puertos con `Gio.SocketClient` y cancelación |
| `asyncgio.js` | Envoltorios de `Promise` sobre las llamadas asíncronas de Gio |
| `prefs.js` | Ventana de preferencias (libadwaita) |
| `schemas/` | Esquema de GSettings |
| `stylesheet.css` | Estilos de los puntos de estado y avisos |

### Limpieza en `disable()`

Requisito de GNOME que esta extensión cumple: se destruye el indicador, se
quitan los temporizadores con `GLib.source_remove()`, se cancelan los
`Gio.Cancellable` (escaneo y comprobaciones de red), se desconectan y cancelan
los `Gio.FileMonitor` y se desconectan todas las señales de `GSettings` y del menú.

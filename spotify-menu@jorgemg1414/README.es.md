# Spotify

*[Read this in English](README.md)*

Indicador en la barra superior con la canción que está sonando: título, artista,
álbum, portada, por dónde va y los botones para pasar de canción o pausarla.

---

## Cómo funciona

Spotify —como casi todos los reproductores del escritorio— publica lo que está
reproduciendo en el bus de sesión con la interfaz estándar **MPRIS**
(`org.mpris.MediaPlayer2`). Ahí están el título, el artista, el álbum, la
dirección de la portada, la duración y el estado, y por ahí mismo se le puede
decir que pause o que pase a la siguiente.

Es la misma interfaz que usa GNOME para los controles de música del área de
notificaciones. Lo que añade esta extensión es tenerlo en la barra, a la vista,
sin abrir nada.

Eso significa que **no hay ninguna cuenta que enlazar, ninguna clave de la API
web que guardar y ningún dato que salga de este equipo**: es el propio programa
el que lo cuenta, aquí dentro. La única excepción es la portada, que se baja de
la dirección que publica el reproductor —ver [más abajo](#la-portada)—.

> Con el reproductor cerrado no hay nada que preguntar y no se pregunta: por
> omisión el indicador se quita de la barra hasta que vuelva a haber música.

---

## Lo que se ve

### En la barra

El artista y el título, cortados a treinta caracteres, y los tres controles —
**anterior, reproducir/pausar y siguiente**— para no tener que abrir nada.
Pulsarlos no abre el menú: el clic se queda en el botón.

Todo eso se cambia en las preferencias: el formato —`{titulo}`, `{artista}` y
`{album}`—, la longitud, si se ve el texto o solo el icono, y si están los
controles.

Con los controles puestos, el icono de la izquierda se queda fijo: el botón de
reproducir ya dice si está sonando, y dos iconos parecidos uno al lado del otro
acaban contradiciéndose. Quitando los controles, el icono vuelve a seguir al
estado (se puede desactivar con **El icono dice si está sonando**).

### En el menú

- **La portada del disco**, tal cual la publica el reproductor.
- **Título, artista y álbum**, cada uno en su línea. Pulsarlos **lleva a la
  ventana de Spotify**, que es lo que se quiere hacer casi siempre después de
  mirar qué suena.
- **Por dónde va la canción**, con el tiempo transcurrido y el total. La barra
  se puede arrastrar para saltar a otro punto.
- **Anterior, reproducir/pausar y siguiente.** Los botones que el reproductor no
  atendería en ese momento se quedan apagados en vez de fingir que hacen algo.
- **Copiar el enlace de la canción**, que es lo que se pega en un chat cuando
  alguien pregunta qué estás escuchando.

La posición es el único dato que hay que ir a buscar: MPRIS no la anuncia
—cambiaría mil veces por segundo—, así que se pregunta **una vez por segundo y
solo mientras el menú está abierto**. Con el menú cerrado, el indicador se
limita a escuchar lo que el reproductor anuncia por su cuenta al cambiar de
canción o de estado.

---

## Atajos del ratón

| Sobre el indicador | Qué hace |
|---|---|
| Clic | Abre el menú |
| Clic con el botón central | Reproducir o pausar, sin abrir el menú |
| Rueda | Canción siguiente o anterior |

El botón central viene activado; la rueda **no**, porque es fácil rozarla sin
querer al pasar el ratón por la barra y saltarse una canción. Las dos cosas se
cambian en las preferencias.

---

## La portada

MPRIS no manda la imagen, manda su dirección. La de Spotify apunta a su CDN
(`i.scdn.co`), así que hay que bajarla. Lo que se baja se guarda en
`~/.cache/spotify-menu/`, con el nombre sacado del hash de la dirección, y de
ahí en adelante se lee de disco: cambiar de canción y volver no vuelve a salir a
la red.

- Solo se piden direcciones `http://` y `https://`, y solo las que publica el
  propio reproductor.
- Se mira el tamaño anunciado en las cabeceras **antes** de traerse el cuerpo:
  lo que pase de 4 MB no es una portada y se corta ahí.
- La caché se poda sola: se quedan las sesenta últimas.
- Un reproductor local que publique un `file://` no descarga nada, se usa la
  imagen que ya está en disco.

Se puede apagar del todo con **Mostrar la portada**, y entonces la extensión no
toca la red en ningún momento. La caché se borra sin perder nada:

```bash
rm -rf ~/.cache/spotify-menu
```

---

## Otros reproductores

Con **Seguir a cualquier reproductor** activado, cuando Spotify no está abierto
el indicador enseña lo que reproduzca cualquier otro programa que hable MPRIS:
el navegador, un reproductor de vídeo, el de música del escritorio. Con Spotify
abierto manda Spotify.

Mientras el reproductor que se está siguiendo siga en el bus no se cambia a otro
aunque aparezca: si no, el panel se pasaría el día bailando entre dos programas.
Lo que el reproductor no sepa hacer —saltar a un punto, traer su ventana al
frente— se ve apagado en el menú, porque cada programa implementa la parte de
MPRIS que quiere.

Para ver quién está publicando ahora mismo:

```bash
busctl --user list | grep mpris
```

---

## Privacidad

Lo que escuchas no sale de aquí:

- **No hay cuenta ni clave.** No se habla con la API web de Spotify, no se pide
  ningún token y no hay nada que iniciar sesión.
- **No se guarda un historial.** La extensión no apunta en ningún sitio lo que
  has escuchado: lee lo que hay sonando en ese momento y lo pinta. Lo único que
  queda en disco son las imágenes de las portadas, en `~/.cache/spotify-menu/`,
  sin nombres de canciones —el archivo se llama como el hash de su dirección— y
  se borran con un `rm -rf`.
- **El único tráfico de red es la portada**, contra el CDN del propio
  reproductor, y se puede apagar.
- **Los ajustes no llevan nada tuyo**: una plantilla de texto, unos cuantos
  interruptores y un número.

---

## Ajustes

| Ajuste | Por omisión | Qué hace |
|---|---|---|
| Seguir a cualquier reproductor | No | Sigue a otros programas cuando Spotify no está abierto |
| Mostrar el texto | Sí | Con esto quitado, en la barra queda solo el icono |
| Formato del texto | `{artista} — {titulo}` | Plantilla del texto de la barra |
| Longitud máxima | 30 | Caracteres antes de cortar con puntos suspensivos |
| Mostrar los controles | Sí | Anterior, reproducir/pausar y siguiente en la barra misma |
| Ocultar cuando no suena nada | Sí | Quita el indicador de la barra mientras no hay música |
| El icono dice si está sonando | Sí | Alterna entre reproducir y pausa; no se aplica con los controles puestos |
| Icono del panel | `audio-x-generic-symbolic` | El que se usa cuando no lo sustituye el estado |
| Mostrar la portada | Sí | Baja la portada del disco y la enseña en el menú |
| Mostrar por dónde va | Sí | Barra de progreso con los tiempos |
| El botón central reproduce o pausa | Sí | Atajo sobre el indicador |
| La rueda cambia de canción | No | Atajo sobre el indicador |
| Sitio en la barra | Derecha | En qué parte de la barra superior se pone el indicador |
| Posición | 4 | Orden dentro de esa parte, empezando por el 0 |

Desde consola, sin abrir las preferencias:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/spotify-menu@jorgemg1414/schemas set org.gnome.shell.extensions.spotify-menu panel-format '{titulo}'
```

---

## Requisitos

- GNOME Shell 48 (probado en 48.7, Debian 13, sesión Wayland)
- `glib-compile-schemas` — paquete `libglib2.0-dev-bin`
- `gir1.2-soup-3.0` para las portadas, que en Debian 13 ya viene con GNOME
- Un reproductor que hable MPRIS. El cliente oficial de Spotify lo hace; los
  paquetes de Flatpak y de Snap también

No hace falta ningún programa externo más: la extensión habla directamente con
el bus de sesión, que ya está ahí.

---

## Instalación

```bash
cd spotify-menu@jorgemg1414 && ./install.sh --enable
```

Copia los archivos a `~/.local/share/gnome-shell/extensions/`, compila el
esquema de GSettings y activa la extensión. Después hay que recargar GNOME
Shell: en Wayland, cerrar sesión y volver a entrar; en X11, `Alt+F2`, `r`,
Enter.

Para desinstalar (borra también la caché de portadas):

```bash
./install.sh --uninstall
```

---

## Depuración

Ver qué está publicando Spotify ahora mismo, que es exactamente lo que lee la
extensión:

```bash
busctl --user get-property org.mpris.MediaPlayer2.spotify /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2.Player Metadata
```

Y su estado:

```bash
busctl --user get-property org.mpris.MediaPlayer2.spotify /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2.Player PlaybackStatus
```

Errores de la extensión:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

**Si el indicador no aparece** con Spotify sonando, lo primero es comprobar que
Spotify está en el bus con el `busctl` de arriba. Hay versiones empaquetadas que
arrancan con MPRIS desactivado, y las que van dentro de un navegador publican el
nombre del navegador, no el de Spotify: para esas hace falta **Seguir a
cualquier reproductor**.

**Si no se ve la portada**, mira si el archivo llegó a bajarse:

```bash
ls -la ~/.cache/spotify-menu/
```

Vacío significa que la descarga no salió; el registro del shell dice por qué.

---

## Estructura

```
spotify-menu@jorgemg1414/
├── extension.js       Indicador, menú, controles y limpieza en disable()
├── mpris.js           Cliente de D-Bus: a quién seguir, qué suena y control
├── caratula.js        Descarga y caché de las portadas
├── prefs.js           Ventana de preferencias (libadwaita)
├── stylesheet.css     Estilos del menú
├── schemas/           Esquema de GSettings
└── install.sh         Instalador
```

Más el módulo compartido que `install.sh` copia de [`comun/`](../comun/):
`asyncgio.js` (envoltorios de `Promise` sobre las llamadas de Gio).

### Limpieza en `disable()`

GNOME exige que una extensión no deje nada vivo al desactivarse. Aquí se sueltan
la suscripción a `NameOwnerChanged` del bus, los proxies del reproductor, el
temporizador de la posición, los `Gio.Cancellable` de las consultas y de las
descargas, la sesión de libsoup y las señales conectadas a los ajustes y al
menú.

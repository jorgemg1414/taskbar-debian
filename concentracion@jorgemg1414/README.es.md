# Concentración

*[Read this in English](README.md)*

Un interruptor en la barra superior que apaga de golpe lo que interrumpe: No
molestar, la música y la dock. Al cumplirse el tiempo lo deja todo como estaba.

---

## Qué hace

Pulsando el indicador salen cuatro botones: **25**, **50**, **90 minutos** y
**sin límite**. Al elegir uno empieza la sesión y, mientras dure:

- **No molestar**, con el mismo interruptor que usa GNOME. Las notificaciones no
  se pierden: se quedan esperando en la bandeja del calendario.
- **Se pausa lo que esté sonando** —Spotify, el navegador, un reproductor de
  vídeo—, y al terminar se devuelve solo lo que se pausó.
- **La dock se esconde del todo**, no solo cuando hay ventanas encima: tampoco
  asoma al llevar el ratón al borde de la pantalla.

En la barra queda el tiempo que falta. Cuando llega a cero, el escritorio vuelve
a como estaba y salta un aviso. También se puede terminar antes, desde el menú.

Cada una de las tres cosas se puede quitar, y **tocarlas con una sesión en
marcha aplica o deshace esa parte al momento**, que es lo que uno espera al
darle al interruptor.

> **Atajo**: el botón central del ratón sobre el indicador empieza —o termina—
> una sesión sin abrir el menú, con la duración que digan las preferencias.

---

## Deshacer es lo importante

Nada de lo que apaga esta extensión es suyo: son ajustes de GNOME, ajustes de
Dash to Dock y órdenes a los reproductores. Encenderlo es fácil; lo que hay que
hacer bien es apagarlo.

- **Antes de tocar nada se apunta cómo estaba**, pieza por pieza.
- **Eso se guarda en GSettings, no en memoria.** Si el shell se reinicia en
  mitad de una sesión —o cierras sesión y vuelves—, al arrancar se retoma la
  cuenta atrás donde iba. Y si el plazo venció mientras tanto, se deshace todo
  en ese momento, en vez de dejarte el escritorio mudo hasta que te des cuenta.
- **Solo se devuelve lo que siga como lo dejó la extensión.** Si vuelves a
  encender los avisos a mano en mitad de la sesión, al terminar no se te
  vuelven a apagar: manda lo tuyo.
- **Se apunta qué reproductores estaban sonando**, así que al terminar no se le
  da a reproducir a lo que ya estaba en pausa antes de empezar.

Desactivar la extensión **no** termina la sesión, a propósito: cerrar sesión no
es «he acabado de concentrarme». Lo guardado permite deshacerlo al volver. Si
quieres asegurarte de que no queda nada pendiente, termina la sesión desde el
menú antes de desactivarla, o borra el rastro a mano:

```bash
dconf reset -f /org/gnome/shell/extensions/concentracion/
```

---

## La dock

Se usa la clave `manualhide` de **Dash to Dock**, que es la que la quita del
escritorio del todo. Su esquema no está en el sistema, sino dentro de la carpeta
de la propia extensión, así que se busca ahí cuando no aparece por las buenas.

Si no tienes Dash to Dock instalada, ese interruptor no hace nada y el resto
funciona igual. Otras docks —Ubuntu Dock, Dash to Panel— no están contempladas.

---

## Ajustes

| Ajuste | Por omisión | Qué hace |
|---|---|---|
| No molestar | Sí | Silencia los avisos mientras dure la sesión |
| Pausar la música | Sí | Pausa cualquier reproductor que hable MPRIS |
| Devolver la música al terminar | Sí | Solo lo que se pausó al empezar |
| Esconder la dock | Sí | La de Dash to Dock, del todo |
| Duración del atajo | 50 min | La que usa el botón central del ratón |
| Avisar al terminar | Sí | Notificación al cumplirse el plazo |
| Mostrar el tiempo que queda | Sí | Los minutos, en la barra |
| Icono del panel | `focus-windows-symbolic` | Cualquier icono simbólico del tema |
| Sitio en la barra | Derecha | En qué parte de la barra superior se pone el indicador |
| Posición | 5 | Orden dentro de esa parte, empezando por el 0 |

---

## Requisitos

- GNOME Shell 48 (probado en 48.7, Debian 13, sesión Wayland)
- `glib-compile-schemas` — paquete `libglib2.0-dev-bin`
- Opcional: **Dash to Dock**, para el interruptor de la dock

No hace falta ningún programa externo: lo que apaga son ajustes de GNOME y
llamadas por el bus de sesión, que ya está ahí.

---

## Instalación

```bash
cd concentracion@jorgemg1414 && ./install.sh --enable
```

Copia los archivos a `~/.local/share/gnome-shell/extensions/`, compila el
esquema de GSettings y activa la extensión. Después hay que recargar GNOME
Shell: en Wayland, cerrar sesión y volver a entrar; en X11, `Alt+F2`, `r`,
Enter.

Para desinstalar:

```bash
./install.sh --uninstall
```

---

## Depuración

Ver si hay una sesión guardada y qué había antes de empezarla:

```bash
dconf read /org/gnome/shell/extensions/concentracion/saved-state
```

El estado de No molestar, que es lo que mueve la extensión:

```bash
gsettings get org.gnome.desktop.notifications show-banners
```

Errores de la extensión:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

**Si la música no se pausa**, comprueba que el reproductor está en el bus:

```bash
busctl --user list | grep mpris
```

Los reproductores dentro del navegador publican el nombre del navegador, no el
de la web, pero se pausan igual.

---

## Estructura

```
concentracion@jorgemg1414/
├── extension.js       Indicador, sesión, cuenta atrás y limpieza en disable()
├── prefs.js           Ventana de preferencias (libadwaita)
├── stylesheet.css     Estilos del menú
├── schemas/           Esquema de GSettings
└── install.sh         Instalador
```

Más los módulos compartidos que `install.sh` copia de [`comun/`](../comun/):
`mpris.js` (pausar y devolver los reproductores), `barra.js` y `barraprefs.js`
(el sitio en la barra).

### Limpieza en `disable()`

GNOME exige que una extensión no deje nada vivo al desactivarse. Aquí se sueltan
el temporizador de la cuenta atrás, el `Gio.Cancellable` de las órdenes a los
reproductores y las señales conectadas a los ajustes y al menú. Lo que la sesión
haya cambiado se queda como está —ver [más arriba](#deshacer-es-lo-importante)—,
apuntado en los ajustes para poder devolverlo cuando la extensión vuelva.

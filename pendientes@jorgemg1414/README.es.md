# Pendientes

*[Read this in English](README.md)*

Indicador en la barra superior con las tareas sin hacer de tus archivos
Markdown. Al pulsar una, se marca en el archivo.

```
● 3

  ┌─────────────────────────────────┐
  │  Sucursales                     │
  │  ☐ Cambiar el disco de Bodega   │
  │  ☐ Pedir tóner para la L3560    │
  │  Casa                           │
  │  ☐ Comprar pan                  │
  │  ＋ Nueva  ↻ Recargar  ✎ Archivo │
  └─────────────────────────────────┘
```

---

## Qué lee

Las líneas de lista con casilla, que es como se escriben las tareas en Markdown
desde siempre:

```markdown
# Pendientes

## Sucursales
- [ ] Cambiar el disco de Bodega
- [x] Autorizar la clave en Mapelo
  - [ ] Comprobar que entra sin contraseña

## Casa
- [ ] Comprar pan
```

- **Se agrupan por el encabezado** que tengan encima, sea del nivel que sea. Lo
  que esté antes del primer encabezado va a «Sin encabezado».
- **Valen las tres viñetas** (`-`, `*`, `+`) y la equis en mayúscula o minúscula.
- **La sangría se respeta**: una subtarea se ve sangrada en el menú.
- **Los bloques de código se saltan.** Un `- [ ]` dentro de ``` es un ejemplo, no
  una tarea — este mismo README está lleno de ellos.
- **Las hechas no se muestran** por omisión: el menú es para lo que queda. Se
  pueden mostrar tachadas desde los ajustes.

Puedes apuntar a **un archivo** o a **una carpeta**. Con una carpeta se leen
todos sus `.md`, `.markdown` y `.txt` —sin entrar en subcarpetas— y cada tarea
lleva a la derecha de qué archivo salió.

**Se actualiza sola**: los archivos se vigilan con `Gio.FileMonitor`, así que si
editas uno en tu editor el menú cambia al momento.

---

## Qué escribe

Es la única extensión del repositorio que **escribe** en un archivo tuyo, y por
eso lo hace con más cuidado del que parece necesario:

- **Cambia un solo carácter**: el hueco de la casilla. La línea se parte en cinco
  trozos y cuatro se copian tal cual, con su sangría, su viñeta y sus espacios.
  Si tenías `-   [ ]   Comprar pan   `, sigues teniéndolo igual con una `x`
  dentro.
- **Relee el archivo justo antes de escribir** y comprueba que en esa línea
  sigue estando esa misma tarea con el estado que se esperaba. Si moviste cosas
  mientras el menú estaba abierto, no se toca nada y te lo dice.
- **Escribe con el etag** de lo que acaba de leer, así que si el archivo cambió
  entre medias —porque lo estabas editando— GIO rechaza la escritura en vez de
  pisar tu edición.
- **Nada más.** Ni reordena, ni normaliza, ni añade fechas, ni mueve las hechas
  al final. Tu archivo es tuyo.

Si algo de eso falla, la casilla del menú vuelve a como estaba y sale un aviso
con el motivo.

---

## Uso

| Gesto | Qué hace |
|---|---|
| Clic en una tarea | La marca o la desmarca en el archivo |
| Clic derecho | **Editar**, **Añadir debajo**, **Copiar** y **Borrar** |
| ↓ / ↑ | Recorrer la lista, también desde el buscador |
| Intro en el buscador | Marca la primera que coincida |
| **Nueva** | Apunta una tarea al final del archivo |
| **Recargar** | Vuelve a leer, sin cerrar el menú |
| **Abrir archivo** | Lo abre en tu editor. Si no existe, lo crea con un ejemplo |

El contador del panel dice cuántas quedan.

### Escribir sin abrir el editor

**Editar** y **Añadir debajo** abren un campo de texto en la propia fila:
escribes, Intro guarda y Escape lo deja como estaba. Lo mismo hace **Nueva** al
final de la lista.

- Al **editar** solo se sustituye lo que va detrás del corchete. La casilla, la
  sangría y la viñeta se quedan como estaban, así que una tarea ya marcada
  sigue marcada aunque le cambies la frase.
- Al **añadir debajo**, la tarea nueva hereda la sangría de aquella sobre la que
  pulsaste, que es lo que hace falta para apuntar una subtarea.
- **Nueva** la pone al final del archivo, antes de las líneas en blanco del
  cierre para que no quede suelta. Con una carpeta configurada va al archivo de
  la última tarea de la lista.
- **Borrar** se lleva la línea entera y es lo único que pregunta antes: una
  tarea marcada se desmarca, pero una borrada ya no está.

---

## Ajustes

Desde el menú → **Ajustes**, o con `gnome-extensions prefs pendientes@jorgemg1414`.

| Ajuste | Por omisión | Descripción |
|---|---|---|
| Archivo o carpeta | `~/Documentos/pendientes.md` | De dónde salen las tareas |
| Mostrar también las hechas | no | Salen tachadas al final de su grupo |
| Comando para abrir el archivo | vacío | `%f` es la ruta; vacío prueba gnome-text-editor, gedit, kate y xdg-open |
| Buscador en el menú | sí | Filtrar escribiendo |
| Mostrarlo a partir de | 10 | Tareas necesarias para que aparezca el buscador |
| Contador en el panel | sí | Cuántas quedan, junto al icono |
| Icono del panel | `checkbox-checked-symbolic` | Cualquier icono simbólico del tema |
| Barra superior | derecha, 4 | En qué zona de la barra va el indicador |

---

## Instalación

```bash
cd pendientes@jorgemg1414 && ./install.sh --enable
```

Después hay que recargar GNOME Shell: en Wayland, cerrar sesión y volver a
entrar; en X11, `Alt+F2`, `r` y Enter.

Para desinstalar:

```bash
./install.sh --uninstall
```

No hace falta ningún programa: se leen y se escriben archivos de texto con
`Gio`, y para escribir una tarea no hace falta salir del menú. Un editor solo
hace falta para **Abrir archivo**, y si no hay ninguno conocido se abre con la
aplicación predeterminada del sistema.

---

## Depuración

Ver qué tareas encuentra en un archivo, sin pasar por el menú:

```bash
grep -nE '^\s*[-*+]\s+\[[ xX]\]' ~/Documentos/pendientes.md
```

Si una tarea no sale, casi siempre es una de estas tres: está dentro de un
bloque de código, le falta el espacio entre la viñeta y el corchete, o la
casilla lleva algo que no es ni un espacio ni una equis.

Errores de la extensión:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

---

## Estructura

```
pendientes@jorgemg1414/
├── extension.js       Indicador, menú, marcado y limpieza en disable()
├── tareas.js          Parseo del Markdown y reescritura de la casilla
├── prefs.js           Ventana de preferencias (libadwaita)
├── stylesheet.css     Estilos del menú
├── schemas/           Esquema de GSettings
└── install.sh         Instalador
```

Más los módulos compartidos que `install.sh` copia de [`comun/`](../comun/):
`menu.js` (buscador, lista y fila de acciones), `asyncgio.js` (envoltorios de
`Promise` sobre Gio, incluidos los de leer y escribir con etag), `barra.js` y
`barraprefs.js` (el sitio en la barra).

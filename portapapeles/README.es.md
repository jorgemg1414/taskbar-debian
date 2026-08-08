# Portapapeles

*[Read this in English](README.md)*

El portapapeles de Debian recuerda una cosa. Copias la segunda y la primera ya
no existe. Esto le pone memoria: **CopyQ** guardando todo lo que copias, y dos
atajos para sacarlo.

```bash
./instalar.sh
```

Y para quitarlo:

```bash
./instalar.sh --desinstalar
```

---

## Los dos atajos

| Atajo | Qué sale |
|---|---|
| `Super+V` | La lista de lo último copiado, junto al ratón. Eliges y **se pega solo** donde estuviera el cursor |
| `Super+Shift+V` | La ventana entera, con buscador, para lo de hace días |

`Super+V` es para el día a día: copias tres cosas de un correo y las vas
soltando en el formulario sin volver atrás cada vez. `Super+Shift+V` es para
cuando te acuerdas de que copiaste una IP el martes y no sabes de dónde.

## Super+V estaba cogido

GNOME lo usa para abrir el panel de notificaciones. Pero **`Super+M` hace
exactamente lo mismo**, así que el instalador le deja `Super+M` y libera
`Super+V`. Si prefieres tenerlo como estaba:

```bash
gsettings reset org.gnome.shell.keybindings toggle-message-tray
```

…y cámbiale la combinación al atajo en Configuración → Teclado → Atajos
personalizados.

## Cómo queda configurado

| Ajuste | Valor | Por qué |
|---|---|---|
| `maxitems` | 500 | Los 200 de fábrica se quedan cortos en un día de trabajo |
| `activate_pastes` | sí | Elegir algo lo pega donde estuviera el cursor, sin `Ctrl+V` |
| `check_selection` | **no** | Guardar cada cosa que marcas con el ratón inundaría el historial |
| `move` | sí | Lo que usas sube al principio |
| `maxitem_size` | 512 KiB | Corta las capturas de pantalla enormes, no el texto |
| `autostart` | sí | Arranca con la sesión, en el área de notificación |

El icono de la bandeja —unas tijeras— sale porque ya tienes la extensión
`appindicatorsupport` activada. Si además pones
[`portapapeles@jorgemg1414/`](../portapapeles@jorgemg1414/) sobra, porque tienes
el mismo menú en la barra:

```bash
copyq config disable_tray true
```

CopyQ sigue funcionando igual: `Super+V` y `Super+Shift+V` no dependen del
icono. Para recuperarlo, lo mismo con `false`.

## Lo que conviene saber antes de usarlo

**Todo lo que copies queda escrito en el disco**, en `~/.local/share/copyq/`,
en claro. Eso incluye una contraseña que hayas copiado de un gestor, un token
que hayas sacado de un `curl`, o lo que copies mientras trasteas en Hack The
Box. No es un defecto de CopyQ: es lo que hace un historial de portapapeles.

Tres formas de convivir con ello:

- **Vaciarlo cuando toque:** en la ventana de CopyQ, `Ctrl+A` y `Supr`. O el
  botón *Vaciar* del menú de la barra, si tienes puesta la extensión
  [`portapapeles@jorgemg1414/`](../portapapeles@jorgemg1414/).
- **De uno en uno:** en la ventana de CopyQ, clic derecho sobre un elemento →
  *Remove*.
- **Que no llegue a guardarse:** en CopyQ, *Preferencias → Comandos → Añadir →
  Ignorar contraseñas*. Trae una regla hecha que descarta lo copiado desde las
  ventanas de los gestores de contraseñas conocidos.

## Qué toca de tu equipo

- Instala el paquete `copyq` de Debian.
- Crea dos atajos personalizados de GNOME en el primer `customN` libre —los
  tuyos, del `custom0` al `custom6`, se quedan donde están—.
- Quita `<Super>v` de `org.gnome.shell.keybindings toggle-message-tray`.
- `copyq config autostart true`, que escribe `~/.config/autostart/copyq.desktop`.

`--desinstalar` deshace las tres últimas. El paquete y el historial se quedan,
y te dice cómo borrarlos si es lo que quieres.

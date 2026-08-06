# Pendientes

*[Léeme en español](README.es.md)*

A top bar indicator listing the unfinished tasks in your Markdown files.
Clicking one ticks it in the file.

```
● 3

  ┌─────────────────────────────────┐
  │  Sucursales                     │
  │  ☐ Cambiar el disco de Bodega   │
  │  ☐ Pedir tóner para la L3560    │
  │  Casa                           │
  │  ☐ Comprar pan                  │
  │  ↻ Recargar   ✎ Editar   ⚙ Ajustes │
  └─────────────────────────────────┘
```

---

## What it reads

List lines with a checkbox — the way tasks have always been written in
Markdown:

```markdown
# Pendientes

## Sucursales
- [ ] Cambiar el disco de Bodega
- [x] Autorizar la clave en Mapelo
  - [ ] Comprobar que entra sin contraseña

## Casa
- [ ] Comprar pan
```

- **Grouped by the heading above them**, at any level. Anything before the first
  heading goes under "Sin encabezado".
- **All three bullets work** (`-`, `*`, `+`), and the x may be upper or lower
  case.
- **Indentation is kept**: a subtask appears indented in the menu.
- **Code blocks are skipped.** A `- [ ]` inside ``` is an example, not a task —
  this very README is full of them.
- **Done tasks are hidden** by default: the menu is for what's left. They can be
  shown struck through from the settings.

You can point it at **a file** or at **a folder**. With a folder it reads every
`.md`, `.markdown` and `.txt` in it — without descending into subfolders — and
each task shows which file it came from.

**It refreshes itself**: the files are watched with `Gio.FileMonitor`, so
editing one in your editor updates the menu right away.

---

## What it writes

This is the only extension in the repository that **writes** to a file of yours,
which is why it takes more care than may seem necessary:

- **It changes a single character**: the gap inside the checkbox. The line is
  split into five pieces and four are copied verbatim, with their indentation,
  bullet and spaces. If you had `-   [ ]   Comprar pan   `, you still have
  exactly that, with an `x` inside.
- **It re-reads the file right before writing** and checks that the same task,
  in the state it expected, is still on that line. If you moved things around
  while the menu was open, nothing is touched and it says so.
- **It writes with the etag** of what it just read, so if the file changed in
  between — because you were editing it — GIO rejects the write instead of
  overwriting your edit.
- **Nothing else.** No reordering, no normalising, no adding dates, no moving
  done items to the bottom. Your file is yours.

If any of that fails, the checkbox in the menu goes back to what it was and a
notification explains why.

---

## Usage

| Gesture | What it does |
|---|---|
| Click a task | Ticks or unticks it in the file |
| Right click | Copy its text, or open the file in your editor |
| ↓ / ↑ | Walk the list, including from the search field |
| Enter in the search field | Ticks the first match |
| **Recargar** | Re-reads without closing the menu |
| **Editar** | Opens the file in your editor. If it doesn't exist, creates it with an example |

The panel counter shows how many are left.

---

## Settings

Menu → **Ajustes**, or `gnome-extensions prefs pendientes@jorgemg1414`.

| Setting | Default | Description |
|---|---|---|
| File or folder | `~/Documentos/pendientes.md` | Where the tasks come from |
| Show done tasks too | no | They appear struck through at the end of their group |
| Command to open the file | empty | `%f` is the path; empty tries gnome-text-editor, gedit, kate and xdg-open |
| Search field | yes | Filter as you type |
| Show it from | 10 | Tasks needed for the search field to appear |
| Panel counter | yes | How many are left, next to the icon |
| Panel icon | `checkbox-checked-symbolic` | Any symbolic icon from the theme |
| Top bar | right, 4 | Which area of the bar the indicator goes in |

---

## Installation

```bash
cd pendientes@jorgemg1414 && ./install.sh --enable
```

Then reload GNOME Shell: on Wayland, log out and back in; on X11, `Alt+F2`, `r`
and Enter.

To uninstall:

```bash
./install.sh --uninstall
```

No external program is needed: text files are read and written through `Gio`. An
editor only matters for the **Editar** button, and if no known one is installed
the file opens with the system default.

---

## Debugging

To see which tasks it finds in a file, without going through the menu:

```bash
grep -nE '^\s*[-*+]\s+\[[ xX]\]' ~/Documentos/pendientes.md
```

If a task doesn't show up it's almost always one of three things: it's inside a
code block, the space between the bullet and the bracket is missing, or the
checkbox holds something that is neither a space nor an x.

Extension errors:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

---

## Layout

```
pendientes@jorgemg1414/
├── extension.js       Indicator, menu, ticking and cleanup in disable()
├── tareas.js          Markdown parsing and rewriting the checkbox
├── prefs.js           Preferences window (libadwaita)
├── stylesheet.css     Menu styles
├── schemas/           GSettings schema
└── install.sh         Installer
```

Plus the shared modules `install.sh` copies from [`comun/`](../comun/):
`menu.js` (search field, list and action row), `asyncgio.js` (`Promise` wrappers
around Gio, including reading and writing with an etag), `barra.js` and
`barraprefs.js` (the spot in the top bar).

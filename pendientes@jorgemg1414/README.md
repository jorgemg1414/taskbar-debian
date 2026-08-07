# Pendientes

*[Léeme en español](README.es.md)*

A top bar indicator listing the unfinished tasks in your Markdown files.
Clicking one ticks it in the file.

```
● 3

  ┌─────────────────────────────────┐
  │  Sucursales ──────────────── ＋  │
  │  ☐ Cambiar el disco de Bodega   │
  │  ☐ Pedir tóner para la L3560    │
  │  Casa ───────────────────── ＋  │
  │  ☐ Comprar pan                  │
  │  ＋Tarea ＋Grupo ↻Recargar ✎Archivo │
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
| Right click | ↑ ↓ to move it, → ← to indent it, plus **Editar**, **Añadir debajo**, **Copiar** and **Borrar** |
| **＋** on a heading | Jots a task down in that group |
| ↓ / ↑ | Walk the list, including from the search field |
| Enter in the search field | Ticks the first match |
| **Tarea** | Jots a task down at the end of the file |
| **Grupo** | Creates a new heading with its first task |
| **Recargar** | Re-reads without closing the menu |
| **Archivo** | Opens it in your editor. If it doesn't exist, creates it with an example |

The panel counter shows how many are left.

### Writing without opening the editor

**Editar**, **Añadir debajo** and the **＋** on each heading open a text field in
the row itself: you type, Enter saves and Escape leaves everything as it was.
**Tarea** and **Grupo** do the same at the end of the list.

- **Editing** replaces only what follows the bracket. The checkbox, indentation
  and bullet stay as they were, so a task already ticked stays ticked even if
  you reword it.
- **Adding below** gives the new task the indentation of the one you clicked,
  which is what you need to jot down a subtask. If that task has subtasks, the
  new one goes after all of them rather than in the middle.
- **The ＋ on a heading** puts the task at the end of that group, at the
  indentation of the group's first task: that's how you jot something down under
  "Casa" without it landing at the end of the file. It's what removes the last
  reason to open the editor.
- **Tarea** puts it at the end of the file, before the blank lines that close
  it so it doesn't end up stranded. With a folder configured it goes to the file
  of the last task in the list.
- **Grupo** asks two things, the name and the first task, because in the file
  they belong together: a heading with no checkbox under it wouldn't show up in
  the menu. It's written with the same heading level as the file's other groups.
- **Borrar** takes the whole line, and is the only one that asks first: a ticked
  task can be unticked, but a deleted one is gone.

### Reordering without opening the editor

The four arrows in the right-click row move the task around the file:

| Arrow | What it does |
|---|---|
| ↑ ↓ | Moves it up or down, swapping it with the task next to it |
| → | Turns it into a subtask of the one above |
| ← | Takes it back out, one step towards the margin |

- **The whole block moves**: a task with subtasks takes them along, and
  indenting it indents all of them.
- **No heading is ever crossed**: moving the first task of a group up doesn't
  push it into the group above. When it can't go any further nothing happens and
  no notification pops up, the same as reaching the end of a list.
- **The indentation is the file's own**: if you indent with tabs, the new
  subtask gets a tab; with nothing to go by, two spaces.
- The arrow row **stays put** after a move, so you can press it several times in
  a row without aiming with the mouse again.

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

No external program is needed: text files are read and written through `Gio`,
and writing a task never means leaving the menu. An editor only matters for
**Abrir archivo**, and if no known one is installed the file opens with the
system default.

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

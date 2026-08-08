# Clipboard

*[Léeme en español](README.es.md)*

The last things you copied, in the top bar.

```bash
./install.sh --enable
```

It needs **CopyQ**, which is where the history comes from. If you don't have
it, the [`portapapeles/`](../portapapeles/) folder installs it and sets up the
keyboard shortcuts:

```bash
../portapapeles/instalar.sh
```

---

## The history isn't its own

This extension **stores nothing**. It reads CopyQ's history — the same one
`Super+V` opens, the same one that's still there with the extension disabled —
and draws it.

That's deliberate. A history of its own would mean two lists that don't talk to
each other: you copy something with the menu closed, look for it later in the
CopyQ window and it isn't there, or the other way round. With one list there's
nothing to keep in sync.

It also asks nothing while the menu is closed: no timer, no clipboard watching.
It reads when the menu opens, and that's it.

## What each thing does

| Where | What happens |
|---|---|
| **Click an item** | Copies it to the clipboard and closes the menu. With *Pegar al elegir* on, it also pastes it where you were |
| **Right-click an item** | Opens its two actions underneath: **Copiar** (without pasting) and **Quitar** |
| **Typing in the search box** | Filters on the item's **whole text**, not just the line you can see. `↓`/`↑` walk the list and `Enter` uses the first one |
| **Abrir CopyQ** | The full window, for what doesn't fit in the menu |
| **Vaciar** | Clears the history. It asks first, in the menu itself |

## How each row reads

An item copied out of an editor comes with newlines and indentation, and in a
menu row that only stops you reading anything. It's drawn **on one line**, with
the extra whitespace collapsed and whatever doesn't fit cut off with an
ellipsis. The original isn't touched: what gets copied is the whole item, with
all its formats.

When the item has more than one line, the count shows on the right. That's the
only thing separating a two-hundred-line paragraph from the sentence you see.

An item that isn't text — a pasted image — shows in dim italics as *(sin
texto)*. It's shown rather than skipped so the numbering lines up with CopyQ's.

## Paste on select

It's **off** by default, and it's worth knowing why before turning it on.

What it does is send a `Ctrl+V` to whichever window had focus before the menu
opened, waiting 200 ms for focus to come back. That wait is the problem: if the
window takes longer, the keystroke is lost. It works well in most places and
so-so in some.

CopyQ's own `Super+V` doesn't have that problem, because it never takes focus
away from anyone. If what you want is fast pasting, that's the way; the top bar
menu is for looking at the list.

## Getting rid of the scissors in the tray

With the extension in place, CopyQ's tray icon — a pair of scissors — shows the
same menu twice:

```bash
copyq config disable_tray true
```

CopyQ carries on the same: neither `Super+V` nor this extension depends on that
icon, because both talk to its server, not its window. To get it back, the same
with `false`.

## Why there's no badge on the icon

The other extensions carry a number next to the icon: how many machines are
down, how many tasks are left. Not here, for two reasons. The first is that the
number would always be whatever cap CopyQ has set — no information at all. The
second is that the alternative, showing a snippet of the last thing you copied
in the bar, would put the password you just pulled out of your manager in plain
view of anyone walking past.

## Settings

In *Extensions → Portapapeles → Preferences*:

- **Items in the menu** (25) — CopyQ keeps many more; the ones that don't fit
  stay in its window. The more you ask for, the longer the menu takes to open.
- **Paste on select** (off) — see above.
- **Search box** (on, from 10 items).
- **Panel icon** and **place in the bar**.

## How it talks to CopyQ

Everything goes through `copyq eval` rather than the individual command-line
commands. The reason is in reading the history: `copyq read` returns the items
run together and you have to separate them with a character none of them
contains, and no such character exists when what you store is arbitrary text.
With `eval` you ask for JSON and there's nothing to invent.

The script goes as one more argument to the process, not through a shell, so
whatever quotes the copied text carries are its own and there's nothing to
escape.

## If something's wrong

The menu says so itself:

- **"CopyQ no está instalado"** — the package is missing.
- **"CopyQ está instalado, pero no en marcha"** — with a button to start it. It
  re-reads on its own a second later.
- **"CopyQ ha contestado algo que no se entiende"** — it answered, but not with
  the expected JSON. Usually a CopyQ version with a different scripting API;
  you can see it with:

  ```bash
  copyq eval -- 'print(JSON.stringify({total: size()}))'
  ```

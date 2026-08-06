# Shared modules

*[Léeme en español](README.es.md)*

Code used by more than one extension in this repository. **The original lives
here**; there are no copies inside the extension folders.

Each `install.sh` copies the modules its extension needs from here, alongside
its own files, into `~/.local/share/gnome-shell/extensions/<uuid>/`. What gets
installed is still self-contained — that is how GNOME loads extensions — but the
repository holds exactly one copy of each file.

---

## What lives here

| Module | What it does | Used by |
|---|---|---|
| `asyncgio.js` | `Promise` wrappers around the async `Gio` calls | all six extensions |
| `barra.js` | Places the indicator in the top bar per its settings, and moves it when they change | all six extensions |
| `barraprefs.js` | The two preference rows that pick that place | all six extensions |
| `checker.js` | TCP port checks: async, cancellable, queued | VNC, SSH, WoL, Machines |
| `hosts.js` | Reads and parses `~/.ssh/config`, including `Include` and grouping | SSH, WoL, Machines |
| `menu.js` | Menu pieces: action row, confirmation row, search field, scrolling list, badge and focus handling | VNC, SSH, Machines |
| `estilos.css` | The rules that look the same in every menu, prefixed `tb-` | VNC, SSH, WoL, Machines |
| `instalar.sh` | The installer: requirements, copying, schema and messages | all six extensions |
| `mpris.js` | What is playing and player control over D-Bus; and pausing everything at once | Spotify, Focus |
| `wol.js` | Magic packet, machine list, and MACs learned from the ARP table | WoL, SSH, VNC |

---

## Why this folder exists

`checker.js` and `asyncgio.js` were byte-for-byte duplicates in the VNC menu and
the SSH menu. `wol.js` existed in two places and **had already drifted**: the SSH
menu's copy learned MAC addresses from the ARP table, the Wake on LAN
extension's copy did not — which is exactly where it was most useful.

With a fourth extension in the repository the count would only grow, so the
original lives here and the copies are made at install time, not in git.

---

## Rules

- **A module moves here once two extensions use it.** If only one does, it
  belongs in that extension's folder (`connections.js`, `montajes.js`,
  `ventanas.js`, `vitales.js`… stay where they are).
- **`barra.js` is the only one that talks to the shell** (`Main.panel`). The
  rest are plain Gio and GLib, and can be tested outside GNOME. That is why the
  top bar's preference rows live separately in `barraprefs.js`: the preferences
  window is another process, without a shell.
- **Nothing here knows about any particular extension.** No settings of its own,
  no `metadata.json`, no UI strings: whatever it needs is passed in. That is why
  log warnings carry the module name (`[wol]`, `[hosts]`) instead of an
  extension name.
- **Changing something here means reinstalling every extension that uses it**,
  because each one has its own installed copy:

  ```bash
  for d in */install.sh; do (cd "$(dirname "$d")" && ./install.sh); done
  ```

- **The folder is required to install.** If you clone a single extension, its
  `install.sh` stops and tells you `comun/` is missing.

---

## The stylesheet

`estilos.css` is the exception to "copy the file as it is": GNOME loads a single
stylesheet per extension and can't import another one, so each `install.sh`
**prepends the shared rules to the extension's own** and writes the result as
the `stylesheet.css` that gets installed.

That is why those classes are prefixed `tb-` rather than per-extension: they are
the same rules for every menu, and keeping four copies under four prefixes only
served to let them drift apart.

---

## The installer

`instalar.sh` is never copied anywhere: each extension's `install.sh` sources
it, and keeps only what differs between them.

```bash
UUID="ssh-menu@jorgemg1414"
PROPIOS=(metadata.json extension.js prefs.js montajes.js)
COMUNES=(asyncgio.js barra.js checker.js hosts.js menu.js wol.js)
ESTILOS_COMUNES=si

requisitos() { ... }        # optional: whatever only this one needs

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../comun/instalar.sh"
```

Before, any fix to the installer had to be made six times.

---

## About `gettext`

The modules here don't import `gettext`: the translation function is passed in
by whoever uses them, because each extension has its own, tied to its
`gettext-domain`.

Worth knowing: **`_()` doesn't translate anything today**. All six extensions
declare their domain in `metadata.json`, but there isn't a single `.po` file in
the repository, so the call returns the string as it is. The strings are already
in Spanish, which is the language all of this is written in. The `_()` stays
because the day translations exist no code has to change, and because stripping
it from two hundred strings only to put it back would be silly work.

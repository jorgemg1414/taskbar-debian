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
| `asyncgio.js` | `Promise` wrappers around the async `Gio` calls | all four menus |
| `checker.js` | TCP port checks: async, cancellable, queued | VNC, SSH, WoL, Machines |
| `hosts.js` | Reads and parses `~/.ssh/config`, including `Include` and grouping | SSH, WoL, Machines |
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

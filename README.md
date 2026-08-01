# taskbar-debian

*[Léeme en español](README.es.md)*

Top bar customizations for **GNOME Shell** on **Debian 13 (trixie)**. Each
folder is a self-contained extension with its own `install.sh`.

The code is written against the modern extension API (ESM, GNOME 45+):
`import ... from 'gi://…'`, a class extending `Extension`, and full teardown in
`disable()`. Source comments are in Spanish.

---

## Contents

| Folder | Extension | What it does |
|---|---|---|
| [`vnc-menu@jorgemg1414/`](vnc-menu@jorgemg1414/) | **VNC Menu** | Top bar menu listing your saved VNC connections, grouped, with a reachability indicator |

---

## VNC Menu

A top bar indicator that reads a folder of connection files and turns it into a
menu. Clicking an entry opens your VNC client.

**What you get:**

- **Reads your files as they are.** Supports RealVNC Viewer `.vnc` (plain
  `Key=Value` text), TigerVNC/TightVNC `.vnc` (`host=` and `port=`), and
  `.remmina` (INI). The menu label is the filename without its extension.
- **Automatic grouping.** By subfolder, or by the labels inside each file
  (`Labels=` for RealVNC, `group=` for Remmina) when there are no subfolders.
- **Per-host status.** A green or red dot shows whether the port answers.
  Checks run asynchronously through `Gio.SocketClient` with a 2 s timeout, and
  only while the menu is open — with the menu closed nothing touches the
  network, unless you turn on background checks.
- **Search.** With many connections a filter field appears at the top of the
  menu: type part of a name or host, press Enter to connect to the first match.
- **Refreshes itself.** The folder is scanned with `Gio` and watched with
  `Gio.FileMonitor`, so adding, removing or editing a connection updates the
  menu right away — no shell reload.
- **Configurable commands.** `remmina -c vnc://%h:%p` by default, falling back
  to `vncviewer` or `xtigervncviewer` when Remmina isn't installed. Preferences
  window built with libadwaita.
- **Never touches your credentials.** The `Password`, `Identity` and
  `AuthCertificate` keys are dropped by the parser: never read, never passed on.

Adding, renaming or regrouping connections needs no changes to the extension —
they are just files in a folder. Step by step in
**[Managing your connections](vnc-menu@jorgemg1414/README.md#managing-your-connections)**.

> **A warning about connection files:** the password RealVNC stores in
> `Password=` is not a hash. It is the password encrypted with a fixed, publicly
> known key, and common tools recover the plaintext from it. Never commit your
> connections folder to a repository, not even a private one.

Full documentation (formats, settings, troubleshooting):
**[vnc-menu@jorgemg1414/README.md](vnc-menu@jorgemg1414/README.md)**

---

## Requirements

- GNOME Shell 48 (tested on 48.7, Debian 13, Wayland session)
- `glib-compile-schemas` — package `libglib2.0-dev-bin`
- A VNC client: `remmina` + `remmina-plugin-vnc`, or `tigervnc-viewer`

```bash
sudo apt install libglib2.0-dev-bin remmina remmina-plugin-vnc
```

---

## Installation

```bash
git clone https://github.com/jorgemg1414/taskbar-debian.git
```

```bash
cd taskbar-debian/vnc-menu@jorgemg1414 && ./install.sh --enable
```

The script copies everything to
`~/.local/share/gnome-shell/extensions/vnc-menu@jorgemg1414/`, compiles the
GSettings schema and enables the extension.

Then reload GNOME Shell:

- **Wayland:** log out and back in. There is no way to reload the shell in
  place.
- **X11:** `Alt+F2`, type `r`, press Enter.

Connections are read from `~/Documentos/VNC` by default. Change it in the
extension preferences.

To uninstall:

```bash
./install.sh --uninstall
```

---

## Troubleshooting

Extension errors show up in the GNOME Shell log:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Check that the shell knows about the extension:

```bash
gnome-extensions info vnc-menu@jorgemg1414
```

If it says it doesn't exist after installing, the session still needs a restart.

---

## Repository layout

```
taskbar-debian/
└── vnc-menu@jorgemg1414/
    ├── extension.js       Indicator, menu, client launching, teardown in disable()
    ├── connections.js     Async folder scanning and connection file parsing
    ├── checker.js         Port checks, asynchronous and cancellable
    ├── asyncgio.js        Promise wrappers around Gio's async calls
    ├── prefs.js           Preferences window (libadwaita)
    ├── stylesheet.css     Menu styles
    ├── schemas/           GSettings schema
    ├── install.sh         Installer
    ├── README.md          Detailed documentation (English)
    └── README.es.md       Detailed documentation (Spanish)
```

Any extension added later follows the same pattern: a folder named after its
UUID, with its own `install.sh` and README.

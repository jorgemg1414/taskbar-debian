# VNC Menu — a GNOME Shell 48 extension

*[Léeme en español](README.es.md)*

A top bar indicator listing your saved VNC connections. Clicking an entry
launches the VNC client; a green or red dot next to each name tells you whether
the machine answers.

- **UUID:** `vnc-menu@jorgemg1414`
- **Shell:** GNOME 48 (tested on GNOME Shell 48.7, Debian 13)
- **Default connections folder:** `~/Documentos/VNC`

---

## Installation

```bash
./install.sh --enable
```

This copies the files to `~/.local/share/gnome-shell/extensions/vnc-menu@jorgemg1414/`,
compiles the GSettings schema and enables the extension.

Then reload the shell:

- **X11:** `Alt+F2` → type `r` → Enter.
- **Wayland:** log out and back in. If you only changed the extension's code,
  disabling and re-enabling is enough:

```bash
gnome-extensions disable vnc-menu@jorgemg1414 && gnome-extensions enable vnc-menu@jorgemg1414
```

Uninstall:

```bash
./install.sh --uninstall
```

---

## Supported connection formats

The folder is scanned asynchronously (`Gio`) and watched with
`Gio.FileMonitor`, so adding, deleting or editing a file updates the menu by
itself, **without reloading the shell**.

### RealVNC Viewer (`.vnc`) — the main format

Plain `Key=Value` text, no INI sections:

```ini
FriendlyName=OFFICE
Host=server.example.net:5904
UserName=
Password=<encrypted string>
Labels=OFFICES/OFFICES (NORTH)
```

- **Menu label:** the filename without its extension (`OFFICE.vnc` → `OFFICE`).
- **Host and port:** from `Host=`. With no port, 5900 is used; a number below
  100 is read as a VNC *display* (`:4` → 5904).
- **Group:** from `Labels=`. When a file carries several labels, the one shared
  by **most** connections wins, and only the last segment after `/` is shown
  (`OFFICES/OFFICES (NORTH)` → *OFFICES (NORTH)*).
- **`Password`, `Identity` and `AuthCertificate` are ignored entirely**: they
  are encrypted, and the extension neither reads them nor passes them anywhere.

### Other formats

- **`.remmina`** (INI): `server=`, `group=`, `name=`. Launched with
  `remmina -c /path/to/file`.
- **TigerVNC/TightVNC style `.vnc`**: `host=` and `port=` as separate keys.

### Subfolders

Any subfolder inside the connections folder becomes a menu group (subfolders
take precedence over labels). Up to 4 levels deep are scanned.

---

## Usage

| Item | What it does |
|---|---|
| **Open sessions** | At the top of the menu, the VNC windows you already have open; clicking one brings its window to the front instead of opening a second session |
| Connection entry | Launches the VNC client through `Gio.Subprocess` (never blocks the shell) |
| Right click on an entry | Opens a row of actions below it: **Copy** the host, **Check** it now, **View file** in the file manager |
| Green dot | The port accepts connections |
| Red dot | Port closed, host unreachable, or the timeout expired |
| Yellow dot | Check in progress (or waiting its turn) |
| Grey dot | Not checked yet (or checks disabled) |
| Milliseconds | How long the host took to accept the connection, DNS lookup included |
| Panel counter | How many connections are not answering |
| **Reload** | Rescans the folder. Keeps the menu open, so you can watch entries and their status refresh |
| **Folder** | Opens the connections folder in Nautilus |
| **Settings** | Opens the extension settings |

The list scrolls: however many connections you have, the menu never grows past
about 60% of the screen and the action row stays in place.

### Keyboard

**↓/↑** walk through the visible connections, skipping group headers and
anything hidden by the filter, scrolling the list along the way. **↑** on the
first one returns focus to the search field. **Enter** launches the focused
connection.

### Search

With 8 connections or more, a search field appears at the top of the menu,
already focused: type and the list filters by **name, host and group**, ignoring
case and accents. **Enter** connects to the first match, **Escape** clears the
filter (or closes the menu if it is already empty). You can turn it off, or
change how many connections it takes for it to appear, in the preferences.

### When the network is used

Only **while the menu is open**: opening it checks every host and refreshes
every 60 s for as long as it stays visible. Closing it stops the refresh and
cancels in-flight checks, so with the menu closed the extension opens no
connections at all.

If you'd rather keep the status always current, preferences has **Check in the
background**, off by default. Bear in mind that it means as many TCP connections
as you have entries, every interval, including when you're away from the network
those machines live on.

Everything is asynchronous (`Gio.SocketClient`, 2 s timeout) and pending checks
are cancelled in `disable()`. At most **8 checks run at a time**; the rest queue
up and start as slots free, so twenty branches don't mean twenty simultaneous
sockets.

The **panel counter** shows how many hosts are down without opening the menu.
With the menu closed it only stays current if background checks are on —
otherwise it shows what was known the last time you looked.

---

## Managing your connections

The extension has no editor: **every menu entry is a file** in the connections
folder. Edit the file and the menu updates itself, because a `Gio.FileMonitor`
watches the folder. If something doesn't refresh, there's **Reload connections**
in the menu.

Quickest way to the folder: menu → **Open folder**.

### Edit with the program that created them

Safest option, since it keeps the encrypted keys consistent. With RealVNC
Connect Viewer:

```bash
/usr/lib/rvncconnect/rvncconnect
```

### Edit by hand

They're text files, so any editor works:

```bash
gnome-text-editor ~/Documentos/VNC/OFFICE.vnc
```

What the extension reads from each file:

| What you want to change | Where |
|---|---|
| Host or port | The `Host=server:port` line (`server=` in `.remmina`) |
| **Menu label** | **The filename**, not `FriendlyName=` |
| Group | The `Labels=` line, or the subfolder the file sits in |
| Username | `UserName=` |

Every other key (`Quality`, `Sequence`, `Uuid`, `ConnTime`…) is ignored — leave
them alone so your VNC client still understands the file.

### Rename an entry

The menu text comes from the filename, so renaming the file is enough:

```bash
mv ~/Documentos/VNC/OLDNAME.vnc "~/Documentos/VNC/NEW NAME.vnc"
```

### Add a new connection

Two lines will do; everything else is optional:

```bash
printf 'FriendlyName=NEW\nHost=server.example.net:5904\nLabels=OFFICES\n' > ~/Documentos/VNC/NEW.vnc
```

### Reorganize the groups

Subfolders take precedence over labels. To put **everything under a single
group**, move the files into a subfolder with that name:

```bash
mkdir -p ~/Documentos/VNC/OFFICES && mv ~/Documentos/VNC/*.vnc ~/Documentos/VNC/OFFICES/
```

To split by area, use one subfolder per group. The group title is the relative
path (`AREA/NORTH`), and up to 4 levels of nesting are supported.

This only changes where the files are, not their contents: passwords and your
VNC client's labels stay untouched. Note that if you later export a new
connection from the client, it will most likely land in the root of the folder
and show up as a separate group until you move it.

The alternative — making the `Labels=` line identical across every file — works
too, but those labels are what your VNC client uses to organize its own
connection tree, so you'd flatten that as well. Make a copy first:

```bash
cp -a ~/Documentos/VNC ~/Documentos/VNC.bak
```

### About passwords when connecting

The default command, `remmina -c vnc://%h:%p`, **does not open your file**: it
only uses the host and the port. That's why Remmina asks for the password the
first time (and stores it in its own keyring if you let it), ignoring the one
inside the `.vnc`.

If you'd rather open your files as they are, with the credentials they already
carry, change the `.vnc` command in preferences to your client's. For RealVNC
Connect Viewer, whose `-config` option loads every parameter from the file:

```
/usr/lib/rvncconnect/rvncconnect -config %f
```

That way the password never leaves the file. **Never put passwords in the
command**: they would be visible in `ps` to any process in your session, and
stored in cleartext under `~/.config/dconf`.

The other clean option is `.remmina` profiles, which keep the credential in the
GNOME keyring. [`herramientas/`](../herramientas/) holds two scripts that turn
your `.vnc` files into Remmina profiles and store the password in the keyring,
asking for it just once.

---

## Settings

Menu → **Preferences**, or `gnome-extensions prefs vnc-menu@jorgemg1414`.

| Setting | Default | Description |
|---|---|---|
| Folder | `~/Documentos/VNC` | Where to look for connections |
| `.vnc` files | `remmina -c vnc://%h:%p` | Connection command |
| `.remmina` files | `remmina -c %f` | Connection command |
| Open folder | `nautilus %f` | File manager |
| Open sessions | yes | VNC windows already open, at the top of the menu |
| Panel icon | `computer-symbolic` | Any symbolic icon from the theme |
| Panel down counter | yes | How many connections aren't answering, next to the icon |
| Show host and port | yes | `host:port` to the right of the name |
| Search field | yes | Filter as you type |
| Show it from | 8 | Connections needed for the search field to appear |
| Check availability | yes | Green/red dot |
| Show latency | yes | Milliseconds each host takes to answer |
| Refresh while menu is open | 60 s | Between checks while you're looking at the menu |
| Check in the background | 0 (off) | Seconds between checks with the menu closed |
| Timeout | 2 s | Before considering a host down |

**Command placeholders:** `%h` host · `%p` port · `%u` username · `%n` name ·
`%f` file path.

Substitution happens **after** the command is split into arguments, so a host or
path containing spaces can't sneak in as extra arguments.

**Automatic fallbacks:** if the configured program isn't installed, these are
tried in order: `remmina -c vnc://%h:%p`, `vncviewer %h:%p`,
`xtigervncviewer %h:%p` and `gvncviewer %h:%p`. If none exists, an error
notification is shown.

Settings can also be changed from a terminal:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/vnc-menu@jorgemg1414/schemas set org.gnome.shell.extensions.vnc-menu vnc-command 'xtigervncviewer %h:%p'
```

---

## Troubleshooting

Live shell log — this is where the extension's JavaScript errors appear, tagged
with `[vnc-menu]`:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Only this extension's messages:

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i vnc-menu
```

Errors since the current session started:

```bash
journalctl -b -o cat /usr/bin/gnome-shell | grep -iE "vnc-menu|error"
```

Extension status:

```bash
gnome-extensions info vnc-menu@jorgemg1414
```

Preferences window with output on the terminal (handy for debugging `prefs.js`):

```bash
gnome-extensions prefs vnc-menu@jorgemg1414
```

Check a host by hand, the same way the extension does:

```bash
timeout 2 bash -c 'cat < /dev/null > /dev/tcp/server.example.net/5904' && echo OPEN || echo CLOSED
```

### Common problems

- **No menu after installing:** the shell needs reloading (see above), or the
  extension needs enabling with `gnome-extensions enable vnc-menu@jorgemg1414`.
- **Preferences won't open / "Schema not found":** the schema wasn't compiled.
  Run `./install.sh` again, it calls `glib-compile-schemas`.
- **Every dot is red:** check your firewall or VPN, or raise the timeout in
  preferences if the network is slow.
- **Nothing happens when clicking:** check `journalctl` and try the command by
  hand, e.g. `remmina -c vnc://server.example.net:5904`.

---

## Code layout

| File | Contents |
|---|---|
| `extension.js` | Panel indicator, menu, client launching, teardown in `disable()` |
| `connections.js` | Async folder scanning and connection file parsing |
| `checker.js` | Port checks with `Gio.SocketClient`, with cancellation — from [`comun/`](../comun/) |
| `asyncgio.js` | `Promise` wrappers around Gio's async calls — from [`comun/`](../comun/) |
| `prefs.js` | Preferences window (libadwaita) |
| `schemas/` | GSettings schema |
| `stylesheet.css` | Styles for the status dots and notices |

Source comments are in Spanish.

### Teardown in `disable()`

A GNOME requirement this extension meets: the indicator is destroyed, timers are
removed with `GLib.source_remove()`, the `Gio.Cancellable` objects (folder scan
and network checks) are cancelled, `Gio.FileMonitor` instances are disconnected
and cancelled, and every `GSettings` and menu signal is disconnected.

# taskbar-debian

*[Léeme en español](README.es.md)*

Top bar customizations for **GNOME Shell** on **Debian 13 (trixie)**. Each
folder is a self-contained extension with its own `install.sh`.

The code is written against the modern extension API (ESM, GNOME 45+):
`import ... from 'gi://…'`, a class extending `Extension`, and full teardown in
`disable()`. Source comments are in Spanish.

---

## Contents

| Folder | Contents |
|---|---|
| [`vnc-menu@jorgemg1414/`](vnc-menu@jorgemg1414/) | **VNC Menu** — top bar menu listing your saved VNC connections, grouped, with a reachability indicator |
| [`ssh-menu@jorgemg1414/`](ssh-menu@jorgemg1414/) | **SSH Menu** — the machines in your `~/.ssh/config`: terminal session or SFTP, from the same row |
| [`wol-menu@jorgemg1414/`](wol-menu@jorgemg1414/) | **Wake on LAN** — power machines on remotely from the top bar |
| [`equipos-menu@jorgemg1414/`](equipos-menu@jorgemg1414/) | **Machines** — how each machine is doing inside, and powering it off, rebooting or suspending it remotely |
| [`spotify-menu@jorgemg1414/`](spotify-menu@jorgemg1414/) | **Spotify** — the song that's playing, with its cover art and controls |
| [`herramientas/`](herramientas/) | Helper scripts: turn `.vnc` files into Remmina profiles and store their password in the GNOME keyring |
| [`comun/`](comun/) | Modules shared by several extensions. The original lives here; each `install.sh` copies the ones it needs |

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
- **Per-host status.** A green or red dot shows whether the port answers, with
  the response time in milliseconds beside it. Checks run asynchronously through
  `Gio.SocketClient` with a 2 s timeout, at most 8 at a time, and only while the
  menu is open — with the menu closed nothing touches the network, unless you
  turn on background checks.
- **Down count in the panel.** How many connections aren't answering, next to
  the icon, so you don't have to open the menu to find out.
- **Open sessions.** The VNC windows you already have open are listed at the top
  of the menu: clicking one brings it to the front instead of opening a second
  session against the same machine.
- **Search.** With many connections a filter field appears at the top of the
  menu: type part of a name or host, ↓/↑ to walk the results, Enter to connect.
- **Right click on a connection** for its own actions: copy the host, check it
  now, or open the file in the file manager. And **wake the machine** if it
  isn't answering: the MAC, which a `.vnc` file doesn't carry, comes from the
  machines in the Wake on LAN extension or is learned from the ARP table.
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

## SSH Menu

The same idea applied to `~/.ssh/config`: every `Host` block becomes a menu
entry, so shell and files for a machine sit in the same row.

- **Clicking a machine runs `ssh <alias>`** in a terminal — ssh itself applies
  the user, port, key and `ProxyJump` from your config.
- **The button on the right opens it over SFTP** in the file manager. GVfs
  mounts it and the file manager asks for the password: the extension never
  touches credentials.
- **Mounts stay listed** at the top of the menu, with an eject button, because
  an SFTP connection outlives the window you opened it from.
- **Same machinery as the VNC menu:** grouping (here by `# Group: NAME`
  comments), green/red dot with latency, down counter in the panel, search
  field, and `Gio.FileMonitor` on the config files.
- **Machines behind a `ProxyJump` aren't checked** — they don't accept a direct
  connection, so a red dot would be a lie. They show `⇢ <jump>` instead.
- **A machine that isn't answering can be powered on right there**, with the
  magic packet, and with nothing to configure: the MAC is learned from the ARP
  table while the machine is up, since the menu already talks to it to paint the
  green dot. It can also be written by hand with a `# MAC:` comment.

Full documentation (grouping, commands, jump hosts, troubleshooting):
**[ssh-menu@jorgemg1414/README.md](ssh-menu@jorgemg1414/README.md)**

---

## Machines

The same machines from `~/.ssh/config`, but reporting **how they are doing
inside**. The green dot in the other menus says port 22 accepts connections;
this one goes in and asks.

- **A summary per machine**: how long it's been up, how much memory and disk it
  has left, how many updates are pending. A nearly full disk is painted red.
- **It asks with `ssh <alias>`** and `BatchMode` on, so no password dialog ever
  appears: if the key isn't authorised it says so, and that's what
  `herramientas/autorizar-clave.sh` fixes.
- **One connection per machine.** With `ControlMaster` the first query pays for
  the full SSH handshake and the rest travel through the same tunnel. Nothing is
  asked while the menu is closed.
- **Works the same for Windows**, which answers the same things through
  PowerShell. Each machine's system is worked out once.
- **Power off, reboot and suspend** from the right-click row, confirmed inside
  the menu. They are the only actions in the repository that can't be undone
  from the taskbar, so they aren't on the plain click.

> Linux won't let an SSH session power it off unless you allow it first. The
> extension's README carries the polkit rule and the sudoers line that do, and
> spells out what each one means.

Full documentation (remote querying, power, permissions, debugging):
**[equipos-menu@jorgemg1414/README.md](equipos-menu@jorgemg1414/README.md)**

---

## Spotify

What song is playing, without opening anything: artist and title in the bar,
and in the menu the cover art, the album, how far in it is, and the buttons.

- **It asks the player itself** over D-Bus, through the standard MPRIS interface
  GNOME already uses for its media controls. No account to link, no web API key,
  and nothing leaving the machine.
- **The controls in the bar itself**: previous, play/pause and next, without
  opening the menu. Clicking them doesn't open it: the click stays on the button.
- **You write the bar**: `{artista} — {titulo}` by default, as long as you like,
  or just the icon.
- **The cover art is downloaded once** and kept in `~/.cache`; coming back to a
  song doesn't touch the network again. It can be turned off entirely.
- **Dragging the progress bar seeks** to another point in the song, and buttons
  the player wouldn't act on are dimmed instead of pretending.
- **Middle click to pause** without opening the menu, and the scroll wheel to
  change track if you enable it.
- **It works with other players too**: with Spotify closed it can follow the
  browser, or anything else that speaks MPRIS.

> With the menu closed the indicator only listens. Position, which nobody
> announces over D-Bus, is polled once a second and only while the menu is open.

Full documentation (cover art, other players, settings, troubleshooting):
**[spotify-menu@jorgemg1414/README.md](spotify-menu@jorgemg1414/README.md)**

---

## Helper scripts

`.vnc` files carry their password encrypted with RealVNC's own key, which
Remmina cannot use — so Remmina asks for it on every connection. These scripts
fix that once and for all:

```bash
cd herramientas && ./vnc-a-remmina.sh
```

Creates one `.remmina` profile per `.vnc` file (name, server, username, group)
in `~/.config/remmina`. No passwords are copied.

```bash
./guardar-password.sh
```

Asks for a password once, without echoing it, and stores it in the GNOME
keyring for every profile — using the same `org.remmina.Password` schema Remmina
reads from. Pass profile paths as arguments to do only some of them. The
password is piped in, never passed as an argument, so it never shows up in `ps`
or your shell history.

### Getting in without a password

```bash
./autorizar-clave.sh <target> [more targets...]
```

Authorises your public key on the remote machine, which is what removes the
password from all three routes at once: the SSH session, the terminal `sftp` and
mounting the folder in Files. The target is whatever you'd hand to `ssh`: an
alias from `~/.ssh/config` — the ones listed in the menu — or `user@host`.

It knows where the key goes on each system, which is exactly what makes
`ssh-copy-id` fail against Windows:

| System | File |
|---|---|
| Linux, BSD | `~/.ssh/authorized_keys`, mode 600 |
| Windows, ordinary account | `%USERPROFILE%\.ssh\authorized_keys` |
| Windows, administrator account | `%ProgramData%\ssh\administrators_authorized_keys` |

That last one is the tricky one: `sshd` only reads it if the ACL grants nothing
beyond SYSTEM and Administrators, and when it doesn't match it ignores the key
**silently**. The script fixes it with `icacls`, granting **by SID** rather than
by group name, because on a Spanish Windows the group is called
«Administradores» and `icacls` would fail.

To work out which of the three files to use, it first asks what system is on the
other side: `uname -s`, then `cmd /c ver` if that doesn't exist, and PowerShell
as a last resort — all three are needed because a Windows machine's default
shell may be `cmd` or PowerShell, and they don't understand the same things. If
it still can't tell, it touches nothing and **shows what the machine answered**,
which is what you need to work out why. The question can be skipped:

```bash
./autorizar-clave.sh --sistema windows <target>
```

The password is asked for by `ssh`: the script never reads it, stores it or puts
it on a command line. It opens a single multiplexed connection per machine, so
it only has to be typed once. And only the public half of the key travels — hand
it a private key by mistake and it refuses to send anything.

Then point the extension at the profiles:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/vnc-menu@jorgemg1414/schemas set org.gnome.shell.extensions.vnc-menu connections-dir '~/.config/remmina'
```

---

## Where they sit in the bar

GNOME doesn't let you reorder the top bar: each extension asks for its place as
it loads. The five here take it from their settings — **Top bar** in their
preferences — with the part of the bar (left, centre or right) and the order
within it. Changing it moves the indicator right away, no reload.

They ship on the right, in this order:

| Extension | Position |
|---|---|
| VNC | 0 |
| Wake on LAN | 1 |
| SSH | 2 |
| Machines | 3 |
| Spotify | 4 |

If the number goes past the indicators already in that part, the extension's
own ends up last. And it only governs these five: ordering third-party ones as
well takes an organiser extension, which then decides for everyone.

> **The number is the slot the indicator is inserted into as the extension
> loads, not a fixed position.** GNOME's own indicators live in that part of the
> bar too, and extensions don't always load in the same order, so two of them
> with consecutive numbers can end up swapped. Trying a couple of numbers until
> it looks right sorts it out: the change shows up immediately.

From the console, without opening the preferences:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/spotify-menu@jorgemg1414/schemas set org.gnome.shell.extensions.spotify-menu panel-box 'left'
```

The placing is done by [`comun/barra.js`](comun/), shared by all five.

---

## Requirements

- GNOME Shell 48 (tested on 48.7, Debian 13, Wayland session)
- `glib-compile-schemas` — package `libglib2.0-dev-bin`
- For the VNC menu: `remmina` + `remmina-plugin-vnc`, or `tigervnc-viewer`
- For the SSH menu: `openssh-client`, and `gvfs-backends` for SFTP
- For the Machines menu: `openssh-client`, and your key authorised on each
  remote machine (`herramientas/autorizar-clave.sh`)
- For the Spotify menu: a player that speaks MPRIS — the official client does —
  and `gir1.2-soup-3.0` for the cover art, which already ships with GNOME

```bash
sudo apt install libglib2.0-dev-bin remmina remmina-plugin-vnc openssh-client gvfs-backends
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
├── herramientas/          Helper scripts (see above)
├── comun/                 Shared modules (see its own README)
│   ├── asyncgio.js        Promise wrappers around Gio's async calls
│   ├── checker.js         Port checks, asynchronous and cancellable
│   ├── hosts.js           Reads and parses ~/.ssh/config
│   └── wol.js             Magic packet, machine list, MACs learned from ARP
├── ssh-menu@jorgemg1414/  SSH Menu (see its own README)
├── wol-menu@jorgemg1414/  Wake on LAN (see its own README)
├── equipos-menu@jorgemg1414/  Machines (see its own README)
├── spotify-menu@jorgemg1414/  Spotify (see its own README)
└── vnc-menu@jorgemg1414/
    ├── extension.js       Indicator, menu, client launching, teardown in disable()
    ├── connections.js     Async folder scanning and connection file parsing
    ├── ventanas.js        Finds the windows of open VNC sessions
    ├── prefs.js           Preferences window (libadwaita)
    ├── stylesheet.css     Menu styles
    ├── schemas/           GSettings schema
    ├── install.sh         Installer
    ├── README.md          Detailed documentation (English)
    └── README.es.md       Detailed documentation (Spanish)
```

Any extension added later follows the same pattern: a folder named after its
UUID, with its own `install.sh` and README. Anything used by more than one
extension moves up into `comun/`, and each `install.sh` copies it from there at
install time: one file per thing in the repository, and what gets installed is
still self-contained.

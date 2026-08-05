# SSH Menu

*[Léeme en español](README.es.md)*

A top bar indicator listing the machines in your `~/.ssh/config`. Every machine
carries all three ways in on its own row: shell, files in a window, and files on
the command line.

---

## The three ways in

```
 ●  north         usuario@10.20.0.5    12 ms   [📁] [⇅]
 └─ click ─ ssh in the terminal          │    └─ sftp in the terminal (get, put)
                                         └─ the folder in the file manager
```

| Action | How | What it runs |
|---|---|---|
| SSH session | Click the row, or Enter in the search box | `ssh <alias>` in the terminal |
| Remote folder | 📁 button, Ctrl+click, or Ctrl+Enter | The `sftp://…` URL in the file manager |
| Transfer from the shell | ⇅ button, Shift+click, or Shift+Enter | `sftp <alias>` in the terminal |
| Machine actions | Right click | Copy, check, edit its block |

All three use the **alias**, never `user@host`: that way `ssh` and `sftp` are the
ones applying the user, port, key and `ProxyJump` from your config. The
extension doesn't reimplement it.

Both buttons can be hidden independently in the settings; the keyboard shortcuts
keep working even when they aren't shown.

---

## What it does

- **Reads your config as it is.** Every `Host` block in `~/.ssh/config` becomes a
  menu entry. `Include` directives are followed, so a config split across
  several files shows up too.
- **SFTP both ways.** The folder button opens `sftp://…` in the file manager, for
  drag and drop; the arrows button opens `sftp <alias>` in the terminal, for
  `get`, `put`, `ls` and `cd`. GVfs does the mounting for the graphical one and
  the file manager asks for the password or key passphrase: **the extension
  never touches credentials**.
- **Mounted folders at the top of the menu.** SFTP connections stay alive after
  you close the Files window; the menu lists them and unmounts them with one
  click on the eject button.
- **Per-machine status.** A green or red dot shows whether the SSH port answers,
  with the response time next to it. Checked asynchronously with
  `Gio.SocketClient`, eight at a time at most, and only while the menu is open:
  with the menu closed the network is left alone unless you turn on background
  checks.
- **Down counter in the panel**, so you don't have to open the menu to look.
- **Search field.** With many machines a filter appears: type part of the alias,
  host or user, ↓/↑ walk the results, Enter opens the session (with Ctrl or
  Shift, the other two ways in).
- **Right-click on a machine** for its own actions: copy `ssh <alias>`, check it
  now, open the file where it is defined in the editor and, when it isn't
  answering, **power it on**.
- **Keeps itself up to date.** The config files are watched with
  `Gio.FileMonitor`: adding or editing a block updates the menu right away, with
  no shell reload.

---

## How machines are grouped

Just as the VNC menu groups by subfolder, this one groups by comment. A
`# Grupo: NAME` line (`# Group:` works too) marks every block that follows it,
until the next group comment:

```sshconfig
# Group: BRANCHES

Host north
    HostName 10.20.0.5
    User usuario

Host south
    HostName 10.30.0.5
    User usuario

# Group: SERVERS

Host backups
    HostName backups.internal
    User root
```

It's an ordinary comment: `ssh` ignores it, so nothing breaks.

If your config is split with `Include`, machines from each included file are
grouped by the file name without its extension (`clients.conf` → *clients*
group), unless that file brings its own group lines.

---

## What is read from each block

| Directive | What it's used for |
|---|---|
| `Host` | The alias: the name you see and what gets passed to `ssh` |
| `HostName` | The real host, for the availability check and the SFTP mount |
| `Port` | Port for the check and for SFTP; shown when it isn't 22 |
| `User` | User shown in the row and used in the SFTP URL |
| `ProxyJump` | Marks the machine as "through another one" and skips its check |

Wildcard patterns aren't concrete machines, so they don't show up in the menu:
`Host *` is used as defaults for the rest (typically `User` and `Port`) and
anything else (`Host *.example.net`, `Host !something`) is dropped. `Match`
blocks are ignored entirely, since they are conditional.

No credential key is read: the extension never opens `IdentityFile`, never talks
to the agent, and stores no passwords anywhere.

---

## Machines behind a jump host

A machine with `ProxyJump` doesn't accept a direct connection from yours, so
checking its port would report it down even when it works perfectly. Those
machines are therefore **not checked**: the dot stays grey and `⇢ <jump>` appears
next to the alias as a reminder of the route.

The terminal session works normally, because `ssh` opens it with your config.
SFTP may not mount: GVfs runs its own `ssh` against the real host, without going
through the jump. If you need it, the usual answer is a tunnel on the side:

```bash
ssh -f -N -L 2222:internal:22 jumphost
```

plus a `Host internal-tunnel` block pointing at `localhost` port `2222`.

---

## Powering on a machine that's down

When a machine shows a red dot, right-clicking offers **Encender** (power on):
the Wake-on-LAN magic packet goes out without a trip to the other menu. The
action only shows up when the machine **isn't answering** — if it answers it's
already on — and when its MAC is known.

Usually there is **nothing to configure**: while a machine answers, the menu
learns its MAC on its own. You can still write it down by hand, and then yours
wins. The three places it comes from, in order of preference:

**1. A comment in its block**, which is the most direct and travels along with
the rest of your config:

```sshconfig
# MAC: aa:bb:cc:dd:ee:ff
# Difusión: 192.168.10.255
Host north
    HostName 192.168.10.5
    User usuario
```

All three ways of writing a MAC work (`aa:bb:…`, `aa-bb-…`, `aabbcc…`), and the
comment can sit above the `Host` line or inside the block. The broadcast address
is optional: without it, `255.255.255.255` is used, which only reaches your own
network.

**2. The machines in the Wake on LAN extension**, if you have it installed. They
are read from its settings and matched **by name**: the machine's name there has
to equal the alias of the `Host` block (or its `HostName`). That way the MAC
isn't written down twice.

**3. The system's ARP table**, which is where it comes from with no effort on
your part. To paint the green dot the menu opens a socket against each machine;
that conversation leaves the machine's MAC recorded in `/proc/net/arp`, and it
is copied from there while the machine is up. It's kept, so the day it shows red
the packet can already be sent.

Two limits worth knowing:

- **Same network segment only**, and IPv4 only. If reaching a machine means
  crossing a router, what's in the table is the router's MAC and not the
  machine's, so those entries are dropped: only a row whose IP is exactly the
  machine's is accepted. It's the same boundary Wake-on-LAN itself has, since it
  doesn't cross routers.
- **It has to have been seen up once.** Nothing can be learned about a machine
  that was already down the first time you saw it.

Both can be turned off in the settings, and what has been learned is cleared
with the **Olvidar** button: it fills up again by itself.

> Since the protocol has no reply, the notification says "packet sent", not
> "machine on": that's the only thing that can honestly be claimed. And it only
> works if the target machine was set up for it beforehand — that's covered in
> the [Wake on LAN README](../wol-menu@jorgemg1414/README.md).

---

## Settings

From the menu → **Ajustes**, or with `gnome-extensions prefs ssh-menu@jorgemg1414`.

| Setting | Default | Description |
|---|---|---|
| Config file | `~/.ssh/config` | Where the `Host` blocks are read from |
| Show user@host | yes | The real target to the right of the alias |
| Panel icon | `utilities-terminal-symbolic` | Any symbolic icon from the theme |
| Down counter | yes | How many machines don't answer, next to the icon |
| Search field | yes, from 8 machines | Filter box at the top of the menu |
| File manager button | yes | The per-row 📁; hidden, Ctrl+click still works |
| Terminal sftp button | yes | The per-row ⇅; hidden, Shift+click still works |
| Mounted folders | yes | The list of SFTP mounts at the top of the menu |
| Power on from the menu | yes | "Encender" on right-click for a down machine with a MAC |
| Learn the MAC on its own | yes | Copies it from the ARP table while the machine answers |
| Remote start folder | empty | Empty lands you in your home on the server |
| Check availability | yes | The green/red dot |
| Show latency | yes | Response time in milliseconds |
| Refresh with menu open | 60 s | How often it re-checks while you look |
| Background checks | 0 (off) | With the menu closed; 0 leaves the network alone |
| Timeout | 2 s | Before calling a machine down |

### Commands

All three are templates with placeholders, substituted **after** the command is
split into arguments: an alias with spaces can't turn into extra arguments.

| Placeholder | Value |
|---|---|
| `%n` | Alias of the `Host` block |
| `%h` | Real host (`HostName`) |
| `%p` | Port |
| `%u` | User |
| `%d` | `user@host` |
| `%f` | Config file the machine is defined in |
| `%s` | `sftp://…` URL |

| Command | Default |
|---|---|
| Open SSH session | `tilix -e "ssh %n"` |
| Open SFTP in the file manager | empty (`nautilus %s`, or whichever you have) |
| Open sftp in a terminal | `tilix -e "sftp %n"` |
| Edit config | `gnome-text-editor %f` |

If the configured program isn't installed, alternatives are tried: for the
terminal, `gnome-terminal`, `ptyxis`, `kgx`, `konsole`, `xfce4-terminal`,
`alacritty`, `kitty`, `x-terminal-emulator` and `xterm`; for the editor,
`gedit`, `kate` and `xdg-open`.

**About Tilix:** its `-e` runs the command directly, without a shell, which is
why the template quotes `ssh %n` — that way it arrives as a single command. Also
mind the Tilix profile, which by default **closes the window as soon as the
command exits** (`exit-action` = `close`): if the connection fails, the error
goes with it. To be able to read it, this variant waits for a keypress when
`ssh` exits with an error:

```
tilix -e "bash -c 'ssh %n || read -n1 -s -p \"[Enter] para cerrar\"'"
```

For SFTP, with no command configured it tries `nautilus`, `nemo`, `caja`,
`thunar`, `dolphin` and `pcmanfm`, always with the URL as an argument. To have it
opened by something else, that's what the template is for:

```
nautilus %s
```

**Why the file manager is launched instead of just "opening the URL":** on Debian
13 no application declares `x-scheme-handler/sftp`, so the standard GIO route
(`launch_default_for_uri`, or `gio open`) answers *"The specified location is not
mounted"* without ever trying to mount it. Check it with:

```bash
gio mime x-scheme-handler/sftp
```

Nautilus, on the other hand, mounts it itself when handed the URL as an
argument.

---

## If you don't have a config yet

That's the normal case: `~/.ssh/config` doesn't exist until you create it. The
menu says so, and **Editar config** creates it with a commented example and
`600` permissions before opening the editor.

A minimal block is this:

```sshconfig
Host myserver
    HostName 192.168.1.10
    User usuario
```

From then on `ssh myserver` works in the terminal and the machine shows up in
the menu.

---

## Installation

```bash
cd ssh-menu@jorgemg1414 && ./install.sh --enable
```

GNOME Shell then has to be reloaded: on Wayland, log out and back in; on X11,
`Alt+F2`, `r` and Enter.

Requirements, besides GNOME Shell 48:

```bash
sudo apt install libglib2.0-dev-bin openssh-client gvfs-backends
```

`gvfs-backends` is what lets the file manager open `sftp://` at all. A normal
Debian GNOME install already has it.

To uninstall:

```bash
./install.sh --uninstall
```

---

## Debugging

Extension errors:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

If a machine shows grey with checks enabled, look for `ProxyJump`: those are
skipped on purpose.

If SFTP won't mount, try the same thing by hand to see the real error:

```bash
gio mount sftp://user@host
```

And to see what is mounted right now:

```bash
gio mount --list
```

---

## Layout

```
ssh-menu@jorgemg1414/
├── extension.js       Indicator, menu, launching and cleanup in disable()
├── montajes.js        Mounted SFTP folders (Gio.VolumeMonitor)
├── prefs.js           Preferences window (libadwaita)
├── stylesheet.css     Menu styles
├── schemas/           GSettings schema
└── install.sh         Installer
```

Plus the shared modules `install.sh` copies from [`comun/`](../comun/):
`hosts.js` (reads `~/.ssh/config`), `checker.js` (port checks), `wol.js` (magic
packet and machine MACs) and `asyncgio.js` (`Promise` wrappers around the Gio
calls).

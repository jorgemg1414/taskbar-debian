# SSH Menu

*[Léeme en español](README.es.md)*

A top bar indicator listing the machines in your `~/.ssh/config`. Clicking one
opens the SSH session in a terminal; the button on the right opens that same
machine over **SFTP** in the file manager.

The point is having shell and files in one place: same machine, same row, two
ways in.

---

## What it does

- **Reads your config as it is.** Every `Host` block in `~/.ssh/config` becomes a
  menu entry. `Include` directives are followed, so a config split across
  several files shows up too.
- **Opens the session by alias.** The command launched is `ssh <alias>`, not
  `ssh user@host`: that way ssh itself applies the user, port, key, `ProxyJump`
  and everything else in the block. The extension doesn't reimplement your
  config.
- **SFTP in the same row.** The button on the right opens `sftp://…` in the file
  manager. GVfs does the mounting and the file manager asks for the password or
  key passphrase: **the extension never touches credentials**.
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
  host or user, ↓/↑ walk the results, Enter opens the session and Ctrl+Enter the
  SFTP.
- **Right-click on a machine** for its own actions: copy `ssh <alias>`, check it
  now, or open the file where it is defined in the editor.
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
    User jorge

Host south
    HostName 10.30.0.5
    User jorge

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

## Settings

From the menu → **Ajustes**, or with `gnome-extensions prefs ssh-menu@jorgemg1414`.

| Setting | Default | Description |
|---|---|---|
| Config file | `~/.ssh/config` | Where the `Host` blocks are read from |
| Show user@host | yes | The real target to the right of the alias |
| Panel icon | `utilities-terminal-symbolic` | Any symbolic icon from the theme |
| Down counter | yes | How many machines don't answer, next to the icon |
| Search field | yes, from 8 machines | Filter box at the top of the menu |
| SFTP button | yes | The per-row button; Ctrl+click still works without it |
| Mounted folders | yes | The list of SFTP mounts at the top of the menu |
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
| Open SFTP | empty (`nautilus %s`, or whichever you have) |
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
    User jorge
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
├── hosts.js           Reads and parses ~/.ssh/config, Include directives and all
├── checker.js         Port checks, asynchronous and cancellable
├── montajes.js        Mounted SFTP folders (Gio.VolumeMonitor)
├── asyncgio.js        Promise wrappers around the Gio calls
├── prefs.js           Preferences window (libadwaita)
├── stylesheet.css     Menu styles
├── schemas/           GSettings schema
└── install.sh         Installer
```

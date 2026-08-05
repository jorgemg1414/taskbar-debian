# Machines

*[Léeme en español](README.es.md)*

A top bar indicator that tells you **how each machine in your `~/.ssh/config` is
doing**, and lets you **power it off, reboot or suspend it** without opening a
terminal.

It is the next step after the green dot in this repository's other menus: that
one says port 22 accepts connections; this one goes in and asks.

```
● equipo-taller     ↑ 14 d · RAM 41% · / 78% · 12 act.
● backup-server     ↑ 96 d · RAM 12% · / 94%
● north-office      the key isn't authorised on the machine
● laptop            no answer
```

---

## What it shows

For each machine that answers:

| Value | Where it comes from on Linux | On Windows |
|---|---|---|
| Uptime | `/proc/uptime` | `Win32_OperatingSystem.LastBootUpTime` |
| Load average | `/proc/loadavg` | CPU usage (`Win32_Processor`) |
| Memory used | `/proc/meminfo` | `Win32_OperatingSystem` |
| Disk used on `/` (or `C:`) | `df -P /` | `Win32_LogicalDisk` |
| Pending updates | `apt-get -s upgrade` | Windows Update agent |

The **dot** on the left is a different thing and runs on its own: it comes from
opening port 22, which takes milliseconds, while the full query takes seconds.
That way you see who's up straight away, and the detail arrives afterwards.

When something fails, the reason replaces the summary: the key isn't authorised,
no answer, the name doesn't resolve… Stale readings from a machine that stopped
answering are never shown.

---

## How it asks

It runs **`ssh <alias>`**, exactly what you would type in a terminal, so ssh
itself applies the user, port, key and `ProxyJump` from your configuration. The
extension reimplements none of that.

Three decisions worth knowing about:

- **`BatchMode=yes`: no password is ever asked for.** If the key isn't
  authorised on the machine, the query fails and says so, which is precisely
  what needs fixing — with
  [`herramientas/autorizar-clave.sh`](../herramientas/autorizar-clave.sh). A
  shell extension is no place for a password dialog.
- **`ControlMaster`: one connection per machine.** The first query pays for the
  full SSH handshake; the rest travel through the same tunnel, which stays alive
  for two minutes. Refreshing six machines every minute doesn't open six
  connections every minute.
- **Nothing is asked while the menu is closed.** No probes, no queries, no open
  connections.

The remote command travels in one piece with no quoting to get wrong: on Linux
it goes through `sh -c` with GLib doing the quoting; on Windows it goes through
`powershell -EncodedCommand`, which receives it as base64 so `cmd` never touches
it.

### Windows machines

Each machine's system is worked out once, by asking `uname -s || ver`: on Linux
`uname` answers, on Windows `ver` does.

That works with Windows' OpenSSH as it ships, which hands commands to `cmd`. If
you changed the default shell to PowerShell, the question isn't understood and
you have to say so by hand, with a comment in its block:

```
# Sistema: windows
Host office-pc
    HostName 192.168.10.50
    User usuario
```

---

## Power off, reboot and suspend

They live in each machine's **right-click** row, not the plain click, and they
ask for confirmation inside the menu. They are the only actions in this whole
repository that can't be undone from the taskbar.

A plain click, by contrast, does nothing irreversible: it just asks again.

The commands are configurable because no single one fits everyone:

| | Linux | Windows |
|---|---|---|
| Power off | `systemctl poweroff` | `shutdown /s /t 0` |
| Reboot | `systemctl reboot` | `shutdown /r /t 0` |
| Suspend | `systemctl suspend` | `rundll32.exe powrprof.dll,SetSuspendState 0,1,0` |

### "Interactive authentication required"

This is the failure almost everyone hits, and it isn't the extension's fault:
**logind won't let an SSH session power the machine off**. As far as it is
concerned a remote session is "inactive" — you aren't sitting at the machine —
and for that it demands administrator authentication, which SSH has no way to
provide.

There are two ways to allow it **on the machine you want to switch off**. Either
one, not both.

**1. With a polkit rule**, which is the tidier option: it authorises the action,
not a command. In `/etc/polkit-1/rules.d/49-apagado-remoto.rules`:

```javascript
// Let members of the sudo group power off, reboot and suspend, including from
// an SSH session.
polkit.addRule(function (action, subject) {
    var acciones = [
        "org.freedesktop.login1.power-off",
        "org.freedesktop.login1.power-off-multiple-sessions",
        "org.freedesktop.login1.reboot",
        "org.freedesktop.login1.reboot-multiple-sessions",
        "org.freedesktop.login1.suspend",
        "org.freedesktop.login1.suspend-multiple-sessions",
    ];
    if (acciones.indexOf(action.id) >= 0 && subject.isInGroup("sudo"))
        return polkit.Result.YES;
});
```

The `-multiple-sessions` variants are the ones consulted when other users are
logged in, which is exactly the case you'll run into.

**2. With sudo**, if you'd rather not touch polkit. In a file under
`/etc/sudoers.d/` (create it with `visudo -f`):

```
usuario ALL=(root) NOPASSWD: /usr/bin/systemctl poweroff, /usr/bin/systemctl reboot, /usr/bin/systemctl suspend
```

Then, in the extension's preferences, prefix the commands with `sudo -n`:
`sudo -n systemctl poweroff`. The `-n` matters: without it sudo would sit
waiting for a password nobody is going to type.

> Allowing this means **anyone who can log in over SSH with that account can
> switch the machine off**. That is exactly what you're asking for, but it is
> worth saying out loud.

### On Windows

`shutdown` needs the privilege to power the machine off. With an administrator
account it just works; with an ordinary account it may answer "Access is
denied", and then you need an administrator account or that privilege granted.

The suspend command **hibernates instead of suspending** if hibernation is
enabled on the machine. That's `SetSuspendState`'s doing, not ours; turn it off
with `powercfg /hibernate off`.

### When the connection drops

A machine going down cuts the SSH connection while it is still serving it, so
`ssh` usually exits with an error even when everything worked. "Connection
closed by remote host" errors are counted as success, which is what they are:
the machine obeying.

After a power command the machine turns yellow and is looked at again fifteen
seconds later, so the dot tells the truth instead of what was there before.

---

## Settings

Menu → **Ajustes**, or `gnome-extensions prefs equipos-menu@jorgemg1414`.

| Setting | Default | Description |
|---|---|---|
| Configuration file | `~/.ssh/config` | Where the machines come from, `Include` and all |
| Refresh while menu is open | 60 s | Between queries while you're looking at the menu |
| Count pending updates | yes | Adds the count to the query; costs about a second per machine |
| Warn about disk from | 90 % | Percentage at which the figure turns red |
| Connect timeout | 5 s | ssh's `ConnectTimeout` |
| Reuse the connection | yes | `ControlMaster`: a single SSH connection per machine |
| Shared connection lifetime | 120 s | `ControlPersist` |
| Check availability | yes | The green or red dot, by probing the port |
| Probe timeout | 2 s | Before considering a machine down |
| Panel counter | yes | How many machines aren't answering, next to the icon |
| Panel icon | `utilities-system-monitor-symbolic` | Any symbolic icon from the theme |
| Ask for confirmation | yes | Before powering off, rebooting or suspending |
| Power commands | see above | Three for Linux and three for Windows |

Machines are grouped with the same `# Grupo: NAME` comments the
[SSH menu](../ssh-menu@jorgemg1414/) uses, because they read the same file.

---

## Requirements

- GNOME Shell 48
- `openssh-client` on your machine, and your key authorised on each remote one
- On Linux machines: nothing to install, it all comes from `/proc` and `df`
- On Windows machines: OpenSSH Server, which Windows ships itself

```bash
sudo apt install openssh-client
```

---

## Installation

```bash
cd equipos-menu@jorgemg1414 && ./install.sh --enable
```

Then reload GNOME Shell: on Wayland, log out and back in; on X11, `Alt+F2`, `r`
and Enter.

To uninstall:

```bash
./install.sh --uninstall
```

---

## Debugging

First, check by hand what the extension does. If this answers, so will the menu:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=5 equipo-taller 'uname -s; cat /proc/uptime'
```

If it asks for a password or says "Permission denied", the key isn't authorised:

```bash
cd herramientas && ./autorizar-clave.sh equipo-taller
```

To see which shared connections are alive right now:

```bash
ls /run/user/$(id -u)/equipos-menu-*
```

Extension errors:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

---

## Layout

```
equipos-menu@jorgemg1414/
├── extension.js       Indicator, menu, power actions and cleanup in disable()
├── vitales.js         SSH querying, remote scripts, parsing and formatting
├── prefs.js           Preferences window (libadwaita)
├── stylesheet.css     Menu styles
├── schemas/           GSettings schema
└── install.sh         Installer
```

Plus the shared modules `install.sh` copies from [`comun/`](../comun/):
`hosts.js` (reads `~/.ssh/config`), `checker.js` (port probing) and
`asyncgio.js` (`Promise` wrappers around the Gio calls).

### Cleanup in `disable()`

GNOME requires an extension to leave nothing running when it is disabled. Here
that means releasing the timers (refresh, deferred reload and the fifteen-second
wait after a power command), the `Gio.Cancellable`s of queries and actions, the
`Gio.FileMonitor`s on the configuration files, and every signal connected to the
settings and the menu.

`ControlMaster`'s shared connections deliberately outlive `disable()`: they
belong to the system, not to the extension, and close themselves once their
`ControlPersist` expires.

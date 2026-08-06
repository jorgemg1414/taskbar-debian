# Helper scripts

*[Léeme en español](README.es.md)*

Standalone scripts for what the extensions can't do from the taskbar: touching
the configuration of remote machines and the GNOME keyring. You run them by
hand, when you need them.

| Script | What it does |
|---|---|
| `autorizar-clave.sh` | Authorises your public key on a remote machine, Linux or Windows |
| `vnc-a-remmina.sh` | Turns your `.vnc` files into Remmina profiles |
| `guardar-password.sh` | Stores a password in the GNOME keyring for the Remmina profiles |
| `guardar-password.js` | The part that does the work, through libsecret |
| `despertar.sh` · `despertar.ps1` · `encender-pc.bat` | Send the Wake-on-LAN packet from a terminal, on Linux and on Windows |

---

## `autorizar-clave.sh`

```bash
./autorizar-clave.sh <target> [more targets...]
```

The one you'll use most: without the key authorised, the Machines menu can't ask
anything and the SSH menu asks for a password on every connection.

The target is whatever you'd hand to `ssh`: an alias from `~/.ssh/config` — the
ones listed in the menus — or `user@host`.

It knows where the key goes on each system, which is exactly what makes
`ssh-copy-id` fail against Windows:

| System | File |
|---|---|
| Linux, BSD | `~/.ssh/authorized_keys`, mode 600 |
| Windows, ordinary account | `%USERPROFILE%\.ssh\authorized_keys` |
| Windows, administrator account | `%ProgramData%\ssh\administrators_authorized_keys` |

To work out which of the three, it asks first: `uname -s`, then `cmd /c ver` if
that doesn't exist, and PowerShell as a last resort. All three are needed
because a Windows machine's default shell may be `cmd` or PowerShell. If it
still can't tell, it touches nothing and shows what the machine answered. The
question can be skipped with `--sistema windows`.

The password is asked for by `ssh`: the script never reads it, stores it or puts
it on a command line. And only the public half of the key travels — hand it a
private one by mistake and it stops instead of sending it.

---

## The rest

They are covered in detail in the
[repository README](../README.md#helper-scripts), which is where their place in
the whole makes sense: converting RealVNC connections to Remmina, not having to
type their password again, and waking machines from a terminal without going
through the menu.

They all carry their own help:

```bash
./autorizar-clave.sh --ayuda
```

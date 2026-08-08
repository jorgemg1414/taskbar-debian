# Clipboard

*[Léeme en español](README.es.md)*

The Debian clipboard remembers one thing. Copy a second one and the first is
gone. This gives it a memory: **CopyQ** keeping everything you copy, and two
shortcuts to get it back out.

```bash
./instalar.sh
```

And to remove it:

```bash
./instalar.sh --desinstalar
```

---

## The two shortcuts

| Shortcut | What comes up |
|---|---|
| `Super+V` | The list of recent items, next to the mouse. Pick one and it **pastes itself** wherever the cursor was |
| `Super+Shift+V` | The full window, with a search box, for things from days ago |

`Super+V` is the everyday one: copy three things out of an email and drop them
into a form without going back each time. `Super+Shift+V` is for when you
remember copying an IP on Tuesday and have no idea where from.

## Super+V was taken

GNOME uses it to open the notification panel. But **`Super+M` does exactly the
same thing**, so the installer leaves it on `Super+M` and frees up `Super+V`.
If you'd rather have it the way it was:

```bash
gsettings reset org.gnome.shell.keybindings toggle-message-tray
```

…and change the shortcut's key combination in Settings → Keyboard → Custom
Shortcuts.

## How it ends up configured

| Setting | Value | Why |
|---|---|---|
| `maxitems` | 500 | The stock 200 don't last a working day |
| `activate_pastes` | yes | Picking an item pastes it where the cursor was, no `Ctrl+V` |
| `check_selection` | **no** | Storing everything you highlight with the mouse would flood the history |
| `move` | yes | What you use moves to the top |
| `maxitem_size` | 512 KiB | Cuts off huge screenshots, not text |
| `autostart` | yes | Starts with the session, in the notification area |

The tray icon — a pair of scissors — shows up because you already have the
`appindicatorsupport` extension enabled. If you also install
[`portapapeles@jorgemg1414/`](../portapapeles@jorgemg1414/) it's redundant,
since you have the same menu in the bar:

```bash
copyq config disable_tray true
```

CopyQ keeps working the same: `Super+V` and `Super+Shift+V` don't depend on the
icon. To get it back, the same with `false`.

## Worth knowing before you use it

**Everything you copy gets written to disk**, in `~/.local/share/copyq/`, in
the clear. That includes a password you copied out of a manager, a token you
pulled from a `curl`, or whatever you copy while poking around Hack The Box.
It isn't a flaw in CopyQ: it's what a clipboard history does.

Three ways to live with it:

- **Empty it when it's time:** in the CopyQ window, `Ctrl+A` and `Del`. Or the
  *Vaciar* button in the top bar menu, if you have the
  [`portapapeles@jorgemg1414/`](../portapapeles@jorgemg1414/) extension.
- **One at a time:** in the CopyQ window, right-click an item → *Remove*.
- **Stop it being stored at all:** in CopyQ, *Preferences → Commands → Add →
  Ignore passwords*. It ships a ready-made rule that discards anything copied
  from the windows of known password managers.

## What it touches on your machine

- Installs the Debian `copyq` package.
- Creates two GNOME custom shortcuts in the first free `customN` — yours,
  `custom0` through `custom6`, stay where they are.
- Removes `<Super>v` from `org.gnome.shell.keybindings toggle-message-tray`.
- Runs `copyq config autostart true`, which writes
  `~/.config/autostart/copyq.desktop`.

`--desinstalar` undoes the last three. The package and the history stay put,
and it tells you how to delete them if that's what you want.

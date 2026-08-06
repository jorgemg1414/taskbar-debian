# Focus

*[Léeme en español](README.es.md)*

A switch in the top bar that turns off everything that interrupts at once: Do
Not Disturb, the music and the dock. When the time is up it puts it all back.

---

## What it does

Clicking the indicator offers four buttons: **25**, **50**, **90 minutes** and
**no limit**. Picking one starts the session, and while it lasts:

- **Do Not Disturb**, through the same switch GNOME itself uses. Notifications
  aren't lost: they wait in the calendar tray.
- **Whatever is playing gets paused** — Spotify, the browser, a video player —
  and when the session ends only what was paused is resumed.
- **The dock hides completely**, not just when windows are in the way: it won't
  peek out when you take the pointer to the edge of the screen either.

The bar shows the time left. At zero the desktop goes back to how it was and a
notification pops up. It can also be ended early, from the menu.

Each of the three can be turned off, and **toggling one during a session applies
or undoes that piece right away**, which is what flipping a switch should do.

> **Shortcut**: middle-clicking the indicator starts — or ends — a session
> without opening the menu, for the duration set in the preferences.

---

## Undoing is the hard part

Nothing this extension turns off belongs to it: they're GNOME settings, Dash to
Dock settings, and orders to media players. Turning them off is easy; putting
them back is the part that has to be right.

- **How things were is written down before anything is touched**, piece by
  piece.
- **That is stored in GSettings, not in memory.** If the shell restarts
  mid-session — or you log out and back in — the countdown picks up where it
  was. And if the deadline passed in the meantime, everything is undone right
  then, instead of leaving your desktop mute until you notice.
- **Only what still looks the way the extension left it is restored.** If you
  turn notifications back on by hand mid-session, they won't be silenced again
  at the end: your choice wins.
- **Which players were playing is remembered**, so nothing that was already
  paused before the session gets started up at the end.

Disabling the extension does **not** end the session, deliberately: logging out
isn't "I'm done concentrating". What's stored lets it be undone when it comes
back. To be sure nothing is left pending, end the session from the menu before
disabling it, or clear the trace by hand:

```bash
dconf reset -f /org/gnome/shell/extensions/concentracion/
```

---

## The dock

It uses **Dash to Dock**'s `manualhide` key, the one that takes it off the
desktop entirely. Its schema isn't installed system-wide but inside the
extension's own folder, so that's where it's looked up when it doesn't turn up
the easy way.

Without Dash to Dock installed that switch does nothing and the rest works the
same. Other docks — Ubuntu Dock, Dash to Panel — aren't covered.

---

## Settings

| Setting | Default | What it does |
|---|---|---|
| Do Not Disturb | Yes | Silences banners for the length of the session |
| Pause the music | Yes | Pauses any MPRIS-speaking player |
| Resume the music afterwards | Yes | Only what was paused at the start |
| Hide the dock | Yes | Dash to Dock's, completely |
| Shortcut duration | 50 min | Used by the middle mouse button |
| Notify when done | Yes | A notification when the time is up |
| Show the time left | Yes | The minutes, in the bar |
| Panel icon | `focus-windows-symbolic` | Any symbolic icon from the theme |
| Place in the bar | Right | Which part of the top bar the indicator goes in |
| Position | 5 | Order within that part, starting at 0 |

---

## Requirements

- GNOME Shell 48 (tested on 48.7, Debian 13, Wayland session)
- `glib-compile-schemas` — package `libglib2.0-dev-bin`
- Optional: **Dash to Dock**, for the dock switch

Nothing else is needed: what it turns off are GNOME settings and calls over the
session bus, which is already there.

---

## Installation

```bash
cd concentracion@jorgemg1414 && ./install.sh --enable
```

Copies the files to `~/.local/share/gnome-shell/extensions/`, compiles the
GSettings schema and enables the extension. GNOME Shell then has to be
reloaded: on Wayland, log out and back in; on X11, `Alt+F2`, `r`, Enter.

To uninstall:

```bash
./install.sh --uninstall
```

---

## Troubleshooting

See whether a session is stored, and what things looked like before it started:

```bash
dconf read /org/gnome/shell/extensions/concentracion/saved-state
```

The Do Not Disturb state, which is what the extension moves:

```bash
gsettings get org.gnome.desktop.notifications show-banners
```

Extension errors:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

**If the music isn't paused**, check that the player is on the bus:

```bash
busctl --user list | grep mpris
```

Players running inside a browser publish the browser's name rather than the
site's, but they get paused all the same.

---

## Layout

```
concentracion@jorgemg1414/
├── extension.js       Indicator, session, countdown and teardown in disable()
├── prefs.js           Preferences window (libadwaita)
├── stylesheet.css     Menu styles
├── schemas/           GSettings schema
└── install.sh         Installer
```

Plus the shared modules `install.sh` copies from [`comun/`](../comun/):
`mpris.js` (pausing and resuming the players), `barra.js` and `barraprefs.js`
(the place in the top bar).

### Teardown in `disable()`

GNOME requires an extension to leave nothing running when it's disabled. Here
that means releasing the countdown timer, the `Gio.Cancellable` of the orders
sent to the players, and every signal connected to the settings and the menu.
Whatever the session changed stays changed — see [above](#undoing-is-the-hard-part) —
recorded in the settings so it can be put back when the extension returns.

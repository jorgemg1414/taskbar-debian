# Spotify

*[Léeme en español](README.es.md)*

A top bar indicator showing the song that's playing: title, artist, album, cover
art, how far in it is, and the buttons to skip or pause it.

---

## How it works

Spotify — like nearly every desktop player — publishes what it's playing on the
session bus through the standard **MPRIS** interface (`org.mpris.MediaPlayer2`).
Title, artist, album, cover art URL, duration and playback status are all there,
and the same interface takes the commands to pause or skip.

It's the interface GNOME itself uses for the media controls in the notification
area. What this extension adds is having it in the bar, in plain sight, without
opening anything.

That means **there is no account to link, no web API key to store and no data
leaving this machine**: the program itself is doing the telling, locally. The
one exception is the cover art, which is downloaded from the URL the player
publishes — see [below](#cover-art).

> With the player closed there's nothing to ask and nothing is asked: by default
> the indicator leaves the bar until there's music again.

---

## What you see

### In the bar

Artist and title, cut to thirty characters, and the three controls —
**previous, play/pause and next** — so you don't have to open anything.
Clicking them doesn't open the menu: the click stays on the button.

All of that is configurable: the format — `{titulo}`, `{artista}` and
`{album}` —, the length, whether the text shows at all or just the icon, and
whether the controls are there.

With the controls on, the icon on the left stays put: the play button already
says whether it's playing, and two similar icons side by side end up
contradicting each other. Without the controls, the icon follows the playback
state again (and can be turned off with **The icon shows the state**).

### In the menu

- **The album cover**, exactly as the player publishes it.
- **Title, artist and album**, one per line. Clicking them **goes to the Spotify
  window**, which is what you want to do most of the time after checking what's
  playing.
- **How far into the song it is**, with elapsed and total time. The bar can be
  dragged to seek.
- **Previous, play/pause and next.** Buttons the player wouldn't act on right
  now are dimmed instead of pretending to do something.
- **Copy the song's link**, which is what you paste into a chat when someone
  asks what you're listening to.

Position is the only thing that has to be fetched: MPRIS doesn't announce it —
it would change a thousand times a second — so it's polled **once a second, and
only while the menu is open**. With the menu closed the indicator just listens
to what the player announces on its own when the track or the state changes.

---

## Mouse shortcuts

| On the indicator | What it does |
|---|---|
| Click | Opens the menu |
| Middle click | Play or pause, without opening the menu |
| Scroll wheel | Next or previous track |

Middle click is on by default; the wheel is **not**, because it's easy to brush
past it on the way across the bar and skip a song by accident. Both are settings.

---

## Cover art

MPRIS doesn't send the image, it sends its URL. Spotify's points at its CDN
(`i.scdn.co`), so it has to be downloaded. What comes down is stored in
`~/.cache/spotify-menu/`, named after the hash of the URL, and read from disk
from then on: changing tracks and coming back doesn't hit the network again.

- Only `http://` and `https://` URLs are requested, and only the ones the player
  itself publishes.
- The size announced in the headers is checked **before** pulling the body down:
  anything over 4 MB isn't a cover and is cut off there.
- The cache prunes itself: the last sixty covers are kept.
- A local player publishing a `file://` URL downloads nothing — the image is
  already on disk.

It can be turned off entirely with **Show the cover art**, and then the
extension never touches the network. The cache can be deleted without losing
anything:

```bash
rm -rf ~/.cache/spotify-menu
```

---

## Other players

With **Follow any player** on, when Spotify isn't running the indicator shows
whatever any other MPRIS-speaking program is playing: the browser, a video
player, the desktop's own music app. With Spotify running, Spotify wins.

As long as the player being followed stays on the bus it isn't swapped for
another one that shows up: otherwise the panel would spend the day bouncing
between two programs. Whatever a player can't do — seeking, raising its window —
shows up dimmed in the menu, because each program implements the part of MPRIS
it feels like.

To see who's publishing right now:

```bash
busctl --user list | grep mpris
```

---

## Privacy

What you listen to doesn't leave the machine:

- **No account, no key.** Spotify's web API is never called, no token is asked
  for, and there's nothing to log into.
- **No history is kept.** The extension writes down nothing about what you've
  played: it reads what's sounding right now and paints it. The only thing left
  on disk is the cover images, in `~/.cache/spotify-menu/`, with no song names —
  each file is named after the hash of its URL — and an `rm -rf` clears them.
- **The only network traffic is the cover art**, against the player's own CDN,
  and it can be turned off.
- **The settings hold nothing of yours**: a text template, a few switches and a
  number.

---

## Settings

| Setting | Default | What it does |
|---|---|---|
| Follow any player | No | Follows other programs when Spotify isn't running |
| Show the text | Yes | With this off, only the icon stays in the bar |
| Text format | `{artista} — {titulo}` | Template for the bar text |
| Maximum length | 30 | Characters before cutting with an ellipsis |
| Show the controls | Yes | Previous, play/pause and next in the bar itself |
| Hide when nothing is playing | Yes | Takes the indicator out of the bar while there's no music |
| The icon shows the state | Yes | Alternates between play and pause; not applied with the controls on |
| Panel icon | `audio-x-generic-symbolic` | Used when the state isn't replacing it |
| Show the cover art | Yes | Downloads the album cover and shows it in the menu |
| Show the position | Yes | Progress bar with elapsed and total time |
| Middle click plays or pauses | Yes | Shortcut on the indicator |
| Scroll wheel changes track | No | Shortcut on the indicator |
| Place in the bar | Right | Which part of the top bar the indicator goes in |
| Position | 4 | Order within that part, starting at 0 |

From the console, without opening the preferences:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/spotify-menu@jorgemg1414/schemas set org.gnome.shell.extensions.spotify-menu panel-format '{titulo}'
```

---

## Requirements

- GNOME Shell 48 (tested on 48.7, Debian 13, Wayland session)
- `glib-compile-schemas` — package `libglib2.0-dev-bin`
- `gir1.2-soup-3.0` for the cover art, which on Debian 13 already ships with
  GNOME
- A player that speaks MPRIS. The official Spotify client does; the Flatpak and
  Snap packages do too

Nothing else is needed: the extension talks straight to the session bus, which
is already there.

---

## Installation

```bash
cd spotify-menu@jorgemg1414 && ./install.sh --enable
```

Copies the files to `~/.local/share/gnome-shell/extensions/`, compiles the
GSettings schema and enables the extension. GNOME Shell then has to be
reloaded: on Wayland, log out and back in; on X11, `Alt+F2`, `r`, Enter.

To uninstall (this also removes the cover art cache):

```bash
./install.sh --uninstall
```

---

## Troubleshooting

See what Spotify is publishing right now, which is exactly what the extension
reads:

```bash
busctl --user get-property org.mpris.MediaPlayer2.spotify /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2.Player Metadata
```

And its state:

```bash
busctl --user get-property org.mpris.MediaPlayer2.spotify /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2.Player PlaybackStatus
```

Extension errors:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

**If the indicator doesn't appear** while Spotify is playing, first check that
Spotify is on the bus with the `busctl` above. Some packaged versions start with
MPRIS disabled, and the ones running inside a browser publish the browser's
name, not Spotify's: those need **Follow any player**.

**If the cover art doesn't show**, check whether the file was downloaded at all:

```bash
ls -la ~/.cache/spotify-menu/
```

Empty means the download didn't go through; the shell log says why.

---

## Layout

```
spotify-menu@jorgemg1414/
├── extension.js       Indicator, menu, controls and teardown in disable()
├── caratula.js        Cover art download and cache
├── prefs.js           Preferences window (libadwaita)
├── stylesheet.css     Menu styles
├── schemas/           GSettings schema
└── install.sh         Installer
```

Plus the shared modules `install.sh` copies from [`comun/`](../comun/):
`mpris.js` (the D-Bus client: who to follow, what's playing and control),
`barra.js` and `barraprefs.js` (the place in the top bar) and `asyncgio.js`
(`Promise` wrappers over Gio calls).

### Teardown in `disable()`

GNOME requires an extension to leave nothing running when it's disabled. Here
that means releasing the bus's `NameOwnerChanged` subscription, the player
proxies, the position timer, the `Gio.Cancellable` objects of the queries and
the downloads, the libsoup session, and every signal connected to the settings
and to the menu.

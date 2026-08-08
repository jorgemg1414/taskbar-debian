# Terminal

*[Léeme en español](README.es.md)*

A stock terminal lets you type. This one remembers, corrects and guesses. It
all comes from the Debian repositories: nothing compiled by hand, no
third-party repositories.

They're two separate things and they install separately:

```bash
./instalar.sh        # the shell: zsh, its plugins and the prompt
```

```bash
./tilix.sh           # the emulator: font, colours and behaviour
```

Just the command colouring and nothing else? That part comes on its own:

```bash
./instalar.sh --solo-colores
```

And to put things back the way they were, one each:

```bash
./instalar.sh --desinstalar
./tilix.sh --desinstalar
```

---

## What you get in the next terminal you open

| Shortcut | What it does |
|---|---|
| `Ctrl+R` | Searches the history by typing fragments, in any order. `Ctrl+/` shows the whole command when it's long |
| `Ctrl+T` | Inserts a file path into the command you're typing, with a preview of the contents |
| `Alt+C` | Enters one of the directories below the current one |
| `→` | Accepts the command shown in grey. `Ctrl+Space` does the same |
| `Esc Esc` | Repeats the last command with `sudo` in front |
| `z name` | Jumps to a directory you've already visited, from wherever you are |
| `x file` | Extracts it, whether it's `.tar.gz`, `.zip`, `.7z` or anything else |

And without pressing anything: the command is coloured as you type it — green
if it exists, red if it doesn't — unclosed quotes show up before you hit Enter,
and if you get a name wrong it tells you which package installs what you meant.

## What gets installed

| Package | What for |
|---|---|
| `zsh-autosuggestions` | The rest of the command, in grey, as you type |
| `zsh-syntax-highlighting` | Green if the command exists, red if it doesn't |
| `zoxide` | The directory jumping behind `z` |
| `fzf` | The fuzzy search behind `Ctrl+R`, `Ctrl+T` and `Alt+C` |
| `ripgrep` | Searching inside files, much faster than `grep -r` |
| `fd-find` | Searching files by name, much faster than `find`. On Debian the binary is called `fdfind`; the installer adds the `fd` alias |
| `command-not-found` | "No `htop` here, install it with `apt install htop`" |
| `xclip` | `cat notes.txt \| xclip -sel c` and it's on your clipboard |
| `starship` | The prompt (see below) |

On top of that it turns on the Oh My Zsh plugins that were already there:
`sudo`, `colored-man-pages`, `command-not-found`, `extract`, `systemd` and
`safe-paste`. That last one stops a command pasted with a newline inside it
from running before you've read it.

## The prompt

**starship** provides it, and it's packaged in Debian 13. Two lines: the
context on top, and the one you type on its own below. A one-line prompt with a
long path and a long branch name leaves the cursor halfway across the screen.

What shows up, and only when there's something to say:

| You see | When |
|---|---|
| `user@host` in yellow | **Only inside an SSH session.** It's what stops you running on the branch office what you meant to run here |
| The branch, in purple | In a git repository |
| `!3 +2 ?1 ^2` | Three modified, two staged, one untracked, two commits ahead |
| `1.4s` | The previous command took more than half a second |
| `✗127` | It failed, and with which code. 127 is "no such command"; 130 is a `Ctrl+C` |
| The container name | Inside your podman `parrot`, for instance |
| `❯` green or red | Green if the last thing went fine |

On your own machine, with no git and no errors, the prompt is just the path and
the `❯`. It fills up when something happens.

### No icons

Debian doesn't package any Nerd Font, and a prompt full of empty boxes is worse
than one with no decoration. Everything you see is characters any monospace
font has, so it looks the same here as in a `tmux` on someone else's server.

If you ever want the icons, you'd have to download a Nerd Font by hand — they
aren't in the repositories — and change the symbols in
[`starship.toml`](starship.toml).

### The Oh My Zsh theme gets turned off

They can't coexist. Oh My Zsh loads its theme **after** `~/.oh-my-zsh/custom/`,
so it would put its `PROMPT` on top of starship's and you'd see none of the
above. The installer sets `ZSH_THEME=""`, and tells you which one you had —
`af-magic`, in your case — in case you want it back.

## What it touches in your home directory

Three things, and nothing else:

- **`~/.zshrc`** — only two lines: `plugins=(...)` and `ZSH_THEME`. Before
  touching them, the whole file is saved to `~/.zshrc.antes-de-terminal`, which
  is where `--desinstalar` gets it back from.
- **`~/.oh-my-zsh/custom/terminal.zsh`** — everything else. Oh My Zsh walks
  that directory on its own, so no `source` line is needed in `.zshrc`.
- **`~/.config/starship.toml`** — the prompt. If you already had one, it's saved
  once to `starship.toml.anterior` before being overwritten.

## Just the colours

`./instalar.sh --solo-colores` installs only
[`colores.zsh`](colores.zsh) into `~/.oh-my-zsh/custom/`: the command in green
if it exists and red if it doesn't, plus unclosed brackets and quotes marked.
Nothing else. **It doesn't touch `.zshrc`**, so your theme and plugin list stay
exactly as they are.

One thing that isn't obvious: the Debian package **only ships the red**. Out of
the box it defines `unknown-token` and leaves `command`, `builtin`, `function`
and `alias` with no colour, so it warns you when you're wrong but doesn't
confirm when you're right. `colores.zsh` sets the green by hand, after the
`source`, because the array is created by the plugin as it loads.

The two files can't coexist — `terminal.zsh` already has the colours inside —
so each mode removes the other's file when it installs.

## The history

`Ctrl+R` is worth nothing without a history behind it, so `terminal.zsh` raises
it to 100,000 lines and changes how it's kept:

- A repeated command **moves to the end instead of being duplicated**, so the
  history doesn't fill up with the same line forty times.
- Starting a line **with a space** keeps it out of the history. Handy when the
  command has a password in it.
- Open terminals **share history immediately**: what you type in one is there
  in the other without closing anything.

That last one is the only part that might grate: with four terminals open, the
up arrow gives you everyone's commands, not just this window's. Comment out
`setopt SHARE_HISTORY` in `~/.oh-my-zsh/custom/terminal.zsh` to turn it off.

## Tilix

[`tilix.sh`](tilix.sh) is the other half: the emulator, not the shell. Tilix
keeps its configuration in dconf, so the script writes no configuration files:
they're `gsettings` calls against your default profile.

| What | What it becomes |
|---|---|
| Font | **JetBrains Mono 11**, with 10% more air between lines. It tells `O` from `0` and `l` from `1`, which matters in a terminal |
| Colours | The **material** scheme, one of the nine Tilix ships |
| Transparency | **10%**. It was at 27, and with a light wallpaper the text was fighting the background |
| Scrollback | 100,000 lines per terminal |
| Selecting with the mouse | **Copies straight away.** `Ctrl+Shift+C` still works |
| When something long finishes | A desktop notification if you weren't looking at that terminal |
| Split-pane handle | Wider: hitting it stops being a test of aim |
| Default terminal | Tilix, including for anything that opens `x-terminal-emulator` |

**Before touching anything it saves your Tilix configuration** to
`~/.config/tilix-antes-de-taskbar-debian.dconf`, and `--desinstalar` loads it
back verbatim. That isn't the same as returning the keys to their factory
values: if you had transparency at 27 and the factory value is something else,
a reset would change it without telling you and still look like it worked.

Colour schemes can be changed without redoing the rest:

```bash
./tilix.sh --listar
./tilix.sh solarized-dark
```

And the transparency, without touching anything else:

```bash
gsettings set com.gexperts.Tilix.Profile:/com/gexperts/Tilix/profiles/YOUR-UUID/ background-transparency-percent 20
```

The UUID comes from `gsettings get com.gexperts.Tilix.ProfilesList default`.
The other values — font, size, scrollback — are variables at the top of
`tilix.sh`, so you can change them without hunting.

## The order matters

`zsh-syntax-highlighting` wraps the command-line widgets, so it is loaded
**last** in the file. If it goes before `zsh-autosuggestions`, it stops
colouring as soon as the other one wraps the same widgets. That's why the
blocks in `terminal.zsh` are in that order and not another.

# Terminal

*[Léeme en español](README.es.md)*

A stock terminal lets you type. This one remembers, corrects and guesses. Four
packages from the Debian repositories and one settings file: nothing compiled
by hand, no third-party repositories.

```bash
./instalar.sh
```

And to put it back the way it was:

```bash
./instalar.sh --desinstalar
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

On top of that it turns on the Oh My Zsh plugins that were already there:
`sudo`, `colored-man-pages`, `command-not-found`, `extract`, `systemd` and
`safe-paste`. That last one stops a command pasted with a newline inside it
from running before you've read it.

## What it touches in your home directory

Two things, and nothing else:

- **`~/.zshrc`** — only the `plugins=(...)` line. Before touching it, the whole
  file is saved to `~/.zshrc.antes-de-terminal`, which is where
  `--desinstalar` gets it back from.
- **`~/.oh-my-zsh/custom/terminal.zsh`** — everything else. Oh My Zsh walks
  that directory on its own, so no `source` line is needed in `.zshrc`.

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

## The order matters

`zsh-syntax-highlighting` wraps the command-line widgets, so it is loaded
**last** in the file. If it goes before `zsh-autosuggestions`, it stops
colouring as soon as the other one wraps the same widgets. That's why the
blocks in `terminal.zsh` are in that order and not another.

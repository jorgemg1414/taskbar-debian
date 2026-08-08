# Terminal

*[Read this in English](README.md)*

La terminal de fábrica te deja escribir. Esta la recuerda, la corrige y la
adivina. Son cuatro programas de los repositorios de Debian y un archivo de
ajustes: nada compilado a mano, nada de repositorios de terceros.

```bash
./instalar.sh
```

Y para dejarlo como estaba:

```bash
./instalar.sh --desinstalar
```

---

## Qué te encuentras al abrir la siguiente terminal

| Atajo | Qué hace |
|---|---|
| `Ctrl+R` | Busca en el historial escribiendo trozos sueltos, en cualquier orden. `Ctrl+/` enseña el comando entero si es largo |
| `Ctrl+T` | Inserta la ruta de un archivo en el comando que estás escribiendo, con vista previa del contenido |
| `Alt+C` | Entra en una carpeta de las que cuelgan de donde estás |
| `→` | Acepta el comando que ha salido en gris. `Ctrl+Espacio` hace lo mismo |
| `Esc Esc` | Repite el último comando con `sudo` delante |
| `z nombre` | Salta a una carpeta que ya hayas visitado, estés donde estés |
| `x archivo` | Descomprime, sea `.tar.gz`, `.zip`, `.7z` o lo que sea |

Y sin tocar ninguna tecla: el comando se colorea según lo escribes —verde si
existe, rojo si no—, las comillas sin cerrar se ven antes de darle a Intro, y
si te equivocas de nombre te dice con qué paquete se instala lo que buscabas.

## Qué se instala

| Paquete | Para qué |
|---|---|
| `zsh-autosuggestions` | El resto del comando, en gris, según escribes |
| `zsh-syntax-highlighting` | Verde si el comando existe, rojo si no |
| `zoxide` | El salto de carpetas de `z` |
| `fzf` | La búsqueda difusa de `Ctrl+R`, `Ctrl+T` y `Alt+C` |
| `ripgrep` | Buscar dentro de los archivos, mucho más rápido que `grep -r` |
| `fd-find` | Buscar archivos por nombre, mucho más rápido que `find`. En Debian el binario se llama `fdfind`; el instalador deja el alias `fd` |
| `command-not-found` | «No existe `htop`, instálalo con `apt install htop`» |
| `xclip` | `cat notas.txt \| xclip -sel c` y ya lo tienes en el portapapeles |

De los plugins que ya trae Oh My Zsh se activan además `sudo`,
`colored-man-pages`, `command-not-found`, `extract`, `systemd` y `safe-paste`.
Este último es el que evita que un comando pegado con un salto de línea dentro
se ejecute solo antes de que lo hayas leído.

## Qué toca de tu carpeta

Dos cosas, y nada más:

- **`~/.zshrc`** — solo la línea `plugins=(...)`. Antes de tocarla guarda el
  archivo entero en `~/.zshrc.antes-de-terminal`, que es de donde lo recupera
  `--desinstalar`.
- **`~/.oh-my-zsh/custom/terminal.zsh`** — todo lo demás. Oh My Zsh recorre esa
  carpeta solo, así que no hace falta ningún `source` en el `.zshrc`.

## El historial

`Ctrl+R` no vale de nada sin un historial detrás, así que `terminal.zsh` lo
sube a 100 000 líneas y cambia cómo se guarda:

- Un comando repetido **sube al final en vez de duplicarse**, así que el
  historial no se llena de la misma línea cuarenta veces.
- Empezar una línea **con un espacio** hace que no se guarde. Útil cuando el
  comando lleva una contraseña dentro.
- Las terminales abiertas **comparten historial al momento**: lo que escribes
  en una lo tiene la otra sin cerrar nada.

Eso último es lo único que puede chirriar: si tienes cuatro terminales abiertas
y esperas que la flecha arriba te dé lo tuyo, te dará lo de todas. Se quita
comentando `setopt SHARE_HISTORY` en
`~/.oh-my-zsh/custom/terminal.zsh`.

## El orden importa

`zsh-syntax-highlighting` envuelve los widgets de la línea de comandos, así que
va cargado **el último** del archivo. Si se adelanta a
`zsh-autosuggestions`, deja de colorear en cuanto el otro toca los mismos
widgets. Por eso los bloques de `terminal.zsh` están en ese orden y no en otro.

# Terminal

*[Read this in English](README.md)*

La terminal de fábrica te deja escribir. Esta la recuerda, la corrige y la
adivina. Todo sale de los repositorios de Debian: nada compilado a mano, nada
de repositorios de terceros.

Son dos cosas distintas y se instalan por separado:

```bash
./instalar.sh        # la shell: zsh, sus plugins y el prompt
```

```bash
./tilix.sh           # el emulador: fuente, colores y comportamiento
```

¿Solo los colores del comando, sin nada más? Esa parte va suelta:

```bash
./instalar.sh --solo-colores
```

Y para dejarlo como estaba, cada uno lo suyo:

```bash
./instalar.sh --desinstalar
./tilix.sh --desinstalar
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
| `starship` | El prompt (ver abajo) |

De los plugins que ya trae Oh My Zsh se activan además `sudo`,
`colored-man-pages`, `command-not-found`, `extract`, `systemd` y `safe-paste`.
Este último es el que evita que un comando pegado con un salto de línea dentro
se ejecute solo antes de que lo hayas leído.

## El prompt

Lo pone **starship**, que está empaquetado en Debian 13. Son dos líneas: arriba
el contexto y abajo, sola, la que escribes. Un prompt de una línea con una ruta
larga y una rama larga deja el cursor a mitad de pantalla.

Lo que aparece, y solo cuando hay algo que decir:

| Se ve | Cuándo |
|---|---|
| `usuario@equipo` en amarillo | **Solo dentro de un SSH.** Es lo que evita ejecutar en la sucursal lo que ibas a ejecutar aquí |
| La rama, en morado | En un repositorio de git |
| `!3 +2 ?1 ^2` | Tres cambiados, dos en el índice, uno sin seguir, dos commits por delante |
| `1.4s` | El comando anterior tardó más de medio segundo |
| `✗127` | Falló, y con qué código. El 127 es «no existe ese comando»; el 130, un `Ctrl+C` |
| El nombre del contenedor | Dentro de tu `parrot` de podman, por ejemplo |
| `❯` verde o rojo | Verde si lo anterior salió bien |

En tu propio equipo, sin git y sin errores, el prompt es solo la ruta y el
`❯`. Se llena cuando pasa algo.

### Nada de iconos

Debian no empaqueta ninguna Nerd Font, y un prompt lleno de cuadraditos vacíos
es peor que uno sin adornos. Todo lo que se ve son caracteres que tiene
cualquier fuente monoespaciada, así que se ve igual aquí que en un `tmux` de un
servidor ajeno.

Si algún día quieres los iconos, hace falta bajarse una Nerd Font a mano
—no están en los repositorios— y cambiar los símbolos de
[`starship.toml`](starship.toml).

### El tema de Oh My Zsh se apaga

No pueden convivir. Oh My Zsh carga su tema **después** de
`~/.oh-my-zsh/custom/`, así que pondría su `PROMPT` encima del de starship y no
verías nada de lo de arriba. El instalador deja `ZSH_THEME=""`, y te dice cuál
tenías puesto —`af-magic`, en tu caso— por si quieres volver.

## Qué toca de tu carpeta

Tres cosas, y nada más:

- **`~/.zshrc`** — solo dos líneas: `plugins=(...)` y `ZSH_THEME`. Antes de
  tocarlas guarda el archivo entero en `~/.zshrc.antes-de-terminal`, que es de
  donde lo recupera `--desinstalar`.
- **`~/.oh-my-zsh/custom/terminal.zsh`** — todo lo demás. Oh My Zsh recorre esa
  carpeta solo, así que no hace falta ningún `source` en el `.zshrc`.
- **`~/.config/starship.toml`** — el prompt. Si ya tenías uno, se guarda una vez
  en `starship.toml.anterior` antes de pisarlo.

## Solo los colores

`./instalar.sh --solo-colores` pone únicamente
[`colores.zsh`](colores.zsh) en `~/.oh-my-zsh/custom/`: el comando en verde si
existe y en rojo si no, y los paréntesis y comillas sin cerrar marcados. Nada
más. **No toca el `.zshrc`**, así que tu tema y tu lista de plugins se quedan
exactamente como estén.

Ojo con una cosa que no es evidente: el paquete de Debian **solo trae el rojo**.
De fábrica define `unknown-token` y deja `command`, `builtin`, `function` y
`alias` sin color, o sea que te avisa cuando te equivocas pero no confirma
cuando aciertas. El verde lo pone `colores.zsh` a mano, después del `source`,
porque el array lo crea el propio plugin al cargarse.

Los dos archivos no pueden convivir —`terminal.zsh` ya trae los colores
dentro—, así que cada modo quita el del otro al instalarse.

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

## Tilix

[`tilix.sh`](tilix.sh) es lo otro: el emulador, no la shell. Tilix guarda su
configuración en dconf, así que el script no escribe ningún archivo de
configuración: son llamadas a `gsettings` sobre tu perfil predeterminado.

| Qué | A qué queda |
|---|---|
| Fuente | **JetBrains Mono 11**, con un 10% más de aire entre líneas. Distingue la `O` de la `0` y la `l` de la `1`, que en una terminal importa |
| Colores | El esquema **material**, de los nueve que trae Tilix |
| Transparencia | **10%**. Venía al 27, y con un fondo de pantalla claro el texto salía peleado |
| Historial | 100 000 líneas hacia atrás por terminal |
| Marcar con el ratón | **Copia directamente.** `Ctrl+Shift+C` sigue estando |
| Al terminar algo largo | Aviso del escritorio si no estabas mirando esa terminal |
| Tirador entre paneles | Más ancho: acertarle deja de ser puntería |
| Terminal por omisión | Tilix, también para lo que abre `x-terminal-emulator` |

**Antes de tocar nada guarda tu configuración de Tilix** en
`~/.config/tilix-antes-de-taskbar-debian.dconf`, y `--desinstalar` la vuelve a
cargar tal cual. No es lo mismo que devolver las claves a sus valores de
fábrica: si llevabas la transparencia al 27 y de fábrica es otra cosa, un
«reset» te la cambiaría sin avisar y encima parecería que ha funcionado.

Los esquemas de color se cambian sin repetir lo demás:

```bash
./tilix.sh --listar
./tilix.sh solarized-dark
```

Y la transparencia, sin tocar nada más:

```bash
gsettings set com.gexperts.Tilix.Profile:/com/gexperts/Tilix/profiles/TU-UUID/ background-transparency-percent 20
```

El UUID sale de `gsettings get com.gexperts.Tilix.ProfilesList default`. Los
demás valores —fuente, tamaño, historial— están como variables al principio de
`tilix.sh`, para tocarlos sin buscar.

## El orden importa

`zsh-syntax-highlighting` envuelve los widgets de la línea de comandos, así que
va cargado **el último** del archivo. Si se adelanta a
`zsh-autosuggestions`, deja de colorear en cuanto el otro toca los mismos
widgets. Por eso los bloques de `terminal.zsh` están en ese orden y no en otro.

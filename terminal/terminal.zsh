# terminal.zsh — Lo que no cabe en la lista de «plugins» de ~/.zshrc.
#
# Se instala en ~/.oh-my-zsh/custom/, que Oh My Zsh recorre solo, en orden
# alfabético, después de cargar sus plugins (oh-my-zsh.sh, línea 209). Por eso
# aquí no hace falta ningún «source» en el .zshrc: basta con que el archivo
# esté en esa carpeta.
#
# El orden de los bloques de abajo no es decorativo. zsh-syntax-highlighting
# envuelve los widgets de la línea de comandos, así que tiene que cargarse
# después de todo lo demás que también los envuelve; si se adelanta, deja de
# colorear en cuanto otro plugin toca el mismo widget.

# ------------------------------ Historial ------------------------------
# El Ctrl+R de fzf solo es tan bueno como el historial que tenga detrás, y el
# de fábrica se queda corto. Con estas opciones el historial deja de ser una
# lista de las últimas órdenes y pasa a ser la memoria de lo que haces.
HISTSIZE=100000                 # cuántas líneas se mantienen en memoria
SAVEHIST=100000                 # cuántas se guardan en el archivo
setopt EXTENDED_HISTORY         # apunta también la fecha y lo que tardó
setopt HIST_IGNORE_ALL_DUPS     # un comando repetido sube, no se duplica
setopt HIST_IGNORE_SPACE        # empezar la línea con un espacio = no se guarda
setopt HIST_REDUCE_BLANKS       # limpia los espacios de sobra antes de guardar
setopt HIST_VERIFY              # al traer algo del historial, deja revisarlo antes de ejecutarlo
setopt SHARE_HISTORY            # las terminales abiertas comparten historial al momento

# ------------------------------- fzf -----------------------------------
# El plugin «fzf» de Oh My Zsh ya ha dejado enganchados los tres atajos:
#   Ctrl+R  buscar en el historial       Ctrl+T  insertar una ruta
#   Alt+C   entrar en una carpeta
# Aquí va solo el aspecto y las vistas previas.
export FZF_DEFAULT_OPTS='--height=45% --layout=reverse --border=rounded --info=inline --bind=ctrl-/:toggle-preview'

# fd recorre el árbol mucho más rápido que find y respeta el .gitignore. En
# Debian el binario se llama «fdfind» porque «fd» ya estaba cogido.
if (( $+commands[fdfind] )); then
    alias fd='fdfind'
    export FZF_DEFAULT_COMMAND='fdfind --type f --hidden --follow --exclude .git'
    export FZF_CTRL_T_COMMAND="$FZF_DEFAULT_COMMAND"
    export FZF_ALT_C_COMMAND='fdfind --type d --hidden --follow --exclude .git'
fi

# En el historial los comandos largos se cortan por la derecha: Ctrl+/ abre una
# tira abajo con la orden entera.
export FZF_CTRL_R_OPTS='--preview "echo {}" --preview-window=down:3:hidden:wrap'
export FZF_CTRL_T_OPTS='--preview "if [ -d {} ]; then ls -1 --color=always {}; else head -100 {} 2>/dev/null; fi" --preview-window=right:60%:wrap'
export FZF_ALT_C_OPTS='--preview "ls -1 --color=always {}"'

# ------------------------- Sugerencias en gris -------------------------
# Escribe dos letras y aparece en gris el resto del comando que usaste la
# última vez. La flecha derecha lo acepta entero; Ctrl+Espacio también, por si
# la mano ya está en la zona de las teclas modificadoras.
if [[ -r /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh ]]; then
    ZSH_AUTOSUGGEST_STRATEGY=(history completion)
    ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=8'
    source /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh
    bindkey '^ ' autosuggest-accept
fi

# ------------------------------ El prompt ------------------------------
# Va aquí y no en el .zshrc porque Oh My Zsh carga esta carpeta antes que su
# tema (oh-my-zsh.sh, líneas 209 y 222): si el tema siguiera puesto, pondría su
# PROMPT encima del de starship y no se vería nada de esto. Por eso el
# instalador deja ZSH_THEME vacío. Los dos a la vez no puede ser.
if (( $+commands[starship] )); then
    eval "$(starship init zsh)"
fi

# ---------------------- Colores en la línea (el último) ----------------
# El comando se pone verde cuando existe y rojo cuando no, antes de darle a
# Intro. Las comillas sin cerrar y los paréntesis descuadrados se ven igual.
#
# Este bloque está repetido, tal cual, en colores.zsh, que es esto mismo suelto
# para quien no quiera nada más. Cada archivo tiene que funcionar solo, y solo
# se instala uno de los dos: sacarlo a un tercero no ahorraría nada y
# obligaría a controlar en qué orden se cargan.
if [[ -r /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ]]; then
    ZSH_HIGHLIGHT_HIGHLIGHTERS=(main brackets)
    source /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh

    # La versión de Debian solo define «unknown-token» (rojo): avisa cuando te
    # equivocas, pero no dice nada cuando aciertas. El verde hay que pedirlo.
    ZSH_HIGHLIGHT_STYLES[command]='fg=green'        # un programa del PATH
    ZSH_HIGHLIGHT_STYLES[builtin]='fg=green'        # cd, echo, set…
    ZSH_HIGHLIGHT_STYLES[function]='fg=green'       # una función tuya
    ZSH_HIGHLIGHT_STYLES[alias]='fg=green'          # parrot, ll…
fi

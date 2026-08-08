# colores.zsh — Verde si el comando existe, rojo si no. Y nada más.
#
# Esto es una parte suelta de terminal.zsh, para quien quiera los colores de la
# línea sin el resto: sin sugerencias en gris, sin cambiar el prompt, sin tocar
# el historial y sin añadir ni un plugin a la lista del .zshrc.
#
# Se instala en ~/.oh-my-zsh/custom/, que Oh My Zsh recorre solo. Los dos
# archivos no deben convivir: terminal.zsh ya trae esto dentro, y cargar
# zsh-syntax-highlighting dos veces duplica los widgets. El instalador se
# encarga de que solo esté uno.

if [[ -r /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ]]; then
    # «main» es el que colorea la orden y sus argumentos. «brackets» añade los
    # paréntesis y las comillas: los emparejados se ven, y el que se quedó sin
    # cerrar sale en rojo antes de darle a Intro.
    ZSH_HIGHLIGHT_HIGHLIGHTERS=(main brackets)
    source /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh

    # Y aquí lo que no viene de fábrica.
    #
    # La versión de Debian solo define «unknown-token» (rojo): avisa cuando te
    # equivocas, pero no dice nada cuando aciertas. Las cuatro clases de cosa
    # que sí se pueden ejecutar se quedan sin color, así que el verde hay que
    # pedirlo. Va después del source porque el array lo crea el propio plugin.
    ZSH_HIGHLIGHT_STYLES[command]='fg=green'        # un programa del PATH
    ZSH_HIGHLIGHT_STYLES[builtin]='fg=green'        # cd, echo, set…
    ZSH_HIGHLIGHT_STYLES[function]='fg=green'       # una función tuya
    ZSH_HIGHLIGHT_STYLES[alias]='fg=green'          # parrot, ll…
fi

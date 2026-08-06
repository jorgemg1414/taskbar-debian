# Módulos comunes

*[Read this in English](README.md)*

Código que usan varias extensiones del repositorio. **Aquí está el original**;
en las carpetas de las extensiones no hay copias.

Cada `install.sh` copia de aquí los módulos que necesita su extensión, junto a
los suyos propios, dentro de
`~/.local/share/gnome-shell/extensions/<uuid>/`. Lo instalado sigue siendo
autocontenido —que es como GNOME carga las extensiones— pero en el repositorio
hay un solo archivo de cada cosa.

---

## Qué hay aquí

| Módulo | Qué hace | Quién lo usa |
|---|---|---|
| `asyncgio.js` | Envoltorios de `Promise` sobre las llamadas asíncronas de `Gio` | los cinco menús |
| `barra.js` | Coloca el indicador en la barra según los ajustes, y lo recoloca al cambiarlos | los cinco menús |
| `barraprefs.js` | Las dos filas de preferencias con las que se elige ese sitio | los cinco menús |
| `checker.js` | Comprobación de puertos TCP, asíncrona, cancelable y con cola | VNC, SSH, WoL, Equipos |
| `hosts.js` | Lectura y parseo de `~/.ssh/config`, con `Include` y agrupación | SSH, WoL, Equipos |
| `wol.js` | Paquete mágico, lista de equipos y MAC aprendidas de la tabla ARP | WoL, SSH, VNC |

---

## Por qué existe esta carpeta

`checker.js` y `asyncgio.js` estaban repetidos, byte a byte, en el menú de VNC y
en el de SSH. `wol.js` estaba en dos sitios y **ya había divergido**: la versión
del menú de SSH aprendía la MAC de la tabla ARP y la de la extensión de Wake on
LAN no, que es justo la que más falta le hacía.

Con una extensión más en el repositorio la cuenta se multiplicaba, así que el
original vive aquí y las copias se hacen al instalar, no en git.

---

## Reglas

- **Un módulo entra aquí cuando lo usan dos extensiones.** Si solo lo usa una,
  su sitio es la carpeta de esa extensión (`connections.js`, `montajes.js`,
  `ventanas.js`, `vitales.js`… se quedan donde están).
- **`barra.js` es el único que habla con el shell** (`Main.panel`). Los demás
  son Gio y GLib pelados, y se pueden probar fuera de GNOME. Por eso las filas
  de preferencias de la barra viven aparte, en `barraprefs.js`: la ventana de
  preferencias es otro proceso, sin shell.
- **Nada de aquí conoce a ninguna extensión concreta.** Ni ajustes propios, ni
  `metadata.json`, ni cadenas de la interfaz: lo que se necesite se pasa por
  parámetro. Por eso los avisos del registro van con el nombre del módulo
  (`[wol]`, `[hosts]`) y no con el de una extensión.
- **Al cambiar algo de aquí hay que reinstalar todas las extensiones que lo
  usan**, porque cada una tiene su copia instalada:

  ```bash
  for d in */install.sh; do (cd "$(dirname "$d")" && ./install.sh); done
  ```

- **La carpeta hace falta para instalar.** Si clonas solo una extensión, su
  `install.sh` se planta y te dice que falta `comun/`.

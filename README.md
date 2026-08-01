# taskbar-debian

Personalizaciones para la barra superior de **GNOME Shell** en **Debian 13
(trixie)**. Cada carpeta es una extensión independiente que se instala con su
propio `install.sh`.

Todo el código está comentado en español y escrito con la API moderna de
extensiones (ESM, GNOME 45+): `import ... from 'gi://…'`, clase que extiende
`Extension` y limpieza completa en `disable()`.

---

## Contenido

| Carpeta | Extensión | Qué hace |
|---|---|---|
| [`vnc-menu@jorgemg1414/`](vnc-menu@jorgemg1414/) | **VNC Menu** | Menú en la barra superior con tus conexiones VNC guardadas, agrupadas y con indicador de disponibilidad |

---

## VNC Menu

Un indicador en la barra superior que lee una carpeta de archivos de conexión y
los presenta como menú. Al pulsar una entrada se abre el cliente VNC.

**Qué ofrece:**

- **Lee tus archivos tal cual están.** Soporta `.vnc` de RealVNC Viewer (texto
  plano `Clave=Valor`), `.vnc` de TigerVNC/TightVNC (`host=` y `port=`) y
  `.remmina` (INI). El nombre visible es el del archivo sin extensión.
- **Agrupación automática.** Por subcarpetas, o por las etiquetas del propio
  archivo (`Labels=` en RealVNC, `group=` en Remmina) cuando no hay subcarpetas.
- **Estado de cada equipo.** Un punto verde o rojo indica si el puerto responde.
  Se comprueba al abrir el menú y cada 60 s, de forma asíncrona con
  `Gio.SocketClient` y 2 s de tiempo de espera.
- **Se actualiza sola.** La carpeta se escanea con `Gio` y se vigila con
  `Gio.FileMonitor`: al añadir, borrar o editar una conexión el menú cambia al
  momento, sin recargar el shell.
- **Comandos configurables.** Por omisión `remmina -c vnc://%h:%p`, con
  alternativas automáticas a `vncviewer` o `xtigervncviewer` si Remmina no está
  instalado. Ventana de preferencias en libadwaita.
- **No toca tus credenciales.** Las claves `Password`, `Identity` y
  `AuthCertificate` se descartan en el parser: ni se leen ni se pasan a ningún
  sitio.

> **Aviso sobre los archivos de conexión:** la contraseña que guarda RealVNC en
> `Password=` no es un hash, es la contraseña cifrada con una clave fija y
> pública, recuperable en texto claro con herramientas comunes. No subas tu
> carpeta de conexiones a ningún repositorio, ni siquiera privado.

Documentación completa (formatos, ajustes, depuración):
**[vnc-menu@jorgemg1414/README.md](vnc-menu@jorgemg1414/README.md)**

---

## Requisitos

- GNOME Shell 48 (probado en 48.7, Debian 13, sesión Wayland)
- `glib-compile-schemas` — paquete `libglib2.0-dev-bin`
- Un cliente VNC: `remmina` + `remmina-plugin-vnc`, o `tigervnc-viewer`

```bash
sudo apt install libglib2.0-dev-bin remmina remmina-plugin-vnc
```

---

## Instalación

```bash
git clone https://github.com/jorgemg1414/taskbar-debian.git
```

```bash
cd taskbar-debian/vnc-menu@jorgemg1414 && ./install.sh --enable
```

El script copia los archivos a
`~/.local/share/gnome-shell/extensions/vnc-menu@jorgemg1414/`, compila el
esquema de GSettings y activa la extensión.

Después hay que recargar GNOME Shell:

- **Wayland:** cerrar sesión y volver a entrar. No hay forma de recargar el
  shell en caliente.
- **X11:** `Alt+F2`, escribir `r` y pulsar Enter.

Por omisión busca las conexiones en `~/Documentos/VNC`. Se cambia desde las
preferencias de la extensión.

Para desinstalar:

```bash
./install.sh --uninstall
```

---

## Depuración

Los errores de las extensiones salen en el registro de GNOME Shell:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Comprobar que el shell reconoce la extensión:

```bash
gnome-extensions info vnc-menu@jorgemg1414
```

Si dice «no existe» después de instalarla, es que falta reiniciar la sesión.

---

## Estructura del repositorio

```
taskbar-debian/
└── vnc-menu@jorgemg1414/
    ├── extension.js       Indicador, menú, lanzamiento y limpieza en disable()
    ├── connections.js     Escaneo asíncrono de la carpeta y parser de conexiones
    ├── checker.js         Comprobación de puertos, asíncrona y cancelable
    ├── asyncgio.js        Envoltorios de Promise sobre las llamadas de Gio
    ├── prefs.js           Ventana de preferencias (libadwaita)
    ├── stylesheet.css     Estilos del menú
    ├── schemas/           Esquema de GSettings
    ├── install.sh         Instalador
    └── README.md          Documentación detallada
```

Cada extensión que se añada al repositorio sigue el mismo patrón: una carpeta
con el UUID como nombre, su `install.sh` y su README.

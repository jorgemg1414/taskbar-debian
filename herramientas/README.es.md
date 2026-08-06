# Herramientas

*[Read this in English](README.md)*

Scripts sueltos que resuelven lo que las extensiones no pueden resolver desde la
barra de tareas: tocar la configuración de los equipos remotos y el llavero de
GNOME. Se ejecutan a mano, cuando hacen falta.

| Script | Qué hace |
|---|---|
| `autorizar-clave.sh` | Autoriza tu clave pública en un equipo remoto, sea Linux o Windows |
| `vnc-a-remmina.sh` | Convierte tus archivos `.vnc` en perfiles de Remmina |
| `guardar-password.sh` | Guarda una contraseña en el llavero de GNOME para los perfiles de Remmina |
| `guardar-password.js` | Lo que hace el trabajo del anterior, con libsecret |
| `despertar.sh` · `despertar.ps1` · `encender-pc.bat` | Mandar el paquete de Wake-on-LAN desde la terminal, en Linux y en Windows |

---

## `autorizar-clave.sh`

```bash
./autorizar-clave.sh <destino> [más destinos...]
```

Es el que más se usa: sin la clave autorizada, el menú de Equipos no puede
preguntar nada y el de SSH pide contraseña en cada conexión.

El destino es lo mismo que le pasarías a `ssh`: un alias de `~/.ssh/config` —los
que salen en los menús— o `usuario@host`.

Sabe dónde va la clave en cada sistema, que es justo lo que hace fallar a
`ssh-copy-id` contra un Windows:

| Sistema | Archivo |
|---|---|
| Linux, BSD | `~/.ssh/authorized_keys`, con permisos 600 |
| Windows, cuenta normal | `%USERPROFILE%\.ssh\authorized_keys` |
| Windows, cuenta administradora | `%ProgramData%\ssh\administrators_authorized_keys` |

Para saber a cuál de los tres, primero pregunta: `uname -s`, y si no existe,
`cmd /c ver` y, en último término, PowerShell. Hacen falta las tres porque el
intérprete por omisión de un Windows puede ser `cmd` o PowerShell. Si aun así no
lo reconoce, no toca nada y enseña lo que contestó el equipo. Se puede saltar la
pregunta con `--sistema windows`.

La contraseña la pide `ssh`: el script no la lee, no la guarda y no la pasa por
la línea de comandos. Y solo viaja la mitad pública de la clave — si le pasas
una privada por error, se planta y no la manda.

---

## Los demás

Están explicados con detalle en el
[README del repositorio](../README.es.md#herramientas), porque es donde se
cuenta para qué sirven dentro del conjunto: convertir conexiones de RealVNC a
Remmina, dejar de teclear su contraseña, y encender equipos desde la terminal
sin pasar por el menú.

Todos llevan su propia ayuda:

```bash
./autorizar-clave.sh --ayuda
```

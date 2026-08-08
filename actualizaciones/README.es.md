# Actualizaciones

*[Read this in English](README.md)*

Debian trae el temporizador `apt-daily` encendido de fábrica. Suena dos veces
al día, refresca las listas de paquetes… y no instala nada. Nunca. Un parche de
seguridad se queda ahí esperando a que te acuerdes de hacer `apt upgrade`.

```bash
./instalar.sh
```

Y para dejarlo como estaba:

```bash
./instalar.sh --desinstalar
```

---

## Qué cambia

| Antes | Después |
|---|---|
| `apt-daily` refresca listas y para ahí | Los parches de **seguridad** se instalan solos, dos veces al día |
| Un fallo en `libheif` sigue abierto hasta que te acuerdes | Se cierra sin que hagas nada |
| Actualizas una biblioteca y los servicios siguen con la vieja en memoria, en silencio | `needrestart` te dice cuáles |

## Atado en corto

Automatizar actualizaciones asusta con razón, así que esto va con tres límites:

- **Solo `trixie-security`.** Los cambios de versión normales de la estable los
  sigues decidiendo tú. El patrón exige `origin=Debian`, así que tus
  repositorios de terceros —Steam, Spotify, Claude— quedan fuera **por
  construcción**, sin tener que nombrarlos ni mantener una lista de exclusiones.
- **Nunca reinicia el equipo.** `Automatic-Reboot "false"`, explícito.
- **Nunca reinicia un servicio.** `needrestart` en modo `l`: enumera y se calla.
  Reiniciar Nautilus o tu sesión a media mañana no es algo que deba decidir un
  temporizador.

## Los tres archivos que escribe

| Archivo | Para qué |
|---|---|
| `/etc/apt/apt.conf.d/20auto-upgrades` | Los números que gobiernan `apt-daily`: refrescar, descargar, instalar |
| `/etc/apt/apt.conf.d/52parches-seguridad` | De dónde se acepta, y qué no se hace nunca |
| `/etc/needrestart/conf.d/50-solo-avisar.conf` | `$nrconf{restart} = 'l'` |

El `50unattended-upgrades` que trae el paquete **no se toca**. Lo nuestro va en
un `52`, con número más alto, para que gane; y aparte, para que una
actualización del paquete no se lo lleve por delante, que el `50` es suyo y lo
puede reescribir cuando quiera.

## La línea vacía que no sobra

Dentro de `52parches-seguridad` hay esto, y es lo único con truco del archivo:

```
Unattended-Upgrade::Origins-Pattern "";
Unattended-Upgrade::Origins-Pattern {
    "origin=Debian,codename=${distro_codename}-security,label=Debian-Security";
};
```

La primera línea parece basura y es la importante. En un bloque con el mismo
nombre, APT **añade** a la lista en vez de sustituirla. Sin vaciarla antes, la
lista de fábrica —que incluye las actualizaciones normales de la estable—
seguiría dentro, y todo esto no serviría de nada. Se comprueba con:

```bash
apt-config dump | grep -i origins-pattern
```

Debe salir **una sola línea**, y con `-security` dentro.

## Ver qué hace

```bash
./instalar.sh --solo-ver
```

Simula la ejecución de ahora mismo sin instalar nada. Y para lo demás:

```bash
systemctl list-timers apt-daily-upgrade.timer          # cuándo toca la próxima
less /var/log/unattended-upgrades/unattended-upgrades.log   # qué ha hecho
```

## Por qué merecía la pena

El día que se montó esto había siete parches esperando: `libheif1` y sus
complementos. `libheif` es el decodificador de imágenes HEIF, y
`heif-thumbnailer` es lo que **Nautilus llama solo** para pintar las miniaturas
al abrir una carpeta. No hace falta abrir nada: basta con mirar el directorio.

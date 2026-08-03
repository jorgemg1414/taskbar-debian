# Wake on LAN

*[Read this in English](README.md)*

Indicador en la barra superior para encender equipos a distancia. Al pulsar un
equipo se manda el **paquete mágico** de Wake-on-LAN por UDP.

---

## Cómo funciona

El paquete mágico son 102 bytes: seis `0xFF` seguidos de la MAC del equipo
repetida dieciséis veces. Se manda por UDP a la dirección de **difusión** de la
red donde vive la máquina. La tarjeta de red la reconoce con el ordenador
apagado —sigue alimentada— y enciende el equipo.

Lo manda la propia extensión con `Gio.Socket`, sin depender de `wakeonlan`,
`etherwake` ni ningún programa externo.

> **Es un disparo a ciegas.** El protocolo no tiene respuesta: que el paquete
> salga no garantiza que el equipo arranque. La notificación dice «paquete
> enviado», no «equipo encendido», porque es lo único que se puede afirmar.

---

## Antes de que funcione

Wake-on-LAN hay que habilitarlo **en el equipo que quieres encender**, no en el
tuyo. Suele hacer falta lo siguiente:

1. **En la BIOS/UEFI del equipo destino:** una opción llamada `Wake on LAN`,
   `Power On by PCI-E`, `Resume by LAN` o parecida. En muchas placas hay que
   desactivar además `ErP` o `Deep Sleep`, porque cortan la corriente a la
   tarjeta de red al apagar.
2. **Cable, no WiFi.** El WoL por WiFi casi nunca funciona.
3. **Si el destino es Linux**, comprueba que la tarjeta lo tiene activo:

   ```bash
   sudo ethtool enp3s0 | grep -i wake
   ```

   Debe decir `Wake-on: g`. Si dice `d`, se activa con
   `sudo ethtool -s enp3s0 wol g`, que **no sobrevive al reinicio**: hay que
   dejarlo en la configuración de red o en una unidad de systemd.
4. **Si el destino es Windows**, en el Administrador de dispositivos, en la
   tarjeta de red: *Permitir que este dispositivo reactive el equipo*. Y
   desactiva el *Inicio rápido*, porque deja la máquina en un estado del que
   no despierta.

---

## Averiguar la MAC

Con el equipo encendido, desde él mismo:

```bash
ip -brief link
```

Desde tu equipo, si está en la misma red:

```bash
ip neigh | grep 192.168.10.50
```

Si no, sale en la tabla de DHCP del router de esa red.

---

## La dirección de difusión

El campo **Dirección de difusión** es a dónde se manda el paquete, y es lo que
más se confunde: **no es la IP del equipo**. Es la dirección de difusión de su
red, la que termina en el último número del rango:

| Red del equipo | Dirección de difusión |
|---|---|
| `192.168.10.0/24` | `192.168.10.255` |
| `192.168.1.0/24` | `192.168.1.255` |
| Tu propia red local | déjalo vacío y usa `255.255.255.255` |

Se manda a la difusión y no a la IP porque el equipo está apagado: no tiene IP
asignada y nadie sabe responder por su MAC.

### Fuera de tu red local

Encender un equipo de otra sede **por internet** no depende de esta extensión,
depende del router de esa sede. Hacen falta dos cosas allí:

- Reenviar un puerto UDP (el 9) hacia la dirección de difusión de la red
  interna, lo que se llama *directed broadcast*. Muchos routers domésticos no
  lo permiten.
- O bien tener una VPN levantada hasta esa red, y entonces vale la difusión
  normal.

Si tienes VPN, pon la difusión de la red remota y funciona igual que en local.

---

## Ajustes

Desde el menú → **Preferencias**, o con `gnome-extensions prefs wol-menu@jorgemg1414`.

Cada equipo tiene:

| Campo | Descripción |
|---|---|
| Nombre | Lo que ves en el menú |
| MAC | `aa:bb:cc:dd:ee:ff`, `aa-bb-...` o `aabbccddeeff`; se valida al escribir |
| Dirección de difusión | Ver arriba. Vacío = `255.255.255.255` |
| Puerto | 9 por omisión; el 7 también se usa |

Y a nivel general:

| Ajuste | Por omisión | Descripción |
|---|---|---|
| Icono del panel | `network-wired-symbolic` | Cualquier icono simbólico del tema |
| Mostrar la MAC | no | La dirección física a la derecha de cada equipo |

Con dos equipos o más aparece **Encender todos**, que manda el paquete a toda
la lista de una vez.

Los equipos se guardan en GSettings como una lista de JSON, así que también se
pueden editar desde la terminal:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/wol-menu@jorgemg1414/schemas get org.gnome.shell.extensions.wol-menu equipos
```

---

## Instalación

```bash
cd wol-menu@jorgemg1414 && ./install.sh --enable
```

Después hay que recargar GNOME Shell: en Wayland, cerrar sesión y volver a
entrar; en X11, `Alt+F2`, `r` y Enter.

Para desinstalar:

```bash
./install.sh --uninstall
```

---

## Depuración

El paquete sale aunque no haya nadie escuchando, así que si no enciende el
equipo el problema casi siempre está en el destino, no aquí. Para confirmar que
el paquete se manda bien, escucha en otra máquina de la misma red:

```bash
sudo tcpdump -i any -n udp port 9
```

Errores de la extensión:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

---

## Estructura

```
wol-menu@jorgemg1414/
├── extension.js       Indicador, menú y limpieza en disable()
├── wol.js             Paquete mágico, envío por UDP y lista de equipos
├── prefs.js           Ventana de preferencias (libadwaita)
├── stylesheet.css     Estilos del menú
├── schemas/           Esquema de GSettings
└── install.sh         Instalador
```

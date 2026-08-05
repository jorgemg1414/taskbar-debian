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

> **El protocolo no tiene respuesta.** Que el paquete salga no garantiza que el
> equipo arranque, así que por sí solo lo único que se puede afirmar es
> «paquete enviado».

---

## Saber si arrancó de verdad

El paquete no contesta, pero el equipo encendido sí: si le das a cada uno una
**dirección para comprobarlo** —la suya, con un puerto que tenga abierto—, la
extensión la sondea y ya no hay que fiarse.

- **Al abrir el menú**, un punto verde o rojo dice si el equipo está encendido,
  con lo que se ve de un vistazo a cuál hace falta mandarle el paquete.
- **Al mandarlo**, la fila se pone en amarillo y se sigue sondeando cada cinco
  segundos hasta que responde, con un límite de dos minutos por omisión. La
  segunda notificación ya dice «*equipo-taller* ya responde (32 s)», o que
  sigue sin responder pasado el plazo.
- **Con «Encender todos»** se espera a todos a la vez y se resume: «3 de 4
  responden».

Se sondea abriendo un puerto TCP, igual que hacen los menús de VNC y de SSH. Si
el equipo también está en tu `~/.ssh/config`, con poner su IP basta: se usa el
puerto 22. Para un Windows suelen valer el 3389 (escritorio remoto) o el 445
(compartir archivos).

Sin esa dirección, el equipo funciona como siempre: se manda el paquete, no hay
punto de estado y la notificación dice solo que salió.

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

   Debe decir `Wake-on: g`. Si dice `d`, primero repasa el punto 1: mientras
   la BIOS no lo permita, la tarjeta ignora lo que le pidas desde el sistema.
   Es especialmente típico de las Realtek RTL8125 con el driver `r8169`.

   Con la BIOS ya en orden, lo que hace que sobreviva a los reinicios es
   dejarlo en NetworkManager, que lo reaplica cada vez que levanta la
   conexión (`sudo ethtool -s ... wol g` se pierde al reiniciar):

   ```bash
   sudo nmcli connection modify «TU CONEXIÓN» 802-3-ethernet.wake-on-lan magic
   sudo nmcli connection up «TU CONEXIÓN»
   ```

   El ajuste solo llega a la tarjeta al activar la conexión, así que sin el
   segundo comando `ethtool` seguirá diciendo `d` hasta el próximo reinicio.
4. **Si el destino es Windows**, en el Administrador de dispositivos, en la
   tarjeta de red: *Permitir que este dispositivo reactive el equipo*. Y
   desactiva el *Inicio rápido*, porque deja la máquina en un estado del que
   no despierta.

---

## La MAC se aprende sola

Normalmente no hay que averiguar ninguna MAC. Mientras un equipo responde, su
MAC está en la **tabla ARP** del sistema, porque para pintar el punto verde la
extensión ya ha hablado con él. Se apunta de ahí y queda guardada para el día
que aparezca en rojo.

Basta entonces con darle la dirección para comprobarlo y dejar la MAC en blanco:
la fila dirá «MAC pendiente de aprender» hasta la primera vez que el equipo
responda estando tú en la misma red.

Tiene dos límites, los de la propia tabla ARP:

- Solo vale para **IPv4**, y solo si la dirección de comprobación es una IP, no
  un nombre.
- Solo vale para equipos de **tu mismo segmento de red**. Para uno que esté al
  otro lado de un router, lo que hay en la tabla es la MAC del router, no la
  suya, así que no se aprende nada y hay que escribirla.

Se desactiva con **Aprender las MAC**. Y si prefieres escribirla, la tuya manda:
lo aprendido solo se usa cuando el campo está vacío.

### Importar de `~/.ssh/config`

El botón de la cabecera de **Equipos** trae los equipos que ya tienes descritos
en tu configuración de SSH, con su dirección y su puerto puestos como dirección
de comprobación. Se saltan los que van por un `ProxyJump` —a esos ni les llega
la difusión ni se les puede sondear— y los que ya estén en la lista, así que se
puede pulsar las veces que haga falta.

De cada bloque también se leen, si los llevas, los comentarios `# MAC:` y
`# Difusión:`.

### Averiguarla a mano

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
| MAC | `aa:bb:cc:dd:ee:ff`, `aa-bb-...` o `aabbccddeeff`; se valida al escribir. En blanco se aprende sola |
| Dirección de difusión | Ver arriba. Vacío = `255.255.255.255` |
| Puerto | 9 por omisión; el 7 también se usa |
| Dirección para comprobarlo | La **suya**, no la de difusión: `192.168.10.50` o `192.168.10.50:3389`. Sin puerto se usa el 22. Vacío, no se comprueba |

Y a nivel general:

| Ajuste | Por omisión | Descripción |
|---|---|---|
| Comprobar si el equipo está encendido | sí | Punto de estado al abrir el menú y espera al arranque |
| Espera de cada sondeo | 2 s | Lo que se espera a que acepte la conexión, resolución del nombre incluida |
| Espera al arranque | 120 s | Cuánto se sigue sondeando tras mandar el paquete. 0 no espera |
| Aprender las MAC | sí | Apunta la MAC de la tabla ARP mientras el equipo responde |
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
├── prefs.js           Ventana de preferencias (libadwaita)
├── stylesheet.css     Estilos del menú
├── schemas/           Esquema de GSettings
└── install.sh         Instalador
```

Más los módulos compartidos que `install.sh` copia de [`comun/`](../comun/):
`wol.js` (paquete mágico, envío por UDP y lista de equipos) y `asyncgio.js`
(envoltorios de `Promise` sobre las llamadas de Gio).

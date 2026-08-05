# Wake on LAN

*[Léeme en español](README.es.md)*

A top bar indicator for powering machines on remotely. Clicking a machine sends
the Wake-on-LAN **magic packet** over UDP.

---

## How it works

The magic packet is 102 bytes: six `0xFF` followed by the machine's MAC repeated
sixteen times. It is sent over UDP to the **broadcast** address of the network
the machine lives on. The network card recognises it while the computer is off —
it stays powered — and turns the machine on.

The extension sends it itself through `Gio.Socket`, with no dependency on
`wakeonlan`, `etherwake` or any external program.

> **The protocol has no reply.** A packet going out doesn't guarantee the
> machine boots, so on its own the only thing that can honestly be claimed is
> "packet sent".

---

## Knowing whether it actually booted

The packet never answers, but a machine that is up does: give each one a
**check address** — its own address, on a port it has open — and the extension
probes it instead of guessing.

- **When the menu opens**, a green or red dot says whether the machine is on, so
  you can see at a glance which one needs the packet.
- **When you send it**, the row turns yellow and the machine is probed every
  five seconds until it answers, capped at two minutes by default. The second
  notification then says "*jorge-pc* is answering (32 s)", or that it is still
  silent once the deadline passes.
- **With Wake all**, every machine is waited on at once and the result is
  summarised: "3 of 4 answering".

Probing means opening a TCP port, the same thing the VNC and SSH menus do. If
the machine is also in your `~/.ssh/config`, its IP alone is enough: port 22 is
the default. For Windows, 3389 (remote desktop) or 445 (file sharing) usually
work.

Without a check address the machine behaves as before: the packet is sent, there
is no status dot, and the notification only says it went out.

---

## Before it works

Wake-on-LAN has to be enabled **on the machine you want to power on**, not on
yours. Usually all of this is needed:

1. **In the target's BIOS/UEFI:** an option called `Wake on LAN`,
   `Power On by PCI-E`, `Resume by LAN` or similar. On many boards you also have
   to disable `ErP` or `Deep Sleep`, which cut power to the network card on
   shutdown.
2. **Wired, not WiFi.** WoL over WiFi almost never works.
3. **If the target runs Linux**, check the card has it on:

   ```bash
   sudo ethtool enp3s0 | grep -i wake
   ```

   It should say `Wake-on: g`. If it says `d`, go back to point 1 first: while
   the BIOS forbids it, the card ignores anything the OS asks for. This is
   especially typical of Realtek RTL8125 cards on the `r8169` driver.

   With the BIOS sorted, what makes it survive reboots is storing it in
   NetworkManager, which reapplies it every time the connection comes up
   (`sudo ethtool -s ... wol g` is lost on reboot):

   ```bash
   sudo nmcli connection modify «YOUR CONNECTION» 802-3-ethernet.wake-on-lan magic
   sudo nmcli connection up «YOUR CONNECTION»
   ```

   The setting only reaches the card when the connection is activated, so
   without the second command `ethtool` will keep saying `d` until you reboot.
4. **If the target runs Windows**, in Device Manager, on the network card:
   *Allow this device to wake the computer*. And turn off *Fast Startup*, which
   leaves the machine in a state it won't wake from.

---

## Finding the MAC

With the machine on, from the machine itself:

```bash
ip -brief link
```

From your machine, if it's on the same network:

```bash
ip neigh | grep 192.168.10.50
```

Otherwise it's in the DHCP table of that network's router.

---

## The broadcast address

The **Broadcast address** field is where the packet goes, and it's the most
commonly confused one: **it is not the machine's IP**. It is the broadcast
address of its network — the one ending in the last number of the range:

| Machine's network | Broadcast address |
|---|---|
| `192.168.10.0/24` | `192.168.10.255` |
| `192.168.1.0/24` | `192.168.1.255` |
| Your own local network | leave it empty to use `255.255.255.255` |

It goes to the broadcast address rather than the IP because the machine is off:
it has no IP assigned and nothing can answer for its MAC.

### Outside your local network

Powering on a machine at another site **over the internet** doesn't depend on
this extension, it depends on that site's router. Two things are needed there:

- Forwarding a UDP port (9) to the internal network's broadcast address, known
  as *directed broadcast*. Many consumer routers won't do it.
- Or a VPN up to that network, in which case plain broadcast works.

With a VPN, set the remote network's broadcast address and it behaves exactly as
it does locally.

---

## Settings

Menu → **Preferences**, or `gnome-extensions prefs wol-menu@jorgemg1414`.

Each machine has:

| Field | Description |
|---|---|
| Name | What you see in the menu |
| MAC | `aa:bb:cc:dd:ee:ff`, `aa-bb-...` or `aabbccddeeff`; validated as you type |
| Broadcast address | See above. Empty = `255.255.255.255` |
| Port | 9 by default; 7 is also used |
| Check address | **Its own** address, not the broadcast one: `192.168.10.50` or `192.168.10.50:3389`. Without a port, 22 is used. Empty means no checking |

And globally:

| Setting | Default | Description |
|---|---|---|
| Check whether the machine is on | yes | Status dot when the menu opens, and waiting for the boot |
| Probe timeout | 2 s | How long to wait for the connection, name resolution included |
| Boot timeout | 120 s | How long to keep probing after sending the packet. 0 doesn't wait |
| Panel icon | `network-wired-symbolic` | Any symbolic icon from the theme |
| Show the MAC | no | The hardware address to the right of each machine |

With two machines or more, **Wake all** appears and sends the packet to the
whole list at once.

Machines are stored in GSettings as a list of JSON strings, so they can also be
edited from a terminal:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/wol-menu@jorgemg1414/schemas get org.gnome.shell.extensions.wol-menu equipos
```

---

## Installation

```bash
cd wol-menu@jorgemg1414 && ./install.sh --enable
```

Then reload GNOME Shell: on Wayland, log out and back in; on X11, `Alt+F2`, `r`,
Enter.

To uninstall:

```bash
./install.sh --uninstall
```

---

## Troubleshooting

The packet goes out whether or not anything is listening, so if the machine
doesn't power on the problem is almost always at the destination, not here. To
confirm the packet is being sent correctly, listen from another machine on the
same network:

```bash
sudo tcpdump -i any -n udp port 9
```

Extension errors:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

---

## Layout

```
wol-menu@jorgemg1414/
├── extension.js       Indicator, menu and teardown in disable()
├── prefs.js           Preferences window (libadwaita)
├── stylesheet.css     Menu styles
├── schemas/           GSettings schema
└── install.sh         Installer
```

Plus the shared modules `install.sh` copies from [`comun/`](../comun/):
`wol.js` (magic packet, UDP sending and the machine list) and `asyncgio.js`
(`Promise` wrappers around the Gio calls).

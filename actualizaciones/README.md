# Updates

*[Léeme en español](README.es.md)*

Debian ships with the `apt-daily` timer switched on. It fires twice a day,
refreshes the package lists… and installs nothing. Ever. A security patch sits
there waiting for you to remember to run `apt upgrade`.

```bash
./instalar.sh
```

And to put it back the way it was:

```bash
./instalar.sh --desinstalar
```

---

## What changes

| Before | After |
|---|---|
| `apt-daily` refreshes lists and stops there | **Security** patches install themselves, twice a day |
| A hole in `libheif` stays open until you remember | It closes without you doing anything |
| You update a library and services keep the old one in memory, silently | `needrestart` tells you which ones |

## Kept on a short leash

Automating updates is rightly scary, so this comes with three limits:

- **`trixie-security` only.** Ordinary stable version bumps are still your call.
  The pattern requires `origin=Debian`, so your third-party repositories —
  Steam, Spotify, Claude — are excluded **by construction**, without naming them
  or maintaining an exclusion list.
- **It never reboots the machine.** `Automatic-Reboot "false"`, explicitly.
- **It never restarts a service.** `needrestart` in `l` mode: it lists and shuts
  up. Restarting Nautilus or your session mid-morning isn't a timer's call.

## The three files it writes

| File | What for |
|---|---|
| `/etc/apt/apt.conf.d/20auto-upgrades` | The numbers driving `apt-daily`: refresh, download, install |
| `/etc/apt/apt.conf.d/52parches-seguridad` | Where packages are accepted from, and what never happens |
| `/etc/needrestart/conf.d/50-solo-avisar.conf` | `$nrconf{restart} = 'l'` |

The `50unattended-upgrades` that ships with the package is **left alone**. Ours
goes in a `52`, with a higher number so it wins; and separately, so that an
update to the package can't wipe it out — the `50` is theirs and they can
rewrite it whenever they like.

## The empty line that isn't redundant

Inside `52parches-seguridad` there's this, and it's the only tricky part of the
file:

```
Unattended-Upgrade::Origins-Pattern "";
Unattended-Upgrade::Origins-Pattern {
    "origin=Debian,codename=${distro_codename}-security,label=Debian-Security";
};
```

The first line looks like junk and it's the important one. In a block with the
same name, APT **appends** to the list rather than replacing it. Without
emptying it first, the factory list — which includes ordinary stable updates —
would still be in there and none of this would do anything. Check it with:

```bash
apt-config dump | grep -i origins-pattern
```

You should get **one single line**, with `-security` in it.

## Seeing what it does

```bash
./instalar.sh --solo-ver
```

Simulates the run it would do right now without installing anything. And for
the rest:

```bash
systemctl list-timers apt-daily-upgrade.timer               # when the next one is due
less /var/log/unattended-upgrades/unattended-upgrades.log   # what it has done
```

## Why it was worth doing

The day this was set up there were seven patches waiting: `libheif1` and its
plugins. `libheif` is the HEIF image decoder, and `heif-thumbnailer` is what
**Nautilus calls on its own** to draw thumbnails when you open a folder. You
don't have to open anything: looking at the directory is enough.

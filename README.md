# WebKDE

WebKDE streams a host-native KDE Plasma Wayland session through a small
Selkies container. KDE, KWin, applications, files, package management, D-Bus,
and PipeWire remain on the host. The container owns only Pixelflux/Selkies,
Sway, encoding, and the HTTPS endpoint.

```text
Browser (HTTPS/WebSocket)
          |
container: Selkies + Pixelflux (wayland-1)
          |
container: Sway (wayland-2, shared with the host)
          |
host: nested KWin (WL-0 + WL-1) -> Plasma -> host applications
```

The browser controls the streamed canvas size. A page control partitions that
live canvas into one or more KWin outputs without restarting Pixelflux, Sway,
KWin, Plasma, or desktop applications.

## Installation model

WebKDE is installed system-wide:

- application files: `/opt/webkde`;
- configuration and credentials: `/etc/webkde/webkde.env`;
- persistent container data: `/var/lib/webkde`;
- boot lifecycle: `/etc/systemd/system/webkde.service`.

One intentionally minimal service remains in the desktop user's systemd
manager. Plasma 6 starts KWin, D-Bus services, portals, and session targets
there, while PipeWire is also tied to the user runtime. Starting that desktop
directly as root from a system service would bypass Plasma's supported session
lifecycle. The system-wide `webkde.service` owns and starts this user session;
the user unit is not independently enabled.

While WebKDE is active, KDE and logind inhibitors prevent automatic locking,
display blanking, suspend/hibernate, and lid-close sleep. The inhibitors are
released when WebKDE stops, restoring the host's normal power behavior.

## Prerequisites

WebKDE is distribution-neutral and does not install packages or alter host
access policy. Prepare Docker, Plasma 6, PipeWire-Pulse, GPU access, Docker API
access for the desktop user, and systemd user lingering first. See
[Host prerequisites](docs/prerequisites.md) for checks and example commands for
Debian/Ubuntu, Fedora, Arch-based systems, and openSUSE.

Only one Plasma session should use a given systemd user manager. If the machine
also has a physical Plasma login, use a dedicated non-root user for WebKDE.

## Deploy

Run configuration and checks as the intended desktop user:

```bash
./scripts/configure.sh
$EDITOR .env
./scripts/doctor.sh
```

The configuration helper creates a git-ignored `.env` and a random web
password. Review at least the bind address, port, GPU render node, timezone,
monitor dimensions (used only as KWin's startup fallback).

Install the application for that user:

```bash
sudo ./scripts/install-system.sh "$USER"
```

The first image pull and build can take several minutes. Follow startup with:

```bash
systemctl status webkde.service
journalctl -u webkde.service -f
journalctl --user -u webkde-session.service -u plasma-kwin_wayland.service -f
docker logs -f webkde-selkies
```

Open `https://127.0.0.1:3001/` by default. The generated certificate is
self-signed. The username and password are in `/etc/webkde/webkde.env`.

Basic authentication is enabled by default. Set `WEBKDE_BASIC_AUTH=false`
only when access is protected by a trusted VPN, firewall, or authenticating
reverse proxy. Never combine unauthenticated access with unrestricted Internet
exposure.

For a remote machine, retain the loopback bind and use a tunnel:

```bash
ssh -L 3001:127.0.0.1:3001 DESKTOP_USER@WEBKDE_HOST
```

Then open `https://127.0.0.1:3001/` on the client.

## Virtual screens

Open Selkies' **Screen Settings** section and use the **Virtual screens**
selector. The choice is stored by that browser. Counts from 1 through 8 are
available by default. The canvas is divided along its longer dimension, so a
1000×300 canvas with two screens becomes two 500×300 KDE displays. Changing the browser size
continues to resize the stream normally; crossing between wide and tall
automatically changes the split direction. No service or desktop restart is
performed.

Selkies' **UI Scaling** setting controls the global KDE desktop scale. WebKDE
applies it to the intermediate Sway output and then partitions the remaining
logical canvas between the virtual screens. KWin's nested Wayland backend
ignores per-output scale changes made in KDE Display Configuration, so use the
Selkies setting for this deployment.

The installed default reserves eight nested outputs. Set
`WEBKDE_MAX_SCREENS` to a value from 1 through 8 before installation if a
smaller maximum is preferred.

The same Screen Settings section has **Restart Plasma** and **Restart KWin**
recovery buttons. Both ask for confirmation. Restarting Plasma closes the
session's applications. Restarting KWin interrupts the Wayland display-server
connection, so Wayland applications can also close; on some Plasma versions it
may result in a full session restart. Neither action restarts the Selkies
container.

`make status` (or `/opt/webkde/scripts/display-mode.sh status`) remains
available for diagnostics. The old `make single` and `make dual` controls were
removed because they forced a fixed stream resolution.

## Operations

```bash
sudo systemctl start webkde.service
sudo systemctl stop webkde.service
sudo systemctl restart webkde.service
./scripts/doctor.sh
make validate
```

Edit `/etc/webkde/webkde.env` for an installed system. A bind address, port,
password change takes effect after a restart. Monitor-size or
base-image changes also rebuild the local image automatically on restart.

To redeploy a newer checkout while preserving configuration and data, rerun:

```bash
sudo ./scripts/install-system.sh "$USER"
```

To uninstall while preserving `/etc/webkde` and `/var/lib/webkde`:

```bash
sudo ./scripts/uninstall-system.sh
```

Pass `--purge` only when the credentials and persistent container data should
also be deleted.

## Audio

The host Plasma session uses a PipeWire-Pulse null sink named `output`. The
container connects to the host user's Pulse socket and Selkies captures
`output.monitor`. Microphone forwarding is disabled by default.

## Mouse, scrolling, and clipboard

The browser pointer reaches KWin through Pixelflux and Sway as a virtual
Wayland seat. KDE System Settings therefore reports that no physical mouse is
connected; this is expected, and its per-device speed controls do not apply.

Wheel deltas are scaled before injection. The default is deliberately slower
than upstream Selkies:

```dotenv
WEBKDE_SCROLL_SCALE=0.25
```

Add or change that value in `/etc/webkde/webkde.env`, then restart WebKDE. A
smaller value scrolls more slowly; accepted values are clamped between `0.05`
and `4.0`.

Text clipboard synchronization is relayed through KDE Klipper in both
directions. Use the normal copy/paste shortcuts in KDE and in the local browser. Grant the site's
clipboard permission when the browser asks; clipboard APIs require the HTTPS
page to be focused and may require one initial user gesture. The Selkies
sidebar clipboard box is also available when browser clipboard policy blocks
automatic access. The bridge currently synchronizes text, not images or file
lists.

## Security

- The service binds to `127.0.0.1` by default; prefer an SSH tunnel.
- Basic authentication is enabled by default. Disabling it delegates all
  access control to the surrounding network or reverse proxy.
- Use a hardened reverse proxy and stronger authentication before Internet
  exposure.
- A connected controller operates a real host-user desktop and has that user's
  file and application access. Treat it like an interactive host login.
- The host root filesystem, home directory, and Docker socket are not mounted
  into the container.
- Container file transfer, commands, app controls, microphone, and gamepad are
  disabled.
- Docker access is root-equivalent. Restrict it to trusted host users.
- Never commit `.env` or credentials copied from `/etc/webkde`.

## Troubleshooting

Run `./scripts/doctor.sh`, then inspect the system service, user session, and
container logs shown above. Important sockets are:

```text
/run/user/<uid>/webkde/wayland-1  Pixelflux compositor
/run/user/<uid>/webkde/wayland-2  Sway compositor; nested host KWin connects here
/run/user/<uid>/wayland-0         nested KWin display; Plasma apps connect here
```

If a browser shows a stale black frame after an interrupted upgrade, reload one
tab and close duplicate WebKDE tabs. The session now automatically remaps KWin
after an outer-compositor restart; `sudo systemctl restart webkde.service`
forces a complete clean recovery if necessary.

If a future KWin release uses names other than `WL-0` and `WL-1`, inspect
`QT_QPA_PLATFORM=wayland WAYLAND_DISPLAY=wayland-0 kscreen-doctor -o` and
adjust `scripts/webkde-bridge.sh` and `container/defaults/sway.conf`.

## Reproducibility and upstream

The Selkies base image is pinned to a multi-architecture OCI digest. Adopt
upstream updates deliberately, validate, and rebuild. The image includes a
narrow, build-verified workaround for the pinned Selkies release's list parser
so its documented `file_transfers=none` setting actually disables transfers.

- [LinuxServer Selkies base image](https://github.com/linuxserver/docker-baseimage-selkies)
- [Selkies](https://github.com/selkies-project/selkies)
- [Sway](https://github.com/swaywm/sway)
- [KWin](https://invent.kde.org/plasma/kwin)

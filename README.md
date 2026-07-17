# WebKDE

WebKDE streams a host-native KDE Plasma Wayland session through a small
Selkies container. KDE, KWin, applications, files, package management, D-Bus,
and PipeWire remain on the host. The container owns only Pixelflux/Selkies,
Labwc, encoding, and the HTTPS endpoint.

```text
Browser (HTTPS/WebSocket)
          |
container: Selkies + Pixelflux (wayland-1)
          |
container: Labwc (wayland-0, shared with the host)
          |
host: nested KWin (WL-0 + WL-1) -> Plasma -> host applications
```

The dual layout is two 1920x1080 KWin outputs on one 3840x1080 Pixelflux
canvas; the initial active mode is single-monitor by default. It can switch
live between one and two monitors without restarting Pixelflux, Labwc, KWin,
Plasma, or desktop applications.

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
monitor dimensions, and initial display mode.

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

For a remote machine, retain the loopback bind and use a tunnel:

```bash
ssh -L 3001:127.0.0.1:3001 DESKTOP_USER@WEBKDE_HOST
```

Then open `https://127.0.0.1:3001/` on the client.

## Display modes

Connect a browser before the first mode change so Selkies has initialized its
primary display. From the source checkout:

```bash
make single
make dual
make status
```

The same commands are available after deployment as:

```bash
/opt/webkde/scripts/display-mode.sh single
/opt/webkde/scripts/display-mode.sh dual
/opt/webkde/scripts/display-mode.sh status
```

They use Selkies' live `r,<resolution>,primary` WebSocket control and KScreen.
The streamed canvas and active KWin output change while all compositor and
desktop processes stay alive.

## Operations

```bash
sudo systemctl start webkde.service
sudo systemctl stop webkde.service
sudo systemctl restart webkde.service
./scripts/doctor.sh
make validate
```

Edit `/etc/webkde/webkde.env` for an installed system. A bind address, port,
password, or default-mode change takes effect after a restart. Monitor-size or
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

## Security

- The service binds to `127.0.0.1` by default; prefer an SSH tunnel.
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
/run/user/<uid>/webkde/wayland-0  Labwc compositor; nested host KWin connects here
/run/user/<uid>/wayland-0         nested KWin display; Plasma apps connect here
```

If a display-mode command cannot resize, connect the browser first. If a future
KWin release uses names other than `WL-0` and `WL-1`, inspect
`kscreen-doctor -o` and adjust `scripts/display-mode.sh`.

## Reproducibility and upstream

The Selkies base image is pinned to a multi-architecture OCI digest. Adopt
upstream updates deliberately, validate, and rebuild. The image includes a
narrow, build-verified workaround for the pinned Selkies release's list parser
so its documented `file_transfers=none` setting actually disables transfers.

- [LinuxServer Selkies base image](https://github.com/linuxserver/docker-baseimage-selkies)
- [Selkies](https://github.com/selkies-project/selkies)
- [Labwc](https://github.com/labwc/labwc)
- [KWin](https://invent.kde.org/plasma/kwin)

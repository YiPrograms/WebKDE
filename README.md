# WebKDE

WebKDE streams a **host-native KDE Plasma Wayland session** through a small
Selkies container. KDE, KWin, applications, files, package management, D-Bus,
and PipeWire stay on the host. The container owns only Pixelflux/Selkies,
Labwc, video/audio encoding, and the HTTPS web endpoint.

```text
Browser (HTTPS/WebSocket)
          |
          v
container: Selkies + Pixelflux (wayland-1)
          |
container: Labwc (wayland-0, shared socket)
          |
          v
host: nested KWin (WL-0 + WL-1) -> Plasma -> host applications/files
```

The two KWin outputs are 1920x1080 by default. `make single` disables `WL-1`
and resizes the Pixelflux canvas to 1920x1080. `make dual` expands Pixelflux to
3840x1080 and enables `WL-1` at x=1920. Only Selkies' capture/encoder pipeline
is restarted during a resize; all compositor processes and applications remain
alive.

## Supported host

The included host bootstrap targets Arch Linux derivatives such as CachyOS.
The container and user-service design is portable, but package installation on
other distributions needs an equivalent bootstrap script.

Required host components:

- Docker Engine with Compose v2
- KDE Plasma 6 / KWin Wayland, KScreen, and XWayland
- a persistent systemd user manager (`loginctl enable-linger`)
- an AVX2-capable CPU for Pixelflux Wayland
- a DRI render node; Intel/AMD `/dev/dri/renderD128` is the default
- PipeWire-Pulse for host audio

## Install

1. Initialize local configuration (this generates a random web password):

   ```bash
   ./scripts/configure.sh
   ```

2. Install host prerequisites interactively:

   ```bash
   sudo ./scripts/host-setup.sh "$USER"
   ```

3. Start a new login or SSH session so the `docker` group is active, then:

   ```bash
   ./scripts/doctor.sh
   ./scripts/install-user.sh
   ```

4. Watch startup:

   ```bash
   make logs
   ```

The first image pull/build can take several minutes. Once healthy, access the
service at `https://127.0.0.1:3001/`. The certificate is self-signed by default.
The username and generated password are in the local, git-ignored `.env`.

The default Selkies base is pinned to a multi-architecture OCI digest for
repeatable deployments. Update `SELKIES_BASE_IMAGE` deliberately when adopting
upstream fixes, then run `make validate` and rebuild.

For a remote machine, keep the safe loopback binding and tunnel it:

```bash
ssh -L 3001:127.0.0.1:3001 user@webkde-host
```

Then open `https://127.0.0.1:3001/` locally.

## Display modes

Run these after a browser has connected and initialized the primary Selkies
display:

```bash
make single
make dual
make status
```

The mode controls use Selkies' live `r,<resolution>,primary` WebSocket command.
They intentionally do not restart Pixelflux, Labwc, KWin, or Plasma.

## Operations

```bash
make start
make stop
make restart
make logs
make doctor
make validate
```

User units are installed under `~/.config/systemd/user/`. In particular, the
installer adds a user-only drop-in for `plasma-kwin_wayland.service` so KWin
starts nested with two outputs. Remove everything except persistent data with:

```bash
./scripts/uninstall-user.sh
```

`data/config` and `.env` are preserved.

## Configuration

Edit `.env`, then reinstall user units when changing runtime paths or monitor
dimensions:

```bash
./scripts/install-user.sh
systemctl --user restart webkde-session.service
```

The Labwc placement rules currently use 1920x1080 coordinates. If changing
monitor dimensions, update `container/defaults/labwc.xml` to match and rebuild.

## Audio

The host Plasma session uses a PipeWire-Pulse null sink named `output`.
The container connects to the host Pulse socket as the same UID and Selkies
captures `output.monitor`. Microphone forwarding is disabled in the first
deployment; enable it only after validating the host input policy.

## Security

- The default bind address is `127.0.0.1`; prefer an SSH tunnel.
- Basic auth is enabled with a generated password, but it is only appropriate
  for a trusted LAN. Use a hardened reverse proxy and stronger authentication
  before Internet exposure.
- A connected controller operates a real host-user Plasma session and therefore
  has that user's full file and application access. Treat WebKDE access like an
  interactive login to the host, not like access to an isolated desktop.
- The host root filesystem, home directory, and Docker socket are never mounted
  into the container.
- Container-side file transfer, command, application, microphone, and gamepad
  controls are disabled.
- Do not commit `.env` or `data/`.

## Troubleshooting

Start with:

```bash
./scripts/doctor.sh
systemctl --user status webkde-container webkde-session
docker logs webkde-selkies
journalctl --user -u plasma-kwin_wayland.service -b
```

Important sockets:

```text
/run/user/<uid>/webkde/wayland-1  Pixelflux compositor
/run/user/<uid>/webkde/wayland-0  Labwc compositor (host KWin connects here)
/run/user/<uid>/wayland-0         nested KWin display (Plasma apps connect here)
```

If the browser is not connected, the display mode command may have no primary
Selkies client to resize. Connect first, then retry. If `WL-0`/`WL-1` names
differ on a future KWin release, inspect `kscreen-doctor -o` and update
`scripts/display-mode.sh`.

Only one Plasma session should use a given systemd user manager. On a machine
that also has a physical Plasma login, deploy WebKDE under a dedicated host
user rather than trying to run two Plasma sessions as the same user.

## Upstream components

- [LinuxServer Webtop](https://github.com/linuxserver/docker-webtop)
- [LinuxServer Selkies base image](https://github.com/linuxserver/docker-baseimage-selkies)
- [Selkies](https://github.com/selkies-project/selkies)
- [Labwc](https://github.com/labwc/labwc)
- [KWin](https://invent.kde.org/plasma/kwin)

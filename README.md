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

## Deployment model

Each WebKDE checkout is a complete user-local deployment:

- application files and tracked service templates: the Git checkout;
- configuration and credentials: `.env`;
- persistent container data: `data/config`;
- rendered user units: `systemd/generated`;
- service discovery links: `~/.config/systemd/user`.

`.env`, `data/`, and `systemd/generated/` are git-ignored. The deployment
script renders units with absolute checkout paths and links them into the
systemd user manager. Run WebKDE directly from a durable checkout location.

Every configured Linux user uses an independent checkout, Plasma session,
systemd user manager, Compose project, Selkies container, image tag, runtime
directory, audio socket, credentials, and HTTPS port. Browser profiles are
isolated naturally when each session uses its own port or hostname.

The `webkde.service` user unit starts that user's container and Plasma session.
Plasma 6 starts KWin, D-Bus services, portals, and session targets in the same
user manager, while PipeWire is tied to that user's runtime. WebKDE itself does
not require root; the administrator only prepares the host prerequisites.

While WebKDE is active, KDE and logind inhibitors prevent automatic locking,
display blanking, suspend/hibernate, and lid-close sleep. The inhibitors are
released when WebKDE stops, restoring the host's normal power behavior.

## Prerequisites

WebKDE is distribution-neutral and does not install packages or alter host
access policy. Prepare Docker, Plasma 6, PipeWire-Pulse, GPU access, Docker API
access for the desktop user, and systemd user lingering first. See
[Host prerequisites](docs/prerequisites.md) for checks and example commands for
Debian/Ubuntu, Fedora, Arch-based systems, and openSUSE.

Only one Plasma session should use a given systemd user manager. Use a distinct
non-root Linux account for every concurrent WebKDE session, and do not use that
same account for a simultaneous physical Plasma login.

## Deploy

Install the current `main` release archive and deploy it as the desktop user:

```bash
curl -fsSL https://raw.githubusercontent.com/YiPrograms/WebKDE/main/install.sh | bash
```

The bootstrap downloads the source archive into `~/.local/share/webkde`, opens
the configuration wizard, pulls `ghcr.io/yiprograms/webkde:latest`, creates
`.env`, and deploys the user services. The wizard asks for the bind address,
port, web credentials, timezone, render node, startup dimensions, virtual-screen
limit, and image source. Set `WEBKDE_INSTALL_DIR`, `WEBKDE_HTTPS_PORT`, or
`WEBKDE_REF` before the command to select another absolute install directory,
HTTPS port, branch, or tag:

```bash
curl -fsSL https://raw.githubusercontent.com/YiPrograms/WebKDE/main/install.sh \
  | WEBKDE_HTTPS_PORT=3002 WEBKDE_REF=v1.0.0 bash
```

For a Git checkout, run configuration and checks as the intended desktop user:

```bash
./scripts/configure.sh
$EDITOR .env
./scripts/doctor.sh
```

The configuration wizard creates or updates a git-ignored `.env`; pressing
Enter accepts each displayed default and generates a random password on first
use. `WEBKDE_NONINTERACTIVE=true` makes the one-line installer use generated
defaults for automated deployment.

Deploy that checkout for the user without `sudo`:

```bash
./scripts/deploy.sh
```

For concurrent sessions, give each Linux user a durable checkout and select a
unique port:

```bash
alice$ ./scripts/configure.sh 3001
alice$ ./scripts/deploy.sh
bob$   ./scripts/configure.sh 3002
bob$   ./scripts/deploy.sh
```

Re-running `deploy.sh` renders the units from the current checkout and restarts
that user's application and service. Docker reports an actionable bind error
if another service already owns the selected port.

Set `WEBKDE_BUILD_LOCAL=true` in `.env` to build the container from the current
checkout. The default uses the published GHCR image.

The first image pull or local build can take several minutes. Follow startup with:

```bash
systemctl --user status webkde.service
journalctl --user -u webkde.service -f
journalctl --user -u webkde-session.service -u plasma-kwin_wayland.service -f
docker compose --env-file .env -f compose.yaml logs -f
```

Open the configured port, such as `https://127.0.0.1:3001/`. The generated
certificate is self-signed. The username and password are in `.env`.

Basic authentication is enabled by default. Set `WEBKDE_BASIC_AUTH=false`
only when access is protected by a trusted VPN, firewall, or authenticating
reverse proxy. Never combine unauthenticated access with unrestricted Internet
exposure.

For a remote machine, retain the loopback bind and use a tunnel:

```bash
ssh -L 3001:127.0.0.1:3001 DESKTOP_USER@WEBKDE_HOST
```

Then open `https://127.0.0.1:3001/` on the client.

## Multiple user sessions

Each user's `webkde.service` owns exactly that Linux user's KDE session.
Instances can run concurrently and are managed from their respective accounts:

```bash
alice$ systemctl --user start webkde.service
bob$   systemctl --user restart webkde.service
```

Use a distinct port or hostname for every instance. Distinct browser origins
also keep virtual-screen profiles and automatic-start preferences separated.
Using different URL paths on one origin requires an authenticating reverse
proxy and does not isolate browser local storage, so separate hostnames are
preferred. All instances may share the same render node, but concurrent atlas
resolution, encoder throughput, GPU memory, system RAM, and network bandwidth
must fit the host.

## Virtual screens

Open Selkies' **Screen Settings** section and select **Manage Virtual Screens**.
On a new main tab, WebKDE waits before starting the stream and offers **Use one
monitor**, **Use profile**, and **Custom**. Enable automatic startup to reuse the
last applied configuration on later visits; disable it in the virtual-screen
controls in Selkies' **Screen Settings** to restore the startup chooser.
The dedicated control tab manages from 1 through 8 outputs by default. Choose a
screen count, choose a common resolution preset or enter an independent custom
resolution for every screen, and drag a screen freely; on release it snaps to
the nearest valid attachment edge. Nearby screen edges align automatically and
live coordinates appear while dragging; hold Ctrl to ignore alignment snapping
and retain the exact vertical or horizontal offset. Coordinates are relative to
Screen 1 and can be negative; Screen 1 itself can also be dragged. Row, Column,
and Compact presets are also available. Named profiles save and restore
complete screen counts, resolutions, and arrangements in the browser. Loading
a profile creates a draft; select **Apply** to activate it. Screen 1 remains
primary. **Apply** stores the
configuration in the browser and updates the desktop without restarting Plasma.
Allow pop-ups for the WebKDE origin when the browser asks.

**Set to current tab resolution** samples that screen tab's current viewport and
device-pixel ratio once. The resulting resolution remains fixed when multiple
virtual screens are active; later tab resizes only scale the displayed crop to
fit and do not resize KDE or repack the stream. A satellite tab must be open
before its current resolution can be sampled. When the default single-screen
configuration has never been set explicitly, Screen 1 continues to follow the
normal Selkies responsive-resolution behavior.

An active satellite tab enables **Set resolution to …** whenever its aligned
device-pixel viewport differs from that screen's configured resolution. The
button applies the new size without opening the virtual-screen manager.

The control window must remain open while satellite windows are in use. Closing
a satellite does not disable its KDE output or move applications. In Per-tab
mode, each configured screen size becomes the requested size of its KDE output.
Each browser tab uses independent absolute mouse input. WebKDE does not lock,
warp, or hand off the browser pointer at screen edges. Browser security prevents
a reliable held-button drag from continuing across separate tabs, so release
the window on one screen and continue moving it from the destination tab.
Satellite fullscreen uses the same browser keyboard lock as the control window,
so Chromium's press-and-hold Escape gesture exits fullscreen in either window.
WebKDE packs the differently sized output frames into a shared atlas that fits
the stream's 4080×4080 limit and reports every effective resolution in Screen
Settings. If the requested rectangles do not fit, it reduces all outputs by a
common factor while preserving their aspect ratios. This internal capture
packing is independent of the desktop arrangement selected in the control tab.
Opening or closing Selkies' settings sidebar does not resize KDE outputs.

At UI scales above 100%, Screen Settings reports both coordinate spaces. KWin's
nested output backend reports the streamed pixel mode at 100%, while Selkies'
outer scale provides the smaller effective UI size. WebKDE positions outputs
using that effective size so the desktop has no gaps. KDE Display Configuration
may therefore draw the nested output rectangles as overlapping because it
cannot represent the outer scale; that visualization is a backend limitation,
not the actual usable desktop topology.

Selkies' **UI Scaling** setting controls the global KDE desktop scale. WebKDE
applies it to the intermediate Sway output and then partitions the remaining
logical canvas between the virtual screens. KWin's nested Wayland backend
ignores per-output scale changes made in KDE Display Configuration and forces
its nested outputs back to scale 1, so use the Selkies setting for this
deployment.

WebKDE also owns the virtual-output arrangement. Do not change scale or use
**Rearrange Displays** in KDE Display Configuration: its live preview can resize
the nested KWin host windows and create a geometry feedback loop. The bridge
restores managed scale and positions, and the stream-side watchdog restores the
host-window sizes if a preview attempts to change them. Choose the screen count
and arrangement in Selkies instead.

`WEBKDE_ENCODER=x264enc` is the deployment default. It restricts Selkies to the
H.264 encoder so its browser-side crash recovery cannot persistently fall back
to CPU JPEG after repeated service or compositor restarts. Change this variable
only when a target GPU requires another Selkies encoder.

The default reserves eight nested outputs. Set `WEBKDE_MAX_SCREENS` to a value
from 1 through 8 in `.env`, then deploy to apply the selected maximum.

The same Screen Settings section has **Restart Plasma** and **Restart KWin**
recovery buttons. Both ask for confirmation. Restarting Plasma closes the
session's applications. Restarting KWin interrupts the Wayland display-server
connection, so Wayland applications can also close; on some Plasma versions it
may result in a full session restart. Neither action restarts the Selkies
container.

**Reset Displays** is the recovery step for corrupted output dimensions or
positions. It stops KWin, saves the previous `kwinoutputconfig.json` as
`kwinoutputconfig.json.webkde-backup`, clears the persisted output state,
restarts KWin, and reapplies the current WebKDE layout. It asks for confirmation
because Wayland applications may close.

`make status` (or `./scripts/display-mode.sh status`) reports the service,
container, Plasma session, and KScreen output state.

## Operations

```bash
systemctl --user start webkde.service
systemctl --user stop webkde.service
systemctl --user restart webkde.service
./scripts/doctor.sh
make validate
```

Edit `.env` for the deployed session. A bind address, port, or password change
takes effect after a restart. Local-build source, monitor-size, or base-image
changes rebuild the local image on restart. Run `./scripts/deploy.sh` after
changing values embedded in generated user units, including monitor dimensions
and `WEBKDE_MAX_SCREENS`.

Apply the current checkout while preserving configuration and data with:

```bash
./scripts/deploy.sh
```

Remove the service links and generated units while preserving `.env` and
`data/config` with:

```bash
./scripts/undeploy.sh
```

Pass `--purge` to delete that checkout's credentials and persistent container
data as well.

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

Add or change that value in `.env`, then restart that user's WebKDE instance. A
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
- Keep `.env`, `data/`, and `systemd/generated/` git-ignored.

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
after an outer-compositor restart; `systemctl --user restart webkde.service`
forces a complete clean recovery if necessary.

If a future KWin release uses names other than `WL-0` and `WL-1`, inspect
`QT_QPA_PLATFORM=wayland WAYLAND_DISPLAY=wayland-0 kscreen-doctor -o` and
adjust `scripts/webkde-bridge.sh` and `container/defaults/sway.conf`.

## Reproducibility and upstream

GitHub Actions builds the `linux/amd64` container on every push to `main` and
publishes `ghcr.io/yiprograms/webkde:latest`, branch, commit-SHA, and semantic
version tags. The Selkies base image is pinned to an OCI digest. Adopt upstream
updates deliberately, validate, and rebuild. The image includes a narrow,
build-verified workaround for the pinned Selkies release's list parser so its
documented `file_transfers=none` setting disables transfers.

- [LinuxServer Selkies base image](https://github.com/linuxserver/docker-baseimage-selkies)
- [Selkies](https://github.com/selkies-project/selkies)
- [Sway](https://github.com/swaywm/sway)
- [KWin](https://invent.kde.org/plasma/kwin)

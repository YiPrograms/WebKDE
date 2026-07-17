# Host prerequisites

WebKDE deliberately does not install operating-system packages, change group
membership, enable Docker, or enable user lingering. Prepare the host first,
then run `./scripts/doctor.sh` as the desktop user. Package names vary by
release; treat the commands below as starting points and review your
distribution's current documentation.

## Required capabilities

The host needs:

- a systemd-based Linux distribution and a non-root desktop user;
- Docker Engine using the system daemon, plus Docker Compose v2;
- Docker API access for the desktop user (normally membership in `docker`);
- Plasma 6, `kwin_wayland_wrapper`, `startplasma-wayland`, KScreen, and
  XWayland;
- PipeWire with the PulseAudio-compatible server and `pactl`;
- a DRI render node accessible to the desktop user, normally
  `/dev/dri/renderD128` through the `render` or `video` group;
- an AVX2-capable CPU; and
- a persistent systemd user manager for the desktop user.

The typical one-time service and access configuration is:

```bash
sudo systemctl enable --now docker.service
sudo usermod -aG docker,render,video DESKTOP_USER
sudo loginctl enable-linger DESKTOP_USER
```

Log out all sessions for that user and log in again after changing groups.
Membership in the `docker` group is effectively root-equivalent; use an
appropriately trusted account. If the distribution provides equivalent ACL or
device-access mechanisms, those are fine as long as `docker info` and access
to the configured render node work from a fresh login.

## Common distributions

### Debian and Ubuntu

Follow Docker's official [Debian](https://docs.docker.com/engine/install/debian/)
or [Ubuntu](https://docs.docker.com/engine/install/ubuntu/) repository guide so
the Compose v2 plugin is included. Plasma package names commonly include
`plasma-workspace`, `kwin-wayland`, `kscreen`, `xwayland`, `pipewire-pulse`,
and `pulseaudio-utils`. Meta-packages such as `kde-plasma-desktop` can provide
the complete session.

```bash
sudo apt install kde-plasma-desktop kwin-wayland kscreen xwayland \
  pipewire-pulse pulseaudio-utils
```

### Fedora

Follow Docker's official [Fedora guide](https://docs.docker.com/engine/install/fedora/).
Fedora provides Plasma as an environment group; the individual components use
names such as `plasma-workspace`, `kwin-wayland`, `kscreen`,
`xorg-x11-server-Xwayland`, and `pipewire-pulseaudio`.

```bash
sudo dnf install @kde-desktop-environment kwin-wayland kscreen \
  xorg-x11-server-Xwayland pipewire-pulseaudio
```

### Arch Linux and derivatives

The distribution repositories provide the needed Docker and Plasma packages.
`plasma-meta` is convenient, while a minimal host can select the individual
packages.

```bash
sudo pacman -S docker docker-compose plasma-meta kscreen xorg-xwayland \
  pipewire-pulse
```

See the Arch Wiki pages for
[Docker](https://wiki.archlinux.org/title/Docker),
[KDE](https://wiki.archlinux.org/title/KDE), and
[PipeWire](https://wiki.archlinux.org/title/PipeWire).

### openSUSE Tumbleweed and Leap

Package names commonly include `docker`, `docker-compose`,
`patterns-kde-kde_plasma`, `kscreen6`, `xwayland`, and `pipewire-pulseaudio`.
Verify that `docker compose version` reports Compose v2 after installation.

```bash
sudo zypper install docker docker-compose patterns-kde-kde_plasma \
  kscreen6 xwayland pipewire-pulseaudio
```

Use openSUSE's [Docker documentation](https://en.opensuse.org/Docker) for the
current repository and service details.

## Verification

From a fresh login as the intended desktop user:

```bash
docker info
docker compose version
test -r /dev/dri/renderD128 -a -w /dev/dri/renderD128
loginctl show-user "$USER" -p Linger
systemctl --user show-environment
./scripts/doctor.sh
```

Do not proceed until the doctor's failures are resolved. A missing Pulse socket
may be only a warning when the user manager has not yet started PipeWire; it
must exist by the time WebKDE starts.

#!/usr/bin/env bash
set -u

failures=0
warnings=0

ok() { printf 'OK   %s\n' "$*"; }
warn() { printf 'WARN %s\n' "$*"; warnings=$((warnings + 1)); }
fail() { printf 'FAIL %s\n' "$*"; failures=$((failures + 1)); }

for command in docker kwin_wayland startplasma-wayland kscreen-doctor openssl pactl; do
  if command -v "${command}" >/dev/null 2>&1; then ok "command: ${command}"; else fail "missing command: ${command}"; fi
done

if grep -qw avx2 /proc/cpuinfo; then ok "CPU supports AVX2"; else fail "CPU lacks AVX2; Pixelflux Wayland will fall back to X11"; fi

if [[ -e /dev/dri/renderD128 ]]; then ok "DRI render node exists"; else fail "missing /dev/dri/renderD128"; fi
if [[ -S "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/pulse/native" ]]; then ok "PipeWire-Pulse socket exists"; else warn "host Pulse socket is not active"; fi

if systemctl is-active --quiet docker.service; then ok "Docker daemon is active"; else fail "Docker daemon is inactive"; fi
if id -nG | tr ' ' '\n' | grep -qx docker; then ok "current login has docker group"; else fail "current login lacks docker group"; fi
if docker info >/dev/null 2>&1; then ok "Docker API is usable"; else fail "Docker API is not usable by this login"; fi

if systemctl --user is-active --quiet plasma-workspace.target && ! systemctl --user is-active --quiet webkde-session.service; then
  fail "another Plasma session is already active for this user"
else
  ok "no conflicting Plasma user session detected"
fi

linger="$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)"
if [[ "${linger}" == yes ]]; then ok "systemd user linger is enabled"; else warn "systemd user linger is disabled"; fi

if [[ -r .env ]]; then ok ".env exists"; else warn ".env is not configured"; fi

printf '\n%d failure(s), %d warning(s)\n' "${failures}" "${warnings}"
(( failures == 0 ))

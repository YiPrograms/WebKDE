#!/usr/bin/env bash
set -u

failures=0
warnings=0
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${WEBKDE_ENV_FILE:-/etc/webkde/webkde.env}"
if [[ ! -r "${env_file}" ]]; then
  env_file="${repo_dir}/.env"
fi
if [[ -r "${env_file}" ]]; then
  # shellcheck disable=SC1090
  source "${env_file}"
fi

ok() { printf 'OK   %s\n' "$*"; }
warn() { printf 'WARN %s\n' "$*"; warnings=$((warnings + 1)); }
fail() { printf 'FAIL %s\n' "$*"; failures=$((failures + 1)); }

for command in docker kwin_wayland_wrapper startplasma-wayland kscreen-doctor openssl pactl loginctl systemctl runuser; do
  if command -v "${command}" >/dev/null 2>&1; then
    ok "command: ${command}"
  else
    fail "missing command: ${command}"
  fi
done

if docker compose version >/dev/null 2>&1; then ok "Docker Compose v2 is available"; else fail "Docker Compose v2 is unavailable"; fi
if grep -qw avx2 /proc/cpuinfo; then ok "CPU supports AVX2"; else fail "CPU lacks AVX2 required by this Wayland design"; fi

dri_node="${WEBKDE_DRI_NODE:-/dev/dri/renderD128}"
if [[ -e "${dri_node}" ]]; then
  ok "DRI render node exists: ${dri_node}"
  if [[ -r "${dri_node}" && -w "${dri_node}" ]]; then ok "render node is accessible"; else fail "render node is not accessible"; fi
else
  fail "missing DRI render node: ${dri_node}"
fi

pulse_dir="${WEBKDE_PULSE_DIR:-${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/pulse}"
if [[ -S "${pulse_dir}/native" ]]; then ok "PipeWire-Pulse socket exists"; else warn "host Pulse socket is not active: ${pulse_dir}/native"; fi

if systemctl is-active --quiet docker.service; then ok "Docker daemon is active"; else fail "docker.service is inactive"; fi
if docker info >/dev/null 2>&1; then ok "Docker API is usable by this login"; else fail "Docker API is not usable by this login"; fi

if systemctl --user show-environment >/dev/null 2>&1; then ok "systemd user manager is reachable"; else fail "systemd user manager is not reachable"; fi
linger="$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)"
if [[ "${linger}" == yes ]]; then ok "systemd user lingering is enabled"; else fail "systemd user lingering is disabled"; fi

if systemctl --user is-active --quiet plasma-workspace.target && ! systemctl --user is-active --quiet webkde-session.service; then
  fail "another Plasma session is already active for this user"
else
  ok "no conflicting Plasma user session detected"
fi

if [[ -r "${env_file}" ]]; then ok "configuration is readable: ${env_file}"; else warn "configuration is absent; run ./scripts/configure.sh"; fi
if systemctl list-unit-files webkde.service --no-legend 2>/dev/null | grep -q webkde.service; then
  ok "system-wide WebKDE unit is installed"
else
  warn "system-wide WebKDE unit is not installed yet"
fi

printf '\n%d failure(s), %d warning(s)\n' "${failures}" "${warnings}"
(( failures == 0 ))

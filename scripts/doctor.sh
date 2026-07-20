#!/usr/bin/env bash
set -u

failures=0
warnings=0
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${WEBKDE_ENV_FILE:-${repo_dir}/.env}"
if [[ -r "${env_file}" ]]; then
  # shellcheck disable=SC1090
  source "${env_file}"
fi

ok() { printf 'OK   %s\n' "$*"; }
warn() { printf 'WARN %s\n' "$*"; warnings=$((warnings + 1)); }
fail() { printf 'FAIL %s\n' "$*"; failures=$((failures + 1)); }

for command in docker kwin_wayland_wrapper startplasma-wayland kscreen-doctor openssl pactl loginctl systemctl systemd-creds busctl python3 systemd-inhibit kde-inhibit; do
  if command -v "${command}" >/dev/null 2>&1; then
    ok "command: ${command}"
  else
    fail "missing command: ${command}"
  fi
done
if command -v qdbus6 >/dev/null 2>&1 || command -v qdbus-qt6 >/dev/null 2>&1 || command -v qdbus >/dev/null 2>&1; then
  ok "Qt D-Bus command is available"
else
  fail "missing Qt D-Bus command (qdbus6, qdbus-qt6, or qdbus)"
fi

if docker compose version >/dev/null 2>&1; then ok "Docker Compose v2 is available"; else fail "Docker Compose v2 is unavailable"; fi
if grep -qw avx2 /proc/cpuinfo; then ok "CPU supports AVX2"; else fail "CPU lacks AVX2 required by this Wayland design"; fi

dri_node="${WEBKDE_DRI_NODE:-}"
render_mode="${WEBKDE_RENDER_MODE:-auto}"
if [[ "${render_mode}" == auto ]]; then
  if [[ -n "${dri_node}" && -r "${dri_node}" && -w "${dri_node}" ]]; then render_mode=gpu; else render_mode=cpu; fi
fi
case "${render_mode}" in
  gpu)
    if [[ -e "${dri_node}" ]]; then
      ok "DRI render node exists: ${dri_node}"
      if [[ -r "${dri_node}" && -w "${dri_node}" ]]; then ok "render node is accessible"; else fail "render node is not accessible"; fi
    else
      fail "missing DRI render node: ${dri_node:-not configured}"
    fi
    ;;
  cpu) ok "software rendering and CPU video encoding are selected" ;;
  *) fail "WEBKDE_RENDER_MODE must be gpu, cpu, or auto" ;;
esac

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
wallet_credential="${repo_dir}/data/credentials/kwallet-password.cred"
if ! LC_ALL=C systemd-creds --help 2>&1 | grep -qE '^[[:space:]]+--user([[:space:]]|$)'; then
  warn "KWallet automatic unlock requires systemd 256 or newer"
elif [[ -r "${wallet_credential}" ]]; then
  ok "encrypted KWallet credential is configured"
else
  warn "KWallet automatic unlock is not configured; run ./scripts/configure.sh --wallet"
fi
if systemctl --user list-unit-files webkde.service --no-legend 2>/dev/null | grep -q '^webkde.service'; then
  ok "user-local WebKDE service is installed"
else
  warn "user-local WebKDE service is not installed"
fi

printf '\n%d failure(s), %d warning(s)\n' "${failures}" "${warnings}"
(( failures == 0 ))

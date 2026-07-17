#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${WEBKDE_ENV_FILE:-/etc/webkde/webkde.env}"
if [[ ! -r "${env_file}" ]]; then
  env_file="${repo_dir}/.env"
fi
# shellcheck disable=SC1090
source "${env_file}"

export WAYLAND_DISPLAY=wayland-0
export QT_QPA_PLATFORM=wayland
export XDG_SESSION_TYPE=wayland
"${repo_dir}/scripts/wait-wayland.sh" "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/wayland-0"
deadline=$((SECONDS + 120))
until kscreen-doctor -o 2>/dev/null | grep -q 'WL-1'; do
  if (( SECONDS >= deadline )); then
    echo "KScreen did not report WL-1 within 120 seconds." >&2
    exit 1
  fi
  sleep 1
done

# Start from a deterministic one-screen desktop. The browser applies its
# persisted 1/2-screen selection as soon as the stream connects.
kscreen-doctor output.WL-0.enable output.WL-0.position.0,0 output.WL-1.disable

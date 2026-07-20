#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${WEBKDE_ENV_FILE:-${repo_dir}/.env}"
# shellcheck disable=SC1090
source "${env_file}"

outer_socket="${WEBKDE_RUNTIME_DIR}/wayland-2"
"${repo_dir}/scripts/wait-wayland.sh" "${outer_socket}"

export WAYLAND_DISPLAY="${outer_socket}"
export XDG_SESSION_TYPE=wayland
export XDG_CURRENT_DESKTOP=KDE
export XDG_SESSION_DESKTOP=KDE
export KDE_FULL_SESSION=true
export QT_QPA_PLATFORM=wayland
export PULSE_SERVER="unix:${WEBKDE_PULSE_DIR}/native"
export PULSE_SINK=output

# The container normally creates this host PipeWire-Pulse null sink. Creating
# it here too makes session startup robust if audio initialization is delayed.
if command -v pactl >/dev/null 2>&1 && ! pactl list short sinks | awk '{print $2}' | grep -qx output; then
  pactl load-module module-null-sink sink_name=output \
    sink_properties=device.description=WebKDE_Output >/dev/null
fi

start_plasma="$(command -v startplasma-wayland)"
if [[ -n "${WEBKDE_PLASMA_DBUS_RUNNER:-}" ]]; then
  exec "${WEBKDE_PLASMA_DBUS_RUNNER}" "${start_plasma}"
fi
exec "${start_plasma}"

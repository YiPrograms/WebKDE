#!/usr/bin/env bash
set -euo pipefail

# Pixelflux owns wayland-1. Sway connects to it and creates wayland-2 in the
# same shared runtime directory for host-native nested KWin.
export XCURSOR_THEME=breeze_cursors
export XCURSOR_SIZE=24
export XKB_DEFAULT_LAYOUT="${XKB_DEFAULT_LAYOUT:-us}"
export XKB_DEFAULT_RULES="${XKB_DEFAULT_RULES:-evdev}"
export WAYLAND_DISPLAY=wayland-1
rm -f \
  "${XDG_RUNTIME_DIR}/wayland-2" \
  "${XDG_RUNTIME_DIR}/wayland-2.lock" \
  "${XDG_RUNTIME_DIR}"/sway-ipc.*.sock

export WLR_BACKENDS=wayland
export WLR_RENDERER=gles2
exec sway --unsupported-gpu --config /defaults/sway.conf

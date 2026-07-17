#!/usr/bin/env bash
set -euo pipefail

# Pixelflux owns wayland-1. Labwc connects to it and creates wayland-0 in the
# same shared runtime directory for host-native nested KWin.
export XCURSOR_THEME=breeze_cursors
export XCURSOR_SIZE=24
export XKB_DEFAULT_LAYOUT="${XKB_DEFAULT_LAYOUT:-us}"
export XKB_DEFAULT_RULES="${XKB_DEFAULT_RULES:-evdev}"
export WAYLAND_DISPLAY=wayland-1

exec labwc

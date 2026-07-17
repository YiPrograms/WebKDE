#!/usr/bin/env bash
set -euo pipefail

resolution="${1:?usage: wait-outer-resolution.sh WIDTHxHEIGHT}"
deadline=$((SECONDS + 20))

until docker exec \
    -e XDG_RUNTIME_DIR=/config/.XDG \
    -e WAYLAND_DISPLAY=wayland-1 \
    webkde-selkies wlr-randr 2>/dev/null | grep -q "${resolution}"; do
  if (( SECONDS >= deadline )); then
    echo "Pixelflux output did not report ${resolution} within 20 seconds." >&2
    exit 1
  fi
  sleep 0.25
done

#!/usr/bin/env bash
set -euo pipefail

socket="${1:?usage: wait-wayland.sh /path/to/wayland-socket}"
deadline=$((SECONDS + 240))
until [[ -S "${socket}" ]]; do
  if (( SECONDS >= deadline )); then
    echo "Wayland socket did not appear: ${socket}" >&2
    exit 1
  fi
  sleep 0.5
done

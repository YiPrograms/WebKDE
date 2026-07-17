#!/usr/bin/env bash
set -euo pipefail

env_file="${WEBKDE_ENV_FILE:-/etc/webkde/webkde.env}"

/opt/webkde/scripts/system-userctl.sh stop \
  webkde-inhibit.service webkde-session.service \
  plasma-workspace.target graphical-session.target || true

deadline=$((SECONDS + 45))
while /opt/webkde/scripts/system-userctl.sh is-active --quiet plasma-kwin_wayland.service; do
  if (( SECONDS >= deadline )); then
    echo "KWin did not stop within 45 seconds; preserving the outer compositor." >&2
    exit 1
  fi
  sleep 0.25
done

docker compose --project-directory /opt/webkde --env-file "${env_file}" \
  -f /opt/webkde/compose.yaml down

#!/usr/bin/env bash
set -euo pipefail

env_file="${WEBKDE_ENV_FILE:-/etc/webkde/webkde.env}"

/opt/webkde/scripts/system-userctl.sh stop webkde-session.service || true
docker compose --project-directory /opt/webkde --env-file "${env_file}" \
  -f /opt/webkde/compose.yaml down

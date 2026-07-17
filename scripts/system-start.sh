#!/usr/bin/env bash
set -euo pipefail

env_file="${WEBKDE_ENV_FILE:-/etc/webkde/webkde.env}"
# shellcheck disable=SC1090
source "${env_file}"

install -d -m 0700 -o "${WEBKDE_PUID}" -g "${WEBKDE_PGID}" "${WEBKDE_RUNTIME_DIR}"
install -d -m 0750 -o "${WEBKDE_PUID}" -g "${WEBKDE_PGID}" "${WEBKDE_CONFIG_DIR}"

cleanup_on_error() {
  docker compose --project-directory /opt/webkde --env-file "${env_file}" \
    -f /opt/webkde/compose.yaml down >/dev/null 2>&1 || true
}
trap cleanup_on_error ERR

docker compose --project-directory /opt/webkde --env-file "${env_file}" \
  -f /opt/webkde/compose.yaml up --detach --build
/opt/webkde/scripts/system-userctl.sh start webkde-session.service
trap - ERR

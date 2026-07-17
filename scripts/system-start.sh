#!/usr/bin/env bash
set -euo pipefail

env_file="${WEBKDE_ENV_FILE:-/etc/webkde/webkde.env}"
# shellcheck disable=SC1090
source "${env_file}"

install -d -m 0700 -o "${WEBKDE_PUID}" -g "${WEBKDE_PGID}" "${WEBKDE_RUNTIME_DIR}"
install -d -m 0750 -o "${WEBKDE_PUID}" -g "${WEBKDE_PGID}" "${WEBKDE_CONFIG_DIR}"

# A compositor does not necessarily unlink its Wayland socket after a crash or
# power loss. Remove only WebKDE's private sockets before bringing up their new
# owners, otherwise Labwc or KWin can mistake a stale pathname for readiness.
for socket_name in wayland-0 wayland-1; do
  rm -f \
    "${WEBKDE_RUNTIME_DIR}/${socket_name}" \
    "${WEBKDE_RUNTIME_DIR}/${socket_name}.lock"
done

cleanup_on_error() {
  docker compose --project-directory /opt/webkde --env-file "${env_file}" \
    -f /opt/webkde/compose.yaml down >/dev/null 2>&1 || true
}
trap cleanup_on_error ERR

docker compose --project-directory /opt/webkde --env-file "${env_file}" \
  -f /opt/webkde/compose.yaml up --detach --build
/opt/webkde/scripts/system-userctl.sh start webkde-session.service
trap - ERR

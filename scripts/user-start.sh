#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${WEBKDE_ENV_FILE:-${repo_dir}/.env}"
# shellcheck disable=SC1090
source "${env_file}"

install -d -m 0700 "${WEBKDE_RUNTIME_DIR}" "${WEBKDE_CONFIG_DIR}"

# Private compositor sockets may survive a crash or power loss.
for socket_index in {0..9}; do
  socket_name="wayland-${socket_index}"
  unlink "${WEBKDE_RUNTIME_DIR}/${socket_name}" 2>/dev/null || true
  unlink "${WEBKDE_RUNTIME_DIR}/${socket_name}.lock" 2>/dev/null || true
done

cleanup_on_error() {
  docker compose --project-directory "${WEBKDE_APP_DIR}" --env-file "${env_file}" \
    -f "${WEBKDE_APP_DIR}/compose.yaml" down >/dev/null 2>&1 || true
}
trap cleanup_on_error ERR

if [[ "${WEBKDE_BUILD_LOCAL:-false}" == true ]]; then
  docker compose --project-directory "${WEBKDE_APP_DIR}" --env-file "${env_file}" \
    -f "${WEBKDE_APP_DIR}/compose.yaml" up --detach --build
else
  docker compose --project-directory "${WEBKDE_APP_DIR}" --env-file "${env_file}" \
    -f "${WEBKDE_APP_DIR}/compose.yaml" pull selkies
  docker compose --project-directory "${WEBKDE_APP_DIR}" --env-file "${env_file}" \
    -f "${WEBKDE_APP_DIR}/compose.yaml" up --detach --no-build
fi
trap - ERR

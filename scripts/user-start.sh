#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${WEBKDE_ENV_FILE:-${repo_dir}/.env}"
# shellcheck disable=SC1090
source "${env_file}"

install -d -m 0700 "${WEBKDE_RUNTIME_DIR}" "${WEBKDE_CONFIG_DIR}"

render_mode="${WEBKDE_RENDER_MODE:-auto}"
dri_node="${WEBKDE_DRI_NODE:-}"
if [[ "${render_mode}" == auto ]]; then
  if [[ -n "${dri_node}" && -r "${dri_node}" && -w "${dri_node}" ]]; then
    render_mode=gpu
  else
    render_mode=cpu
  fi
fi
compose_files=(-f "${WEBKDE_APP_DIR}/compose.yaml")
case "${render_mode}" in
  gpu)
    [[ -n "${dri_node}" && -r "${dri_node}" && -w "${dri_node}" ]] || {
      echo "GPU mode requires an accessible WEBKDE_DRI_NODE: ${dri_node:-not configured}" >&2
      exit 1
    }
    compose_files+=(-f "${WEBKDE_APP_DIR}/compose.gpu.yaml")
    export WEBKDE_USE_CPU=false
    ;;
  cpu)
    export WEBKDE_DRI_NODE= WEBKDE_USE_CPU='true|locked'
    ;;
  *)
    echo "WEBKDE_RENDER_MODE must be gpu, cpu, or auto." >&2
    exit 1
    ;;
esac

# Private compositor sockets may survive a crash or power loss.
for socket_index in {0..9}; do
  socket_name="wayland-${socket_index}"
  unlink "${WEBKDE_RUNTIME_DIR}/${socket_name}" 2>/dev/null || true
  unlink "${WEBKDE_RUNTIME_DIR}/${socket_name}.lock" 2>/dev/null || true
done

cleanup_on_error() {
  docker compose --project-directory "${WEBKDE_APP_DIR}" --env-file "${env_file}" \
    "${compose_files[@]}" down >/dev/null 2>&1 || true
}
trap cleanup_on_error ERR

if [[ "${WEBKDE_BUILD_LOCAL:-false}" == true ]]; then
  docker compose --project-directory "${WEBKDE_APP_DIR}" --env-file "${env_file}" \
    "${compose_files[@]}" up --detach --build
else
  docker compose --project-directory "${WEBKDE_APP_DIR}" --env-file "${env_file}" \
    "${compose_files[@]}" pull selkies
  docker compose --project-directory "${WEBKDE_APP_DIR}" --env-file "${env_file}" \
    "${compose_files[@]}" up --detach --no-build
fi
trap - ERR

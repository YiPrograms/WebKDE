#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${WEBKDE_ENV_FILE:-${repo_dir}/.env}"
[[ -r "${env_file}" ]] || { echo "WebKDE configuration not found." >&2; exit 1; }
# shellcheck disable=SC1090
source "${env_file}"

mode="${1:-status}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
export QT_QPA_PLATFORM=wayland
export XDG_SESSION_TYPE=wayland

case "${mode}" in
  status)
    echo "Service:   $(systemctl --user is-active webkde.service 2>/dev/null || true)"
    container_id="$(docker compose --project-directory "${repo_dir}" --env-file "${env_file}" -f "${repo_dir}/compose.yaml" ps -q selkies 2>/dev/null || true)"
    echo "Container: $(if [[ -n "${container_id}" ]]; then docker inspect --format '{{.State.Status}}' "${container_id}" 2>/dev/null; else echo unavailable; fi)"
    echo "Plasma:    $(systemctl --user is-active webkde-session.service 2>/dev/null || true)"
    echo
    kscreen-doctor -o 2>/dev/null || echo "KScreen is not available yet."
    ;;
  *)
    echo "Display count is controlled from the WebKDE page. Usage: $0 status" >&2
    exit 2
    ;;
esac

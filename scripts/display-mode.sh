#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${WEBKDE_ENV_FILE:-/etc/webkde/webkde.env}"
if [[ ! -r "${env_file}" ]]; then
  env_file="${repo_dir}/.env"
fi
[[ -r "${env_file}" ]] || { echo "WebKDE configuration not found." >&2; exit 1; }
# shellcheck disable=SC1090
source "${env_file}"

mode="${1:-status}"
width="${WEBKDE_MONITOR_WIDTH}"
height="${WEBKDE_MONITOR_HEIGHT}"
dual_width=$((width * 2))

export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
export QT_QPA_PLATFORM=wayland
export XDG_SESSION_TYPE=wayland

require_session() {
  if ! systemctl --user is-active --quiet webkde-session.service; then
    echo "WebKDE Plasma session is not active." >&2
    exit 1
  fi
}

case "${mode}" in
  single)
    require_session
    kscreen-doctor output.WL-1.disable
    "${repo_dir}/scripts/selkies-resize.sh" "${width}x${height}"
    ;;
  dual)
    require_session
    "${repo_dir}/scripts/selkies-resize.sh" "${dual_width}x${height}"
    kscreen-doctor \
      output.WL-0.enable output.WL-0.position.0,0 \
      output.WL-1.enable output.WL-1.position."${width}",0
    ;;
  status)
    echo "System:    $(systemctl is-active webkde.service 2>/dev/null || true)"
    echo "Container: $(docker inspect --format '{{.State.Status}}' webkde-selkies 2>/dev/null || echo unavailable)"
    echo "Plasma:    $(systemctl --user is-active webkde-session.service 2>/dev/null || true)"
    echo
    kscreen-doctor -o 2>/dev/null || echo "KScreen is not available yet."
    ;;
  *)
    echo "usage: $0 {single|dual|status}" >&2
    exit 2
    ;;
esac

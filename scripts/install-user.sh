#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${repo_dir}/.env"
unit_dir="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"

if [[ ! -r "${env_file}" ]]; then
  "${repo_dir}/scripts/configure.sh"
fi

# shellcheck disable=SC1090
source "${env_file}"

for value in "${WEBKDE_MONITOR_WIDTH}" "${WEBKDE_MONITOR_HEIGHT}"; do
  [[ "${value}" =~ ^[0-9]+$ ]] || { echo "Monitor dimensions must be integers." >&2; exit 1; }
done

mkdir -p "${unit_dir}/plasma-kwin_wayland.service.d"

render() {
  local input="$1" output="$2"
  sed \
    -e "s|@REPO@|${repo_dir}|g" \
    -e "s|@RUNTIME@|${WEBKDE_RUNTIME_DIR}|g" \
    -e "s|@WIDTH@|${WEBKDE_MONITOR_WIDTH}|g" \
    -e "s|@HEIGHT@|${WEBKDE_MONITOR_HEIGHT}|g" \
    "${input}" >"${output}"
}

render "${repo_dir}/systemd/user/webkde-container.service.in" \
  "${unit_dir}/webkde-container.service"
render "${repo_dir}/systemd/user/webkde-session.service.in" \
  "${unit_dir}/webkde-session.service"
render "${repo_dir}/systemd/user/plasma-kwin-wayland-webkde.conf.in" \
  "${unit_dir}/plasma-kwin_wayland.service.d/webkde.conf"

systemctl --user daemon-reload
systemctl --user enable webkde-container.service webkde-session.service

echo "Installed WebKDE user units."
if ! id -nG | tr ' ' '\n' | grep -qx docker; then
  echo "Current login does not yet have the docker group. Log out and back in, then run:"
  echo "  systemctl --user start webkde-session.service"
  exit 0
fi

systemctl --user start webkde-session.service
echo "WebKDE startup requested. Follow logs with: make logs"

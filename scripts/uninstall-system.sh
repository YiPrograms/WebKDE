#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  echo "Run as root: sudo $0 [--purge]" >&2
  exit 1
fi

purge=false
if [[ "${1:-}" == --purge ]]; then
  purge=true
elif [[ $# -gt 0 ]]; then
  echo "usage: sudo $0 [--purge]" >&2
  exit 2
fi

env_file=/etc/webkde/webkde.env
if [[ -r "${env_file}" ]]; then
  # shellcheck disable=SC1090
  source "${env_file}"
  target_home="$(getent passwd "${WEBKDE_HOST_USER}" | cut -d: -f6)"
  systemctl disable --now webkde.service 2>/dev/null || true
  /opt/webkde/scripts/system-userctl.sh stop webkde-session.service 2>/dev/null || true
  rm -f \
    "${target_home}/.config/systemd/user/webkde-session.service" \
    "${target_home}/.config/systemd/user/plasma-kwin_wayland.service.d/webkde.conf"
  /opt/webkde/scripts/system-userctl.sh daemon-reload 2>/dev/null || true
else
  systemctl disable --now webkde.service 2>/dev/null || true
fi

rm -f /etc/systemd/system/webkde.service
rm -rf /opt/webkde
systemctl daemon-reload

if [[ "${purge}" == true ]]; then
  rm -rf /etc/webkde /var/lib/webkde
  echo "Removed WebKDE, including configuration and persistent data."
else
  echo "Removed WebKDE. /etc/webkde and /var/lib/webkde were preserved."
fi

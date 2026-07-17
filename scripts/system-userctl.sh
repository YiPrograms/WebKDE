#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  echo "system-userctl.sh must run as root." >&2
  exit 1
fi

env_file="${WEBKDE_ENV_FILE:-/etc/webkde/webkde.env}"
# shellcheck disable=SC1090
source "${env_file}"

runtime_dir="/run/user/${WEBKDE_PUID}"
exec runuser -u "${WEBKDE_HOST_USER}" -- env \
  XDG_RUNTIME_DIR="${runtime_dir}" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=${runtime_dir}/bus" \
  systemctl --user "$@"

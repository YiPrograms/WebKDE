#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${repo_dir}/.env"

if [[ -e "${env_file}" ]]; then
  echo "${env_file} already exists; leaving it unchanged."
  exit 0
fi

uid="$(id -u)"
gid="$(id -g)"
username="$(id -un)"
timezone="$(timedatectl show -p Timezone --value 2>/dev/null || true)"
timezone="${timezone:-Etc/UTC}"
password="$(openssl rand -base64 36 | tr -d '\n' | tr '/+' '_-')"
port="${1:-3001}"
[[ "${port}" =~ ^[0-9]+$ ]] && (( port >= 1 && port <= 65535 )) || {
  echo "usage: $0 [https-port]" >&2
  exit 2
}

umask 077
cat >"${env_file}" <<EOF
WEBKDE_HOST_USER=${username}
WEBKDE_INSTANCE=${username}
WEBKDE_PUID=${uid}
WEBKDE_PGID=${gid}
WEBKDE_COMPOSE_PROJECT=webkde-${uid}
WEBKDE_IMAGE=ghcr.io/yiprograms/webkde:latest
WEBKDE_BUILD_LOCAL=false
WEBKDE_APP_DIR=${repo_dir}
WEBKDE_TZ=${timezone}
WEBKDE_BIND=127.0.0.1
WEBKDE_HTTPS_PORT=${port}
WEBKDE_USER=webkde
WEBKDE_PASSWORD=${password}
WEBKDE_BASIC_AUTH=true
WEBKDE_SCROLL_SCALE=0.25
WEBKDE_RUNTIME_DIR=/run/user/${uid}/webkde
WEBKDE_PULSE_DIR=/run/user/${uid}/pulse
WEBKDE_DRI_NODE=/dev/dri/renderD128
WEBKDE_CONFIG_DIR=${repo_dir}/data/config
WEBKDE_MONITOR_WIDTH=1920
WEBKDE_MONITOR_HEIGHT=1080
WEBKDE_MAX_SCREENS=8
WEBKDE_ENCODER=x264enc
SELKIES_BASE_IMAGE=ghcr.io/linuxserver/baseimage-selkies:debiantrixie@sha256:ac7fd6d182238b4a99e66554c5e75be48a714e2a0c9da81bd18e171ff9ba3dd5
EOF
chmod 0600 "${env_file}"

echo "Created ${env_file} with a random Web password (mode 0600)."
echo "Review WEBKDE_BIND before exposing the service beyond this host."

#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${repo_dir}/.env"
wizard=false
if [[ "${1:-}" == --wizard ]]; then
  wizard=true
  shift
elif [[ -t 0 && -t 1 ]]; then
  wizard=true
fi
if (( $# > 1 )); then
  echo "usage: $0 [--wizard] [https-port]" >&2
  exit 2
fi
port_argument="${1:-}"

if [[ -r "${env_file}" ]]; then
  if [[ "${wizard}" == false ]]; then
    echo "${env_file} already exists; leaving it unchanged."
    exit 0
  fi
  # shellcheck disable=SC1090
  source "${env_file}"
fi

uid="$(id -u)"
gid="$(id -g)"
username="$(id -un)"
detected_timezone="$(timedatectl show -p Timezone --value 2>/dev/null || true)"
detected_timezone="${detected_timezone:-Etc/UTC}"
generated_password="$(openssl rand -base64 36 | tr -d '\n' | tr '/+' '_-')"

bind="${WEBKDE_BIND:-127.0.0.1}"
port="${port_argument:-${WEBKDE_HTTPS_PORT:-3001}}"
web_user="${WEBKDE_USER:-webkde}"
password="${WEBKDE_PASSWORD:-${generated_password}}"
basic_auth="${WEBKDE_BASIC_AUTH:-true}"
timezone="${WEBKDE_TZ:-${detected_timezone}}"
dri_node="${WEBKDE_DRI_NODE:-/dev/dri/renderD128}"
monitor_width="${WEBKDE_MONITOR_WIDTH:-1920}"
monitor_height="${WEBKDE_MONITOR_HEIGHT:-1080}"
max_screens="${WEBKDE_MAX_SCREENS:-8}"
build_local="${WEBKDE_BUILD_LOCAL:-false}"
image="${WEBKDE_IMAGE:-ghcr.io/yiprograms/webkde:latest}"

ask() {
  local label="$1" default="$2"
  printf '%s [%s]: ' "${label}" "${default}" >&3
  IFS= read -r answer <&3
  ANSWER="${answer:-${default}}"
}

ask_secret() {
  local existing="$1"
  if [[ "${existing}" == true ]]; then
    printf 'Web password [press Enter to keep current]: ' >&3
  else
    printf 'Web password [press Enter to generate]: ' >&3
  fi
  IFS= read -r -s answer <&3
  printf '\n' >&3
  ANSWER="${answer}"
}

ask_boolean() {
  local label="$1" default="$2" hint
  if [[ "${default}" == true ]]; then hint=Y/n; else hint=y/N; fi
  while :; do
    printf '%s [%s]: ' "${label}" "${hint}" >&3
    IFS= read -r answer <&3
    case "${answer}" in
      '') ANSWER="${default}"; return ;;
      y|Y|yes|YES) ANSWER=true; return ;;
      n|N|no|NO) ANSWER=false; return ;;
      *) printf 'Enter yes or no.\n' >&3 ;;
    esac
  done
}

if [[ "${wizard}" == true ]]; then
  if [[ ! -r /dev/tty || ! -w /dev/tty ]]; then
    echo "The configuration wizard requires a terminal. Set WEBKDE_NONINTERACTIVE=true for generated defaults." >&2
    exit 1
  fi
  exec 3<>/dev/tty
  printf '\nWebKDE configuration\n\n' >&3

  ask "HTTPS bind address" "${bind}"
  bind="${ANSWER}"
  while :; do
    ask "HTTPS port" "${port}"
    if [[ "${ANSWER}" =~ ^[0-9]+$ ]] && (( ANSWER >= 1 && ANSWER <= 65535 )); then port="${ANSWER}"; break; fi
    printf 'Enter a port from 1 through 65535.\n' >&3
  done
  while :; do
    ask "Web username" "${web_user}"
    if [[ "${ANSWER}" =~ ^[A-Za-z0-9._-]+$ ]]; then web_user="${ANSWER}"; break; fi
    printf 'Use letters, numbers, periods, underscores, or hyphens.\n' >&3
  done
  ask_secret "$([[ -n "${WEBKDE_PASSWORD:-}" ]] && echo true || echo false)"
  if [[ -n "${ANSWER}" ]]; then password="${ANSWER}"; fi
  while [[ ! "${password}" =~ ^[A-Za-z0-9._~!@%+=:,/-]+$ ]]; do
    printf 'Use a password without spaces, quotes, dollar signs, or hash signs.\n' >&3
    ask_secret false
    [[ -n "${ANSWER}" ]] && password="${ANSWER}"
  done
  ask_boolean "Enable built-in basic authentication" "${basic_auth}"
  basic_auth="${ANSWER}"
  ask "Timezone" "${timezone}"
  timezone="${ANSWER}"
  ask "DRI render node" "${dri_node}"
  dri_node="${ANSWER}"
  while :; do
    ask "KWin startup width" "${monitor_width}"
    [[ "${ANSWER}" =~ ^[0-9]+$ ]] && (( ANSWER > 0 )) && { monitor_width="${ANSWER}"; break; }
    printf 'Enter a positive integer.\n' >&3
  done
  while :; do
    ask "KWin startup height" "${monitor_height}"
    [[ "${ANSWER}" =~ ^[0-9]+$ ]] && (( ANSWER > 0 )) && { monitor_height="${ANSWER}"; break; }
    printf 'Enter a positive integer.\n' >&3
  done
  while :; do
    ask "Maximum virtual screens" "${max_screens}"
    [[ "${ANSWER}" =~ ^[1-8]$ ]] && { max_screens="${ANSWER}"; break; }
    printf 'Enter a value from 1 through 8.\n' >&3
  done
  ask_boolean "Build the container from this checkout" "${build_local}"
  build_local="${ANSWER}"
  exec 3>&-
else
  [[ "${port}" =~ ^[0-9]+$ ]] && (( port >= 1 && port <= 65535 )) || {
    echo "usage: $0 [--wizard] [https-port]" >&2
    exit 2
  }
fi

umask 077
cat >"${env_file}" <<EOF
WEBKDE_HOST_USER=${username}
WEBKDE_INSTANCE=${username}
WEBKDE_PUID=${uid}
WEBKDE_PGID=${gid}
WEBKDE_COMPOSE_PROJECT=webkde-${uid}
WEBKDE_IMAGE=${image}
WEBKDE_BUILD_LOCAL=${build_local}
WEBKDE_APP_DIR=${repo_dir}
WEBKDE_TZ=${timezone}
WEBKDE_BIND=${bind}
WEBKDE_HTTPS_PORT=${port}
WEBKDE_USER=${web_user}
WEBKDE_PASSWORD=${password}
WEBKDE_BASIC_AUTH=${basic_auth}
WEBKDE_SCROLL_SCALE=${WEBKDE_SCROLL_SCALE:-0.25}
WEBKDE_RUNTIME_DIR=/run/user/${uid}/webkde
WEBKDE_PULSE_DIR=/run/user/${uid}/pulse
WEBKDE_DRI_NODE=${dri_node}
WEBKDE_CONFIG_DIR=${repo_dir}/data/config
WEBKDE_MONITOR_WIDTH=${monitor_width}
WEBKDE_MONITOR_HEIGHT=${monitor_height}
WEBKDE_MAX_SCREENS=${max_screens}
WEBKDE_ENCODER=${WEBKDE_ENCODER:-x264enc}
SELKIES_BASE_IMAGE=${SELKIES_BASE_IMAGE:-ghcr.io/linuxserver/baseimage-selkies:debiantrixie@sha256:ac7fd6d182238b4a99e66554c5e75be48a714e2a0c9da81bd18e171ff9ba3dd5}
EOF
chmod 0600 "${env_file}"

echo "Created ${env_file} (mode 0600)."
echo "Run ./scripts/doctor.sh, then ./scripts/deploy.sh."

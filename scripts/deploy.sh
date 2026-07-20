#!/usr/bin/env bash
set -euo pipefail

if (( EUID == 0 )); then
  echo "Run deployment as the desktop user, without sudo: $0" >&2
  exit 1
fi

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${repo_dir}/.env"
generated_dir="${repo_dir}/systemd/generated"
user_unit_dir="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"

[[ -r "${env_file}" ]] || {
  echo "Configuration is missing. Run ./scripts/configure.sh, then retry." >&2
  exit 1
}

for command in docker systemctl kwin_wayland_wrapper kde-inhibit systemd-inhibit sleep; do
  command -v "${command}" >/dev/null 2>&1 || { echo "Missing prerequisite: ${command}" >&2; exit 1; }
done
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker API access is required for $(id -un)." >&2; exit 1; }
systemctl --user show-environment >/dev/null 2>&1 || { echo "The systemd user manager is unavailable." >&2; exit 1; }

qdbus_command=""
for candidate in qdbus6 qdbus-qt6 qdbus; do
  qdbus_command="$(command -v "${candidate}" 2>/dev/null || true)"
  [[ -n "${qdbus_command}" ]] && break
done
[[ -n "${qdbus_command}" ]] || { echo "qdbus is required for KDE clipboard synchronization." >&2; exit 1; }

plasma_runner=""
for candidate in \
  "$(command -v plasma-dbus-run-session-if-needed 2>/dev/null || true)" \
  /usr/lib/plasma-dbus-run-session-if-needed \
  /usr/libexec/plasma-dbus-run-session-if-needed \
  /usr/lib/x86_64-linux-gnu/libexec/plasma-dbus-run-session-if-needed; do
  if [[ -n "${candidate}" && -x "${candidate}" ]]; then
    plasma_runner="${candidate}"
    break
  fi
done
if [[ -z "${plasma_runner}" ]]; then
  plasma_runner="$(find /usr/lib /usr/libexec -type f -name plasma-dbus-run-session-if-needed -perm -u+x -print -quit 2>/dev/null || true)"
fi

set_config() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "${env_file}"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "${env_file}"
  else
    printf '%s=%s\n' "${key}" "${value}" >>"${env_file}"
  fi
}

uid="$(id -u)"
gid="$(id -g)"
username="$(id -un)"
runtime_root="${XDG_RUNTIME_DIR:-/run/user/${uid}}"
set_config WEBKDE_HOST_USER "${username}"
set_config WEBKDE_INSTANCE "${username}"
set_config WEBKDE_PUID "${uid}"
set_config WEBKDE_PGID "${gid}"
set_config WEBKDE_COMPOSE_PROJECT "webkde-${uid}"
set_config WEBKDE_APP_DIR "${repo_dir}"
set_config WEBKDE_RUNTIME_DIR "${runtime_root}/webkde"
set_config WEBKDE_PULSE_DIR "${runtime_root}/pulse"
set_config WEBKDE_CONFIG_DIR "${repo_dir}/data/config"
set_config WEBKDE_QDBUS "${qdbus_command}"
if ! grep -q '^WEBKDE_MAX_SCREENS=' "${env_file}"; then
  set_config WEBKDE_MAX_SCREENS "8"
fi
if [[ -n "${plasma_runner}" ]]; then
  set_config WEBKDE_PLASMA_DBUS_RUNNER "${plasma_runner}"
fi
chmod 0600 "${env_file}"

# shellcheck disable=SC1090
source "${env_file}"
for dimension in "${WEBKDE_MONITOR_WIDTH}" "${WEBKDE_MONITOR_HEIGHT}"; do
  [[ "${dimension}" =~ ^[0-9]+$ ]] && (( dimension > 0 )) || {
    echo "Monitor dimensions must be positive integers." >&2
    exit 1
  }
done
[[ "${WEBKDE_MAX_SCREENS}" =~ ^[1-8]$ ]] || { echo "WEBKDE_MAX_SCREENS must be between 1 and 8." >&2; exit 1; }
[[ "${WEBKDE_BUILD_LOCAL:-false}" =~ ^(true|false)$ ]] || { echo "WEBKDE_BUILD_LOCAL must be true or false." >&2; exit 1; }
[[ "${WEBKDE_HTTPS_PORT}" =~ ^[0-9]+$ ]] && (( WEBKDE_HTTPS_PORT >= 1 && WEBKDE_HTTPS_PORT <= 65535 )) || {
  echo "WEBKDE_HTTPS_PORT must be between 1 and 65535." >&2
  exit 1
}
[[ -n "${WEBKDE_PASSWORD}" && "${WEBKDE_PASSWORD}" != replace-with-a-long-random-password ]] || {
  echo "Set a real WEBKDE_PASSWORD in ${env_file} before deploying." >&2
  exit 1
}

systemctl --user stop webkde.service 2>/dev/null || true
install -d -m 0700 "${WEBKDE_CONFIG_DIR}"
install -d -m 0755 "${generated_dir}/plasma-kwin_wayland.service.d"

sed \
  -e "s|@APP_DIR@|${repo_dir}|g" \
  -e "s|@ENV_FILE@|${env_file}|g" \
  "${repo_dir}/systemd/user/webkde.service.in" >"${generated_dir}/webkde.service"
sed \
  -e "s|@APP_DIR@|${repo_dir}|g" \
  -e "s|@ENV_FILE@|${env_file}|g" \
  -e "s|@RUNTIME@|${WEBKDE_RUNTIME_DIR}|g" \
  -e "s|@SYSTEMCTL@|$(command -v systemctl)|g" \
  "${repo_dir}/systemd/user/webkde-session.service.in" >"${generated_dir}/webkde-session.service"
sed \
  -e "s|@KDE_INHIBIT@|$(command -v kde-inhibit)|g" \
  -e "s|@SYSTEMD_INHIBIT@|$(command -v systemd-inhibit)|g" \
  -e "s|@SLEEP@|$(command -v sleep)|g" \
  "${repo_dir}/systemd/user/webkde-inhibit.service.in" >"${generated_dir}/webkde-inhibit.service"
sed \
  -e "s|@APP_DIR@|${repo_dir}|g" \
  -e "s|@ENV_FILE@|${env_file}|g" \
  "${repo_dir}/systemd/user/webkde-bridge.service.in" >"${generated_dir}/webkde-bridge.service"
sed \
  -e "s|@RUNTIME@|${WEBKDE_RUNTIME_DIR}|g" \
  -e "s|@WIDTH@|${WEBKDE_MONITOR_WIDTH}|g" \
  -e "s|@HEIGHT@|${WEBKDE_MONITOR_HEIGHT}|g" \
  -e "s|@MAX_SCREENS@|${WEBKDE_MAX_SCREENS}|g" \
  -e "s|@KWIN_WRAPPER@|$(command -v kwin_wayland_wrapper)|g" \
  "${repo_dir}/systemd/user/plasma-kwin-wayland-webkde.conf.in" \
  >"${generated_dir}/plasma-kwin_wayland.service.d/webkde.conf"
chmod 0644 \
  "${generated_dir}/webkde.service" \
  "${generated_dir}/webkde-session.service" \
  "${generated_dir}/webkde-inhibit.service" \
  "${generated_dir}/webkde-bridge.service" \
  "${generated_dir}/plasma-kwin_wayland.service.d/webkde.conf"

install -d -m 0755 "${user_unit_dir}/plasma-kwin_wayland.service.d"
for unit in webkde.service webkde-session.service webkde-inhibit.service webkde-bridge.service; do
  ln -sfn "${generated_dir}/${unit}" "${user_unit_dir}/${unit}"
done
ln -sfn \
  "${generated_dir}/plasma-kwin_wayland.service.d/webkde.conf" \
  "${user_unit_dir}/plasma-kwin_wayland.service.d/webkde.conf"

systemctl --user daemon-reload
systemctl --user enable --now webkde.service

echo "WebKDE deployed for ${username} on ${WEBKDE_BIND}:${WEBKDE_HTTPS_PORT}."
echo "Checkout: ${repo_dir}"
echo "Configuration: ${env_file}"
echo "Status: systemctl --user status webkde.service"

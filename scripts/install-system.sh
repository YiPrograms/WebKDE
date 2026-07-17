#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  echo "Run as root: sudo $0 <desktop-user>" >&2
  exit 1
fi

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${repo_dir}" == /opt/webkde ]]; then
  echo "Run the installer from a source checkout, not from /opt/webkde." >&2
  exit 1
fi
target_user="${1:-${SUDO_USER:-}}"
if [[ -z "${target_user}" || "${target_user}" == root ]] || ! id "${target_user}" >/dev/null 2>&1; then
  echo "Specify an existing non-root desktop user: sudo $0 <desktop-user>" >&2
  exit 1
fi

target_uid="$(id -u "${target_user}")"
target_gid="$(id -g "${target_user}")"
target_home="$(getent passwd "${target_user}" | cut -d: -f6)"
kwin_wrapper="$(command -v kwin_wayland_wrapper || true)"
if [[ -z "${kwin_wrapper}" ]]; then
  echo "kwin_wayland_wrapper is missing. Complete the host prerequisites first." >&2
  exit 1
fi
kde_inhibit="$(command -v kde-inhibit || true)"
systemd_inhibit="$(command -v systemd-inhibit || true)"
systemctl_command="$(command -v systemctl || true)"
sleep_command="$(command -v sleep || true)"
for value in "${kde_inhibit}" "${systemd_inhibit}" "${systemctl_command}" "${sleep_command}"; do
  if [[ -z "${value}" ]]; then
    echo "The KDE and systemd inhibitor commands are required. Complete the host prerequisites first." >&2
    exit 1
  fi
done

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

source_env="${repo_dir}/.env"
installed_env=/etc/webkde/webkde.env
if [[ ! -e "${installed_env}" && ! -r "${source_env}" ]]; then
  echo "Configuration is missing. Run ./scripts/configure.sh as ${target_user}, review .env, then retry." >&2
  exit 1
fi

for command in docker systemctl runuser; do
  command -v "${command}" >/dev/null 2>&1 || { echo "Missing prerequisite: ${command}" >&2; exit 1; }
done
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required." >&2; exit 1; }

if systemctl list-unit-files webkde.service --no-legend 2>/dev/null | grep -q webkde.service; then
  systemctl stop webkde.service || true
fi

install -d -m 0755 /opt/webkde /etc/webkde /etc/systemd/system
rm -rf /opt/webkde/container /opt/webkde/docs /opt/webkde/scripts /opt/webkde/systemd
cp -a \
  "${repo_dir}/container" \
  "${repo_dir}/docs" \
  "${repo_dir}/scripts" \
  "${repo_dir}/systemd" \
  /opt/webkde/
for file in Dockerfile compose.yaml Makefile README.md LICENSE .dockerignore .env.example; do
  install -m 0644 "${repo_dir}/${file}" "/opt/webkde/${file}"
done

if [[ ! -e "${installed_env}" ]]; then
  install -m 0640 -o root -g "${target_gid}" "${source_env}" "${installed_env}"
else
  chown root:"${target_gid}" "${installed_env}"
  chmod 0640 "${installed_env}"
fi

set_config() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "${installed_env}"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "${installed_env}"
  else
    printf '%s=%s\n' "${key}" "${value}" >>"${installed_env}"
  fi
}

set_config WEBKDE_HOST_USER "${target_user}"
set_config WEBKDE_PUID "${target_uid}"
set_config WEBKDE_PGID "${target_gid}"
set_config WEBKDE_RUNTIME_DIR "/run/user/${target_uid}/webkde"
set_config WEBKDE_PULSE_DIR "/run/user/${target_uid}/pulse"
set_config WEBKDE_CONFIG_DIR "/var/lib/webkde/config"
if [[ -n "${plasma_runner}" ]]; then
  set_config WEBKDE_PLASMA_DBUS_RUNNER "${plasma_runner}"
fi

# shellcheck disable=SC1090
source "${installed_env}"
for dimension in "${WEBKDE_MONITOR_WIDTH}" "${WEBKDE_MONITOR_HEIGHT}"; do
  [[ "${dimension}" =~ ^[0-9]+$ ]] || { echo "Monitor dimensions must be positive integers." >&2; exit 1; }
done
[[ "${WEBKDE_DEFAULT_MODE}" == single || "${WEBKDE_DEFAULT_MODE}" == dual ]] || {
  echo "WEBKDE_DEFAULT_MODE must be single or dual." >&2
  exit 1
}
[[ -n "${WEBKDE_PASSWORD}" && "${WEBKDE_PASSWORD}" != replace-with-a-long-random-password ]] || {
  echo "Set a real WEBKDE_PASSWORD in .env before installing." >&2
  exit 1
}

install -d -m 0750 -o "${target_uid}" -g "${target_gid}" /var/lib/webkde/config
sed -e "s|@UID@|${target_uid}|g" \
  /opt/webkde/systemd/system/webkde.service.in \
  >/etc/systemd/system/webkde.service
chmod 0644 /etc/systemd/system/webkde.service

user_unit_dir="${target_home}/.config/systemd/user"
install -d -m 0755 -o "${target_uid}" -g "${target_gid}" \
  "${user_unit_dir}/plasma-kwin_wayland.service.d"
sed \
  -e "s|@RUNTIME@|${WEBKDE_RUNTIME_DIR}|g" \
  -e "s|@SYSTEMCTL@|${systemctl_command}|g" \
  /opt/webkde/systemd/user/webkde-session.service.in \
  >"${user_unit_dir}/webkde-session.service"
sed \
  -e "s|@KDE_INHIBIT@|${kde_inhibit}|g" \
  -e "s|@SYSTEMD_INHIBIT@|${systemd_inhibit}|g" \
  -e "s|@SLEEP@|${sleep_command}|g" \
  /opt/webkde/systemd/user/webkde-inhibit.service.in \
  >"${user_unit_dir}/webkde-inhibit.service"
sed \
  -e "s|@RUNTIME@|${WEBKDE_RUNTIME_DIR}|g" \
  -e "s|@WIDTH@|${WEBKDE_MONITOR_WIDTH}|g" \
  -e "s|@HEIGHT@|${WEBKDE_MONITOR_HEIGHT}|g" \
  -e "s|@KWIN_WRAPPER@|${kwin_wrapper}|g" \
  /opt/webkde/systemd/user/plasma-kwin-wayland-webkde.conf.in \
  >"${user_unit_dir}/plasma-kwin_wayland.service.d/webkde.conf"
chown "${target_uid}:${target_gid}" \
  "${user_unit_dir}" \
  "${user_unit_dir}/plasma-kwin_wayland.service.d" \
  "${user_unit_dir}/webkde-inhibit.service" \
  "${user_unit_dir}/webkde-session.service" \
  "${user_unit_dir}/plasma-kwin_wayland.service.d/webkde.conf"
chmod 0644 \
  "${user_unit_dir}/webkde-inhibit.service" \
  "${user_unit_dir}/webkde-session.service" \
  "${user_unit_dir}/plasma-kwin_wayland.service.d/webkde.conf"

systemctl daemon-reload
systemctl start "user@${target_uid}.service"
WEBKDE_ENV_FILE="${installed_env}" /opt/webkde/scripts/system-userctl.sh daemon-reload
systemctl enable --now webkde.service

echo "WebKDE installed for ${target_user}."
echo "Configuration: ${installed_env}"
echo "Status: systemctl status webkde.service"

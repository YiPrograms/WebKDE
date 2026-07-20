#!/usr/bin/env bash
set -euo pipefail

if (( EUID == 0 )); then
  echo "Run this installer as the desktop user, without sudo." >&2
  exit 1
fi

repository="YiPrograms/WebKDE"
ref="${WEBKDE_REF:-main}"
install_dir="${WEBKDE_INSTALL_DIR:-${XDG_DATA_HOME:-${HOME}/.local/share}/webkde}"
port="${WEBKDE_HTTPS_PORT:-3001}"

[[ "${ref}" =~ ^[A-Za-z0-9._/-]+$ && "${ref}" != *..* ]] || {
  echo "WEBKDE_REF contains unsupported characters." >&2
  exit 2
}
[[ "${install_dir}" == /* ]] || {
  echo "WEBKDE_INSTALL_DIR must be an absolute path." >&2
  exit 2
}
if [[ -d "${install_dir}/.git" ]]; then
  echo "${install_dir} is a Git checkout; update it with Git and run ./scripts/deploy.sh." >&2
  exit 1
fi

for command in curl tar install; do
  command -v "${command}" >/dev/null 2>&1 || { echo "Missing prerequisite: ${command}" >&2; exit 1; }
done

temporary="$(mktemp -d)"
cleanup() {
  find "${temporary}" -depth -mindepth 1 -delete 2>/dev/null || true
  rmdir "${temporary}" 2>/dev/null || true
}
trap cleanup EXIT

archive="${temporary}/webkde.tar.gz"
source_dir="${temporary}/source"
preserve_dir="${temporary}/preserve"
install -d -m 0700 "${source_dir}" "${preserve_dir}"
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
  "https://codeload.github.com/${repository}/tar.gz/${ref}" \
  --output "${archive}"
tar -xzf "${archive}" --strip-components=1 -C "${source_dir}"
[[ -x "${source_dir}/scripts/deploy.sh" && -r "${source_dir}/compose.yaml" ]] || {
  echo "The downloaded archive is not a WebKDE release." >&2
  exit 1
}

unit_link="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user/webkde.service"
if [[ -L "${unit_link}" && "$(readlink -f -- "${unit_link}")" == "${install_dir}/"* ]]; then
  systemctl --user stop webkde.service 2>/dev/null || true
fi

if [[ -f "${install_dir}/.env" ]]; then
  mv "${install_dir}/.env" "${preserve_dir}/.env"
fi
if [[ -d "${install_dir}/data" ]]; then
  mv "${install_dir}/data" "${preserve_dir}/data"
fi
if [[ -d "${install_dir}" ]]; then
  find "${install_dir}" -depth -mindepth 1 -delete
  rmdir "${install_dir}"
fi

install -d -m 0700 "${install_dir}"
cp -a "${source_dir}/." "${install_dir}/"
if [[ -f "${preserve_dir}/.env" ]]; then
  mv "${preserve_dir}/.env" "${install_dir}/.env"
fi
if [[ -d "${preserve_dir}/data" ]]; then
  mv "${preserve_dir}/data" "${install_dir}/data"
fi

cd "${install_dir}"
fresh_configuration=false
if [[ ! -f .env ]]; then
  fresh_configuration=true
fi
./scripts/configure.sh "${port}"
if [[ "${fresh_configuration}" == true && "${ref}" =~ ^v([0-9].*)$ ]]; then
  sed -i "s|^WEBKDE_IMAGE=.*|WEBKDE_IMAGE=ghcr.io/yiprograms/webkde:${BASH_REMATCH[1]}|" .env
fi
./scripts/deploy.sh

echo "WebKDE is installed in ${install_dir}."
echo "Open https://127.0.0.1:${port}/ after the container becomes healthy."

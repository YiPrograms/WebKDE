#!/usr/bin/env bash
set -euo pipefail

if (( EUID == 0 )); then
  echo "Run this command as the desktop user, without sudo: $0 [--purge]" >&2
  exit 1
fi

purge=false
if [[ "${1:-}" == --purge ]]; then
  purge=true
elif [[ $# -gt 0 ]]; then
  echo "usage: $0 [--purge]" >&2
  exit 2
fi

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${repo_dir}/.env"
generated_dir="${repo_dir}/systemd/generated"
user_unit_dir="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"

systemctl --user disable --now webkde.service 2>/dev/null || true
if [[ -r "${env_file}" ]]; then
  docker compose --project-directory "${repo_dir}" --env-file "${env_file}" \
    -f "${repo_dir}/compose.yaml" down 2>/dev/null || true
fi

remove_link() {
  local link="$1" expected="$2"
  if [[ -L "${link}" && "$(readlink -f -- "${link}")" == "${expected}" ]]; then
    unlink "${link}"
  fi
}

for unit in webkde.service webkde-session.service webkde-inhibit.service webkde-bridge.service webkde-wallet.service; do
  remove_link "${user_unit_dir}/${unit}" "${generated_dir}/${unit}"
done
remove_link \
  "${user_unit_dir}/plasma-kwin_wayland.service.d/webkde.conf" \
  "${generated_dir}/plasma-kwin_wayland.service.d/webkde.conf"
systemctl --user daemon-reload

if [[ -d "${generated_dir}" ]]; then
  find "${generated_dir}" -depth -mindepth 1 -delete
  rmdir "${generated_dir}"
fi

if [[ "${purge}" == true ]]; then
  if [[ -d "${repo_dir}/data/config" ]]; then
    find "${repo_dir}/data/config" -depth -mindepth 1 -delete
    rmdir "${repo_dir}/data/config"
  fi
  unlink "${env_file}" 2>/dev/null || true
  echo "WebKDE services, configuration, and persistent data removed from this checkout."
else
  echo "WebKDE services removed. ${env_file} and ${repo_dir}/data/config are preserved."
fi

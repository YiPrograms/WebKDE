#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  echo "Run this script as root: sudo $0 [username]" >&2
  exit 1
fi

target_user="${1:-${SUDO_USER:-}}"
if [[ -z "${target_user}" || "${target_user}" == root ]]; then
  echo "Specify the non-root desktop user: sudo $0 <username>" >&2
  exit 1
fi
if ! id "${target_user}" >/dev/null 2>&1; then
  echo "Unknown user: ${target_user}" >&2
  exit 1
fi

if command -v pacman >/dev/null 2>&1; then
  pacman -S --needed --noconfirm docker docker-compose
else
  echo "This installer currently supports Arch/CachyOS hosts (pacman required)." >&2
  exit 1
fi

usermod -aG docker "${target_user}"
loginctl enable-linger "${target_user}"
systemctl enable --now docker.service

echo "Host prerequisites installed for ${target_user}."
echo "Start a new login/SSH session so docker group membership takes effect."

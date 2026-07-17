#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${WEBKDE_ENV_FILE:-/etc/webkde/webkde.env}"
if [[ ! -r "${env_file}" ]]; then
  env_file="${repo_dir}/.env"
fi
# shellcheck disable=SC1090
source "${env_file}"

case "${WEBKDE_DEFAULT_MODE:-single}" in
  dual)
    exit 0
    ;;
  single)
    ;;
  *)
    echo "WEBKDE_DEFAULT_MODE must be single or dual." >&2
    exit 2
    ;;
esac

export WAYLAND_DISPLAY=wayland-0
deadline=$((SECONDS + 120))
until kscreen-doctor -o 2>/dev/null | grep -q 'WL-1'; do
  if (( SECONDS >= deadline )); then
    echo "KScreen did not report WL-1 within 120 seconds." >&2
    exit 1
  fi
  sleep 1
done

kscreen-doctor output.WL-1.disable

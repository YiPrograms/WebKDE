#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${WEBKDE_ENV_FILE:-${repo_dir}/.env}"
# shellcheck disable=SC1090
source "${env_file}"

docker compose --project-directory "${WEBKDE_APP_DIR}" --env-file "${env_file}" \
  -f "${WEBKDE_APP_DIR}/compose.yaml" down

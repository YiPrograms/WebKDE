#!/usr/bin/env bash
set -euo pipefail

deadline=$((SECONDS + 120))
until docker info >/dev/null 2>&1; do
  if (( SECONDS >= deadline )); then
    echo "Docker did not become available within 120 seconds." >&2
    exit 1
  fi
  sleep 1
done

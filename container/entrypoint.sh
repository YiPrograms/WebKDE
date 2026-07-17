#!/usr/bin/env bash
set -euo pipefail

case "${WEBKDE_BASIC_AUTH:-true}" in
  true)
    ;;
  false)
    # The LinuxServer nginx init enables Basic Auth based on whether PASSWORD
    # exists, not whether it is non-empty. Remove both variables completely.
    unset PASSWORD CUSTOM_USER
    ;;
  *)
    echo "WEBKDE_BASIC_AUTH must be true or false." >&2
    exit 2
    ;;
esac

exec /init

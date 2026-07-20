#!/usr/bin/env bash
set -euo pipefail

max_screens="${WEBKDE_MAX_SCREENS:-8}"
case "${max_screens}" in
  [1-8]) ;;
  *) echo "WEBKDE_MAX_SCREENS must be between 1 and 8." >&2; exit 2 ;;
esac
sed -i -E "s/data-max-screens=\"[1-8]\"/data-max-screens=\"${max_screens}\"/" \
  /usr/share/selkies/selkies-dashboard/index.html
scroll_scale="${WEBKDE_SCROLL_SCALE:-0.25}"
[[ "${scroll_scale}" =~ ^([0-9]+([.][0-9]*)?|[.][0-9]+)$ ]] || scroll_scale=0.25
sed -i -E "s/data-scroll-scale=\"[^\"]+\"/data-scroll-scale=\"${scroll_scale}\"/" \
  /usr/share/selkies/selkies-dashboard/index.html

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

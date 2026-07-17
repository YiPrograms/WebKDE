#!/usr/bin/env bash
set -u

env_file="${WEBKDE_ENV_FILE:-/etc/webkde/webkde.env}"
# shellcheck disable=SC1090
source "${env_file}"

bridge_dir="${WEBKDE_RUNTIME_DIR}/webkde-bridge"
install -d -m 0700 "${bridge_dir}"
export WAYLAND_DISPLAY=wayland-0
export QT_QPA_PLATFORM=wayland
export XDG_SESSION_TYPE=wayland

qdbus="${WEBKDE_QDBUS:-}"
if [[ -z "${qdbus}" ]]; then
  for candidate in qdbus6 qdbus-qt6 qdbus; do
    qdbus="$(command -v "${candidate}" 2>/dev/null || true)"
    [[ -n "${qdbus}" ]] && break
  done
fi
if [[ -z "${qdbus}" ]]; then
  echo "qdbus is required for KDE clipboard synchronization." >&2
  exit 1
fi

atomic_write() {
  local target="$1" value="$2" temporary
  temporary="${target}.tmp.$$"
  printf '%s' "${value}" >"${temporary}" && mv -f "${temporary}" "${target}"
}

last_to_kde=''
last_from_kde=''
last_layout=''
while :; do
  if [[ -r "${bridge_dir}/to-kde" ]]; then
    to_kde="$(<"${bridge_dir}/to-kde")"
    if [[ "${to_kde}" != "${last_to_kde}" ]]; then
      if "${qdbus}" org.kde.klipper /klipper \
          org.kde.klipper.klipper.setClipboardContents "${to_kde}" >/dev/null 2>&1; then
        last_to_kde="${to_kde}"
        last_from_kde="${to_kde}"
        atomic_write "${bridge_dir}/from-kde" "${to_kde}"
      fi
    fi
  fi

  from_kde="$("${qdbus}" org.kde.klipper /klipper \
    org.kde.klipper.klipper.getClipboardContents 2>/dev/null || true)"
  if [[ "${from_kde}" != "${last_from_kde}" ]]; then
    last_from_kde="${from_kde}"
    atomic_write "${bridge_dir}/from-kde" "${from_kde}"
  fi

  if [[ -r "${bridge_dir}/layout-request" ]]; then
    layout="$(<"${bridge_dir}/layout-request")"
    if [[ "${layout}" != "${last_layout}" ]]; then
      case "${layout}" in
        1,*)
          kscreen-doctor output.WL-0.enable output.WL-0.position.0,0 \
            output.WL-1.disable >/dev/null 2>&1 && last_layout="${layout}"
          ;;
        2,horizontal,*|2,vertical,*)
          # Enable the second nested output first. Labwc tiles both KWin
          # windows moments later; the follow-up keeps their origins adjacent.
          kscreen-doctor output.WL-0.enable output.WL-0.position.0,0 \
            output.WL-1.enable >/dev/null 2>&1 || true
          sleep 1
          geometry="$(kscreen-doctor -o 2>/dev/null | awk '
            /Output:.*WL-0/{found=1; next}
            found && /Geometry:/{print; exit}')"
          size="$(sed -n 's/.*Geometry: [^ ]* \([0-9][0-9]*\)x\([0-9][0-9]*\).*/\1 \2/p' <<<"${geometry}")"
          read -r first_width first_height <<<"${size:-1920 1080}"
          if [[ "${layout}" == 2,horizontal,* ]]; then
            position="${first_width},0"
          else
            position="0,${first_height}"
          fi
          if kscreen-doctor output.WL-0.position.0,0 \
              output.WL-1.position."${position}" >/dev/null 2>&1; then
            last_layout="${layout}"
          fi
          ;;
      esac
    fi
  fi
  sleep 0.25
done

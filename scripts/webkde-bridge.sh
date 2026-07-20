#!/usr/bin/env bash
set -u

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${WEBKDE_ENV_FILE:-${repo_dir}/.env}"
# shellcheck disable=SC1090
source "${env_file}"
WEBKDE_MAX_SCREENS="${WEBKDE_MAX_SCREENS:-8}"

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
output_config="${HOME}/.config/kwinoutputconfig.json"
last_output_config_signature="$(stat -c '%Y:%s' "${output_config}" 2>/dev/null || true)"
while :; do
  if [[ -r "${bridge_dir}/reset-displays" ]]; then
    reset_request="$(<"${bridge_dir}/reset-displays")"
    if [[ "${reset_request}" =~ ^[0-9]+$ ]]; then
      unlink "${bridge_dir}/reset-displays"
      if systemctl --user stop plasma-kwin_wayland.service; then
        if [[ -f "${output_config}" ]]; then
          cp -p "${output_config}" "${output_config}.webkde-backup"
          rm -f "${output_config}"
        fi
        systemctl --user start plasma-kwin_wayland.service
        for ((attempt=0; attempt<80; attempt++)); do
          current_kwin_pid="$(systemctl --user show plasma-kwin_wayland.service \
            --property=MainPID --value 2>/dev/null || true)"
          if [[ "${current_kwin_pid}" =~ ^[1-9][0-9]*$ ]]; then
            break
          fi
          sleep 0.25
        done
        last_layout=''
        last_output_config_signature=''
        continue
      fi
    fi
  fi

  if [[ -r "${bridge_dir}/restart-kwin" ]]; then
    restart_request="$(<"${bridge_dir}/restart-kwin")"
    if [[ "${restart_request}" =~ ^[0-9]+$ ]]; then
      unlink "${bridge_dir}/restart-kwin"
      previous_kwin_pid="$(systemctl --user show plasma-kwin_wayland.service \
        --property=MainPID --value 2>/dev/null || true)"
      if systemctl --user --no-block restart plasma-kwin_wayland.service; then
        for ((attempt=0; attempt<60; attempt++)); do
          current_kwin_pid="$(systemctl --user show plasma-kwin_wayland.service \
            --property=MainPID --value 2>/dev/null || true)"
          if [[ "${current_kwin_pid}" =~ ^[1-9][0-9]*$ \
              && "${current_kwin_pid}" != "${previous_kwin_pid}" ]]; then
            break
          fi
          sleep 0.25
        done
        # Reapply the persisted KScreen layout after the new compositor is ready.
        last_layout=''
        continue
      fi
    fi
  fi

  if [[ -r "${bridge_dir}/restart-plasma" ]]; then
    restart_request="$(<"${bridge_dir}/restart-plasma")"
    if [[ "${restart_request}" =~ ^[0-9]+$ ]]; then
      unlink "${bridge_dir}/restart-plasma"
      systemctl --user --no-block restart webkde-session.service
      exit 0
    fi
  fi

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
    # KScreen's Display Settings can resize nested KWin output windows behind
    # Sway's back. A fractional output scale plus interactive rearrangement
    # creates a positive geometry feedback loop. WebKDE owns this topology, so
    # reapply it whenever KScreen persists a competing configuration.
    output_config_signature="$(stat -c '%Y:%s' "${output_config}" 2>/dev/null || true)"
    if [[ -n "${last_layout}" && "${output_config_signature}" != "${last_output_config_signature}" ]]; then
      last_layout=''
    fi
    layout="$(<"${bridge_dir}/layout-request")"
    if [[ "${layout}" != "${last_layout}" ]]; then
      IFS=, read -r count orientation canvas_width canvas_height request_id grid_positions desktop_positions <<<"${layout}"
      if [[ "${count}" =~ ^[1-8]$ && "${orientation}" =~ ^(horizontal|vertical|grid)$ ]]; then
        output_args=()
        position_args=()
        offset=0
        IFS=';' read -r -a grid_position <<<"${grid_positions:-}"
        IFS=';' read -r -a desktop_position <<<"${desktop_positions:-${grid_positions:-}}"
        for ((index=0; index<WEBKDE_MAX_SCREENS; index++)); do
          if (( index < count )); then
            output_args+=(
              "output.WL-${index}.enable"
              "output.WL-${index}.priority.$((index + 1))"
              "output.WL-${index}.scale.1"
            )
            if [[ "${orientation}" == horizontal ]]; then
              position_args+=("output.WL-${index}.position.${offset},0")
              size=$((canvas_width / count + (index < canvas_width % count ? 1 : 0)))
              offset=$((offset + size))
            elif [[ "${orientation}" == vertical ]]; then
              position_args+=("output.WL-${index}.position.0,${offset}")
              size=$((canvas_height / count + (index < canvas_height % count ? 1 : 0)))
              offset=$((offset + size))
            elif [[ "${desktop_position[index]:-}" =~ ^([0-9]+):([0-9]+)$ ]]; then
              position_args+=("output.WL-${index}.position.${BASH_REMATCH[1]},${BASH_REMATCH[2]}")
            else
              position_args=()
              break
            fi
          else
            output_args+=("output.WL-${index}.disable")
          fi
        done
        (( ${#position_args[@]} == count )) \
          && kscreen-doctor "${output_args[@]}" "${position_args[@]}" >/dev/null 2>&1 \
          && last_layout="${layout}"
        if [[ "${last_layout}" == "${layout}" ]]; then
          last_output_config_signature="$(stat -c '%Y:%s' "${output_config}" 2>/dev/null || true)"
        fi
      fi
    fi
  fi
  sleep 0.25
done

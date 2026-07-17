#!/usr/bin/env bash
set -euo pipefail

unit_dir="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"

systemctl --user disable --now webkde-session.service webkde-container.service 2>/dev/null || true
rm -f \
  "${unit_dir}/webkde-session.service" \
  "${unit_dir}/webkde-container.service" \
  "${unit_dir}/plasma-kwin_wayland.service.d/webkde.conf"
rmdir "${unit_dir}/plasma-kwin_wayland.service.d" 2>/dev/null || true
systemctl --user daemon-reload

echo "Removed WebKDE user units. Persistent data and .env were preserved."

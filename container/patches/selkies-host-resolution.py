#!/usr/bin/env python3
"""Make host-issued resize commands survive browser reconnects/resizes."""

from pathlib import Path


matches = list(Path("/lsiopy/lib").glob("python*/site-packages/selkies/selkies.py"))
if len(matches) != 1:
    raise SystemExit(f"Expected one Selkies selkies.py, found {len(matches)}")

selkies = matches[0]
source = selkies.read_text()

old_settings = """            target_w = None
            target_h = None
            server_is_manual, _ = self.cli_args.is_manual_resolution_mode
            client_wants_manual = sanitize_value("is_manual_resolution_mode", settings.get("is_manual_resolution_mode"))
            if server_is_manual:
"""
new_settings = """            target_w = None
            target_h = None
            server_is_manual, _ = self.cli_args.is_manual_resolution_mode
            client_wants_manual = sanitize_value("is_manual_resolution_mode", settings.get("is_manual_resolution_mode"))
            forced_resolution = getattr(self, "webkde_forced_resolutions", {}).get(display_id)
            if forced_resolution:
                try:
                    target_w, target_h = (int(value) for value in forced_resolution.split("x", 1))
                    data_logger.info(f"WebKDE host override: forcing {display_id} to {target_w}x{target_h}.")
                except (ValueError, TypeError):
                    data_logger.error(f"Ignoring invalid WebKDE host resolution: {forced_resolution}")
                    getattr(self, "webkde_forced_resolutions", {}).pop(display_id, None)
            elif server_is_manual:
"""

old_resize = """                        data_logger.info(f"Received resize request for {display_id}: {target_res_str} from {raddr}")

                        await on_resize_handler(target_res_str, self.app, self, display_id)
"""
new_resize = """                        is_host_control = client_display_id is None
                        forced_resolutions = getattr(self, "webkde_forced_resolutions", None)
                        if forced_resolutions is None:
                            forced_resolutions = self.webkde_forced_resolutions = {}
                        if not is_host_control and display_id in forced_resolutions:
                            data_logger.info(
                                f"Ignoring browser resize for host-controlled {display_id}: {target_res_str}"
                            )
                            continue
                        if is_host_control:
                            forced_resolutions[display_id] = target_res_str
                            data_logger.info(
                                f"WebKDE host set persistent resolution for {display_id}: {target_res_str}"
                            )
                        data_logger.info(f"Received resize request for {display_id}: {target_res_str} from {raddr}")

                        await on_resize_handler(target_res_str, self.app, self, display_id)
                        if is_host_control:
                            await websocket.send(f"WEBKDE_RESIZED,{display_id},{target_res_str}")
"""

for old, new, description in (
    (old_settings, new_settings, "settings override"),
    (old_resize, new_resize, "resize control"),
):
    if source.count(old) != 1:
        raise SystemExit(f"Pinned Selkies source no longer matches: {description}")
    source = source.replace(old, new)

selkies.write_text(source)

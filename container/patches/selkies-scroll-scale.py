#!/usr/bin/env python3
"""Scale Pixelflux Wayland wheel deltas before they reach nested KWin."""

from pathlib import Path


matches = list(Path("/lsiopy/lib").glob("python*/site-packages/selkies/input_handler.py"))
if len(matches) != 1:
    raise SystemExit(f"Expected one Selkies input_handler.py, found {len(matches)}")

input_handler = matches[0]
source = input_handler.read_text()

old_scale = """                        mag = float(max(1, scroll_magnitude))

                        if bit_index == 0: # Left
"""
new_scale = """                        mag = float(max(1, scroll_magnitude))
                        try:
                            scroll_scale = float(os.environ.get("WEBKDE_SCROLL_SCALE", "0.25"))
                        except (TypeError, ValueError):
                            scroll_scale = 0.25
                        scroll_scale = max(0.05, min(scroll_scale, 4.0))

                        if bit_index == 0: # Left
"""

if source.count(old_scale) != 1:
    raise SystemExit("Pinned Selkies source no longer matches: scroll scale location")
if source.count("10.0 * mag") != 4:
    raise SystemExit("Pinned Selkies source no longer matches: scroll deltas")

source = source.replace(old_scale, new_scale)
source = source.replace("10.0 * mag", "10.0 * scroll_scale * mag")
input_handler.write_text(source)

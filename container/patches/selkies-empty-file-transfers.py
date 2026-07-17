#!/usr/bin/env python3
"""Honor Selkies' documented `none` value for the file transfer list."""

from pathlib import Path


matches = list(Path("/lsiopy/lib").glob("python*/site-packages/selkies/settings.py"))
if len(matches) != 1:
    raise SystemExit(f"Expected one Selkies settings.py, found {len(matches)}")

settings = matches[0]
source = settings.read_text()
old = """                        valid_items = [item for item in user_items if item in master_list]
                        if not valid_items:
                            logging.warning(f"Invalid value(s) '{raw_value}' for {name}. Using system default.")
"""
new = """                        valid_items = [item for item in user_items if item in master_list]
                        disable_list = stype == 'list' and str(raw_value).strip().lower() in ('', 'none')
                        if not valid_items and not disable_list:
                            logging.warning(f"Invalid value(s) '{raw_value}' for {name}. Using system default.")
"""
if source.count(old) != 1:
    raise SystemExit("Pinned Selkies settings parser no longer matches the expected source")
settings.write_text(source.replace(old, new))

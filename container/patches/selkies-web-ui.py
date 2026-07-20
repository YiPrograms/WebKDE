#!/usr/bin/env python3
from pathlib import Path

index = Path("/usr/share/selkies/selkies-dashboard/index.html")
source = index.read_text()
needle = "</body>"
if source.count(needle) != 1:
    raise SystemExit("Unexpected Selkies dashboard HTML")
index.write_text(source.replace(
    needle,
    '<script src="./webkde-controls.js" data-max-screens="8" data-scroll-scale="0.25"></script></body>',
))

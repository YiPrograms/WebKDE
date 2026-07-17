#!/usr/bin/env python3
"""Add WebKDE layout control and the host clipboard bridge to Selkies."""

from pathlib import Path


root = Path("/lsiopy/lib")
selkies_matches = list(root.glob("python*/site-packages/selkies/selkies.py"))
input_matches = list(root.glob("python*/site-packages/selkies/input_handler.py"))
if len(selkies_matches) != 1 or len(input_matches) != 1:
    raise SystemExit("Expected exactly one installed Selkies Python package")

selkies = selkies_matches[0]
source = selkies.read_text()
needle = '                    elif message.startswith("SET_NATIVE_CURSOR_RENDERING,"):'
handler = '''                    elif message.startswith("WEBKDE_LAYOUT,"):
                        try:
                            parts = message.split(",")
                            count = int(parts[1])
                            orientation = parts[2]
                            if count not in (1, 2) or orientation not in ("horizontal", "vertical"):
                                raise ValueError("invalid layout")

                            request_dir = pathlib.Path(os.environ.get(
                                "WEBKDE_BRIDGE_DIR", "/config/.XDG/webkde-bridge"
                            ))
                            request_dir.mkdir(parents=True, exist_ok=True)
                            viewport = ",".join(parts[3:5]) if len(parts) >= 5 else "0,0"
                            request = f"{count},{orientation},{viewport}\\n"
                            temporary = request_dir / "layout-request.tmp"
                            temporary.write_text(request)
                            temporary.replace(request_dir / "layout-request")

                            # The host bridge enables WL-1 before Labwc tries to tile it.
                            if count == 2:
                                await asyncio.sleep(0.75)
                            key = 0xFFC6 if count == 1 else (0xFFC7 if orientation == "horizontal" else 0xFFC8)
                            for keysym in (0xFFE3, 0xFFE9, key):
                                await self.input_handler.send_x11_keypress(keysym, down=True)
                            for keysym in (key, 0xFFE9, 0xFFE3):
                                await self.input_handler.send_x11_keypress(keysym, down=False)
                            await websocket.send(f"WEBKDE_LAYOUT_APPLIED,{count},{orientation}")
                        except (IndexError, ValueError, OSError) as error:
                            data_logger.warning(f"Invalid WebKDE layout request: {message}: {error}")

'''
if source.count(needle) != 1:
    raise SystemExit("Pinned Selkies source no longer matches layout insertion point")
selkies.write_text(source.replace(needle, handler + needle))

input_handler = input_matches[0]
source = input_handler.read_text()
read_needle = '''    async def read_clipboard(self, use_binary=False):
        """Reads clipboard. Supports Wayland (wl-paste) and X11 (xclip)."""
'''
read_replacement = read_needle + '''        bridge_dir = os.environ.get("WEBKDE_BRIDGE_DIR")
        if bridge_dir and not use_binary:
            try:
                return pathlib.Path(bridge_dir, "from-kde").read_text(), "text/plain"
            except FileNotFoundError:
                pass
            except OSError as error:
                logger_webrtc_input.warning(f"Could not read KDE clipboard bridge: {error}")
'''
write_needle = '''    async def write_clipboard(self, data, mime_type="text/plain"):
        if not data:
            return True
'''
write_replacement = write_needle + '''        bridge_dir = os.environ.get("WEBKDE_BRIDGE_DIR")
        if bridge_dir and mime_type.startswith("text/"):
            try:
                directory = pathlib.Path(bridge_dir)
                directory.mkdir(parents=True, exist_ok=True)
                text = data.decode("utf-8", errors="replace") if isinstance(data, bytes) else data
                temporary = directory / "to-kde.tmp"
                temporary.write_text(text)
                temporary.replace(directory / "to-kde")
                return True
            except OSError as error:
                logger_webrtc_input.warning(f"Could not write KDE clipboard bridge: {error}")
                return False
'''
for old, new, description in (
    (read_needle, read_replacement, "clipboard read"),
    (write_needle, write_replacement, "clipboard write"),
):
    if source.count(old) != 1:
        raise SystemExit(f"Pinned Selkies source no longer matches {description}")
    source = source.replace(old, new)

# pathlib is not imported by the upstream input handler.
source = source.replace("import os\nimport base64", "import os\nimport pathlib\nimport base64", 1)
input_handler.write_text(source)

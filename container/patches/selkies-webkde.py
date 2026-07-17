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
                            max_screens = int(os.environ.get("WEBKDE_MAX_SCREENS", "8"))
                            if not 1 <= count <= max_screens:
                                raise ValueError("invalid layout")

                            client_info = self.display_clients.get(client_display_id or "primary", {})
                            canvas_width = int(client_info.get("width") or parts[3])
                            canvas_height = int(client_info.get("height") or parts[4])
                            orientation = "horizontal" if canvas_width >= canvas_height else "vertical"

                            request_dir = pathlib.Path(os.environ.get(
                                "WEBKDE_BRIDGE_DIR", "/config/.XDG/webkde-bridge"
                            ))
                            request_dir.mkdir(parents=True, exist_ok=True)
                            request = f"{count},{orientation},{canvas_width},{canvas_height}\\n"
                            temporary = request_dir / "layout-request.tmp"
                            temporary.write_text(request)
                            temporary.replace(request_dir / "layout-request")

                            # Give the host bridge time to enable the requested KWin outputs,
                            # then place their outer windows through Sway's native IPC.
                            await asyncio.sleep(1.0)
                            sockets = list(pathlib.Path("/config/.XDG").glob("sway-ipc.*.sock"))
                            if not sockets:
                                raise OSError("Sway IPC socket is unavailable")
                            sway_socket = max(sockets, key=lambda path: path.stat().st_mtime)
                            offset = 0
                            for index in range(max_screens):
                                criteria = f'[title=".*WL-{index}.*"]'
                                if index >= count:
                                    command = f"{criteria} move scratchpad"
                                elif orientation == "horizontal":
                                    size = canvas_width // count + (1 if index < canvas_width % count else 0)
                                    command = (f"{criteria} move workspace current, floating enable, "
                                               f"resize set width {size} px height {canvas_height} px, "
                                               f"move position {offset} px 0 px")
                                    offset += size
                                else:
                                    size = canvas_height // count + (1 if index < canvas_height % count else 0)
                                    command = (f"{criteria} move workspace current, floating enable, "
                                               f"resize set width {canvas_width} px height {size} px, "
                                               f"move position 0 px {offset} px")
                                    offset += size
                                process = await asyncio.create_subprocess_exec(
                                    "swaymsg", "--socket", str(sway_socket), command,
                                    stdout=asyncio.subprocess.DEVNULL,
                                    stderr=asyncio.subprocess.PIPE,
                                )
                                _, stderr = await process.communicate()
                                if process.returncode:
                                    raise OSError(stderr.decode(errors="replace").strip())
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

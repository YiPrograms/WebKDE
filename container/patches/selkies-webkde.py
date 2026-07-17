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

                            previous_task = getattr(self, "webkde_layout_task", None)
                            if previous_task and not previous_task.done():
                                previous_task.cancel()

                            async def apply_webkde_layout(
                                layout_count=count,
                                layout_orientation=orientation,
                                layout_width=canvas_width,
                                layout_height=canvas_height,
                                layout_max_screens=max_screens,
                                layout_message=message,
                            ):
                                try:
                                    # Keep consuming WebSocket messages while this timer runs.
                                    # A newer resize or screen-count request cancels this task.
                                    await asyncio.sleep(0.3)

                                    request_dir = pathlib.Path(os.environ.get(
                                        "WEBKDE_BRIDGE_DIR", "/config/.XDG/webkde-bridge"
                                    ))
                                    request_dir.mkdir(parents=True, exist_ok=True)
                                    request_id = time.monotonic_ns()
                                    request = (f"{layout_count},{layout_orientation},"
                                               f"{layout_width},{layout_height},{request_id}\\n")
                                    request_path = request_dir / "layout-request"
                                    temporary = request_dir / "layout-request.tmp"
                                    temporary.write_text(request)
                                    temporary.replace(request_path)

                                    # Allow the host KScreen bridge one polling interval to
                                    # enable, position, and prioritize the requested outputs.
                                    await asyncio.sleep(0.35)
                                    if request_path.read_text() != request:
                                        return

                                    sockets = list(pathlib.Path("/config/.XDG").glob(
                                        "sway-ipc.*.sock"
                                    ))
                                    if not sockets:
                                        raise OSError("Sway IPC socket is unavailable")
                                    sway_socket = max(sockets, key=lambda path: path.stat().st_mtime)

                                    async def run_sway(command, ignore_missing=False):
                                        process = await asyncio.create_subprocess_exec(
                                            "swaymsg", "--socket", str(sway_socket), command,
                                            stdout=asyncio.subprocess.PIPE,
                                            stderr=asyncio.subprocess.PIPE,
                                        )
                                        stdout, stderr = await process.communicate()
                                        try:
                                            replies = json.loads(stdout.decode())
                                        except (UnicodeDecodeError, json.JSONDecodeError) as error:
                                            detail = (stderr or stdout).decode(
                                                errors="replace"
                                            ).strip()
                                            raise OSError(
                                                detail or f"invalid swaymsg response: {error}"
                                            )
                                        failures = [
                                            reply.get("error", "unknown Sway error")
                                            for reply in replies if not reply.get("success")
                                        ]
                                        if failures:
                                            if ignore_missing and all(
                                                error == "No matching node." for error in failures
                                            ):
                                                return
                                            raise OSError("; ".join(failures))
                                        if process.returncode:
                                            detail = stderr.decode(errors="replace").strip()
                                            raise OSError(detail or "swaymsg failed")

                                    active_commands = []
                                    offset = 0
                                    for index in range(layout_count):
                                        criteria = f'[title=".*WL-{index}.*"]'
                                        if layout_orientation == "horizontal":
                                            size = layout_width // layout_count + (
                                                1 if index < layout_width % layout_count else 0
                                            )
                                            command = (
                                                f"{criteria} move workspace current, floating enable, "
                                                f"resize set width {size} px height {layout_height} px, "
                                                f"move position {offset} px 0 px"
                                            )
                                        else:
                                            size = layout_height // layout_count + (
                                                1 if index < layout_height % layout_count else 0
                                            )
                                            command = (
                                                f"{criteria} move workspace current, floating enable, "
                                                f"resize set width {layout_width} px height {size} px, "
                                                f"move position 0 px {offset} px"
                                            )
                                        active_commands.append(command)
                                        offset += size

                                    for index in range(layout_count, layout_max_screens):
                                        await run_sway(
                                            f'[title=".*WL-{index}.*"] move scratchpad',
                                            ignore_missing=True,
                                        )

                                    # KWin may publish one final size hint after an output is
                                    # enabled. Reapply the exact canvas partition once it has.
                                    for layout_pass in range(2):
                                        if request_path.read_text() != request:
                                            return
                                        for command in active_commands:
                                            await run_sway(command)
                                        if layout_pass == 0:
                                            await asyncio.sleep(0.5)

                                    await websocket.send(
                                        f"WEBKDE_LAYOUT_APPLIED,{layout_count},{layout_orientation}"
                                    )
                                except asyncio.CancelledError:
                                    data_logger.debug("Superseded WebKDE layout request")
                                except (OSError, ValueError) as error:
                                    data_logger.warning(
                                        f"Invalid WebKDE layout request: {layout_message}: {error}"
                                    )

                            self.webkde_layout_task = asyncio.create_task(
                                apply_webkde_layout()
                            )
                        except (IndexError, ValueError, OSError) as error:
                            data_logger.warning(f"Invalid WebKDE layout request: {message}: {error}")

                    elif message in ("WEBKDE_RESTART_PLASMA", "WEBKDE_RESTART_KWIN"):
                        try:
                            request_dir = pathlib.Path(os.environ.get(
                                "WEBKDE_BRIDGE_DIR", "/config/.XDG/webkde-bridge"
                            ))
                            request_dir.mkdir(parents=True, exist_ok=True)
                            request = f"{time.monotonic_ns()}\\n"
                            component = "plasma" if message.endswith("PLASMA") else "kwin"
                            temporary = request_dir / f"restart-{component}.tmp"
                            temporary.write_text(request)
                            temporary.replace(request_dir / f"restart-{component}")
                            await websocket.send(f"{message}_ACCEPTED")
                        except OSError as error:
                            data_logger.warning(f"Could not request a desktop restart: {error}")

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

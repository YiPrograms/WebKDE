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
handler = '''                    elif message.startswith("WEBKDE_LAYOUT_V3,"):
                        try:
                            payload = json.loads(message.split(",", 1)[1])
                            raw_screens = payload["screens"]
                            raw_anchors = payload["anchors"]
                            max_screens = int(os.environ.get("WEBKDE_MAX_SCREENS", "8"))
                            if (not isinstance(raw_screens, list)
                                    or not 1 <= len(raw_screens) <= max_screens):
                                raise ValueError("invalid screen list")
                            if client_display_id not in (None, "primary"):
                                raise ValueError("only the primary client may change the layout")

                            requested_screens = []
                            indices = set()
                            for raw_screen in raw_screens:
                                if not isinstance(raw_screen, dict):
                                    raise ValueError("invalid screen")
                                index = raw_screen.get("index")
                                width = raw_screen.get("width")
                                height = raw_screen.get("height")
                                if (not isinstance(index, int) or isinstance(index, bool)
                                        or not isinstance(width, int) or isinstance(width, bool)
                                        or not isinstance(height, int) or isinstance(height, bool)
                                        or not 1 <= index <= len(raw_screens)
                                        or not 8 <= width <= 16384
                                        or not 2 <= height <= 16384
                                        or index in indices):
                                    raise ValueError("invalid screen dimensions")
                                indices.add(index)
                                requested_screens.append({
                                    "index": index, "width": width, "height": height,
                                })
                            if indices != set(range(1, len(raw_screens) + 1)):
                                raise ValueError("missing screen")
                            requested_screens.sort(key=lambda item: item["index"])

                            if not isinstance(raw_anchors, list) or len(raw_anchors) != len(raw_screens):
                                raise ValueError("invalid screen attachments")
                            anchors = {}
                            for raw_anchor in raw_anchors:
                                if not isinstance(raw_anchor, dict):
                                    raise ValueError("invalid screen attachment")
                                index = raw_anchor.get("index")
                                if not isinstance(index, int) or index not in indices or index in anchors:
                                    raise ValueError("invalid attached screen")
                                if index == 1:
                                    anchors[index] = {"index": 1}
                                    continue
                                parent = raw_anchor.get("parent")
                                side = raw_anchor.get("side")
                                align = raw_anchor.get("align")
                                offset = raw_anchor.get("offset")
                                if (not isinstance(parent, int) or parent not in indices or parent == index
                                        or side not in ("left", "right", "top", "bottom")
                                        or align not in ("start", "center", "end")
                                        or (offset is not None
                                            and (not isinstance(offset, int)
                                                 or isinstance(offset, bool)
                                                 or abs(offset) > 32768))):
                                    raise ValueError("invalid screen attachment")
                                anchors[index] = {
                                    "index": index, "parent": parent,
                                    "side": side, "align": align,
                                }
                                if offset is not None:
                                    anchors[index]["offset"] = offset
                            if set(anchors) != indices or anchors.get(1) != {"index": 1}:
                                raise ValueError("Screen 1 must be the attachment root")
                            for index in range(2, len(raw_screens) + 1):
                                visited = {index}
                                cursor = index
                                while cursor != 1:
                                    cursor = anchors[cursor]["parent"]
                                    if cursor in visited:
                                        raise ValueError("cyclic screen attachments")
                                    visited.add(cursor)

                            atlas_limit = 4080

                            def split_free_rect(free, used):
                                if (used["x"] >= free["x"] + free["width"]
                                        or used["x"] + used["width"] <= free["x"]
                                        or used["y"] >= free["y"] + free["height"]
                                        or used["y"] + used["height"] <= free["y"]):
                                    return [free]
                                result = []
                                if used["x"] > free["x"]:
                                    result.append({
                                        "x": free["x"], "y": free["y"],
                                        "width": used["x"] - free["x"],
                                        "height": free["height"],
                                    })
                                if used["x"] + used["width"] < free["x"] + free["width"]:
                                    result.append({
                                        "x": used["x"] + used["width"], "y": free["y"],
                                        "width": free["x"] + free["width"]
                                        - used["x"] - used["width"],
                                        "height": free["height"],
                                    })
                                if used["y"] > free["y"]:
                                    result.append({
                                        "x": free["x"], "y": free["y"],
                                        "width": free["width"],
                                        "height": used["y"] - free["y"],
                                    })
                                if used["y"] + used["height"] < free["y"] + free["height"]:
                                    result.append({
                                        "x": free["x"],
                                        "y": used["y"] + used["height"],
                                        "width": free["width"],
                                        "height": free["y"] + free["height"]
                                        - used["y"] - used["height"],
                                    })
                                return [rect for rect in result
                                        if rect["width"] > 0 and rect["height"] > 0]

                            def prune_free_rects(rects):
                                result = []
                                for index, rect in enumerate(rects):
                                    contained = False
                                    for other_index, other in enumerate(rects):
                                        if (index != other_index
                                                and rect["x"] >= other["x"]
                                                and rect["y"] >= other["y"]
                                                and rect["x"] + rect["width"]
                                                <= other["x"] + other["width"]
                                                and rect["y"] + rect["height"]
                                                <= other["y"] + other["height"]):
                                            contained = True
                                            break
                                    if not contained:
                                        result.append(rect)
                                return result

                            def pack_at_scale(pack_scale):
                                sized = [{
                                    "index": item["index"],
                                    "requestedWidth": item["width"],
                                    "requestedHeight": item["height"],
                                    "width": max(8, int(item["width"] * pack_scale) // 8 * 8),
                                    "height": max(2, int(item["height"] * pack_scale) // 2 * 2),
                                } for item in requested_screens]
                                order_keys = (
                                    lambda item: (-item["width"] * item["height"],
                                                  -item["width"], item["index"]),
                                    lambda item: (-max(item["width"], item["height"]),
                                                  item["index"]),
                                    lambda item: (-item["height"], -item["width"],
                                                  item["index"]),
                                    lambda item: (-item["width"], -item["height"],
                                                  item["index"]),
                                    lambda item: (item["index"],),
                                )
                                orders = {}
                                for order_key in order_keys:
                                    order = sorted(sized, key=order_key)
                                    orders[tuple(item["index"] for item in order)] = order
                                best_pack = None
                                best_score = None
                                for order in orders.values():
                                    free_rects = [{
                                        "x": 0, "y": 0,
                                        "width": atlas_limit, "height": atlas_limit,
                                    }]
                                    placed = []
                                    for item in order:
                                        choices = []
                                        for free in free_rects:
                                            if item["width"] <= free["width"] and item["height"] <= free["height"]:
                                                choices.append((
                                                    min(free["width"] - item["width"],
                                                        free["height"] - item["height"]),
                                                    max(free["width"] - item["width"],
                                                        free["height"] - item["height"]),
                                                    free["y"], free["x"], free,
                                                ))
                                        if not choices:
                                            placed = []
                                            break
                                        free = min(choices, key=lambda choice: choice[:4])[4]
                                        used = dict(item, x=free["x"], y=free["y"])
                                        placed.append(used)
                                        split = []
                                        for free_rect in free_rects:
                                            split.extend(split_free_rect(free_rect, used))
                                        free_rects = prune_free_rects(split)
                                    if not placed:
                                        continue
                                    atlas_width = max(rect["x"] + rect["width"] for rect in placed)
                                    atlas_height = max(rect["y"] + rect["height"] for rect in placed)
                                    score = (
                                        atlas_width * atlas_height,
                                        max(atlas_width, atlas_height),
                                        atlas_height, atlas_width,
                                    )
                                    if best_score is None or score < best_score:
                                        best_score = score
                                        best_pack = {
                                            "screens": sorted(placed, key=lambda item: item["index"]),
                                            "atlasWidth": atlas_width,
                                            "atlasHeight": atlas_height,
                                        }
                                return best_pack

                            scale = 1.0
                            packed = pack_at_scale(scale)
                            if packed is None:
                                low = 0.0
                                high = 1.0
                                for _ in range(18):
                                    middle = (low + high) / 2
                                    candidate = pack_at_scale(middle)
                                    if candidate is None:
                                        high = middle
                                    else:
                                        low = middle
                                        packed = candidate
                                scale = low
                                packed = pack_at_scale(scale)
                            if packed is None:
                                raise ValueError("screens cannot fit in the capture atlas")

                            physical_rects = packed["screens"]
                            atlas_width = packed["atlasWidth"]
                            atlas_height = packed["atlasHeight"]
                            previous_task = getattr(self, "webkde_layout_task", None)
                            if previous_task and not previous_task.done():
                                previous_task.cancel()
                            client_info = self.display_clients.get("primary", {})
                            current_resolution = (
                                int(client_info.get("width") or 0),
                                int(client_info.get("height") or 0),
                            )
                            if current_resolution != (atlas_width, atlas_height):
                                await on_resize_handler(
                                    f"{atlas_width}x{atlas_height}", self.app, self, "primary"
                                )

                            desktop_scale = float(getattr(self, "webkde_scale", 1.0))
                            logical_rects = [{
                                "index": rect["index"],
                                "x": round(rect["x"] / desktop_scale),
                                "y": round(rect["y"] / desktop_scale),
                                "width": max(1, round(rect["width"] / desktop_scale)),
                                "height": max(1, round(rect["height"] / desktop_scale)),
                            } for rect in physical_rects]
                            size_by_index = {rect["index"]: rect for rect in logical_rects}
                            desktop_by_index = {1: dict(size_by_index[1], x=0, y=0)}
                            pending = set(range(2, len(raw_screens) + 1))
                            while pending:
                                progress = False
                                for index in tuple(pending):
                                    relation = anchors[index]
                                    parent = desktop_by_index.get(relation["parent"])
                                    if parent is None:
                                        continue
                                    child = size_by_index[index]
                                    x = parent["x"]
                                    y = parent["y"]
                                    if relation["side"] == "left":
                                        x -= child["width"]
                                    elif relation["side"] == "right":
                                        x += parent["width"]
                                    elif relation["side"] == "top":
                                        y -= child["height"]
                                    else:
                                        y += parent["height"]
                                    if relation["side"] in ("left", "right"):
                                        if "offset" in relation:
                                            y += round(relation["offset"] * scale / desktop_scale)
                                        elif relation["align"] == "center":
                                            y += round((parent["height"] - child["height"]) / 2)
                                        elif relation["align"] == "end":
                                            y += parent["height"] - child["height"]
                                    else:
                                        if "offset" in relation:
                                            x += round(relation["offset"] * scale / desktop_scale)
                                        elif relation["align"] == "center":
                                            x += round((parent["width"] - child["width"]) / 2)
                                        elif relation["align"] == "end":
                                            x += parent["width"] - child["width"]
                                    desktop_by_index[index] = dict(child, x=x, y=y)
                                    pending.remove(index)
                                    progress = True
                                if not progress:
                                    raise ValueError("screen attachments do not reach Screen 1")
                            desktop_rects = [desktop_by_index[index]
                                             for index in range(1, len(raw_screens) + 1)]
                            min_x = min(rect["x"] for rect in desktop_rects)
                            min_y = min(rect["y"] for rect in desktop_rects)
                            for rect in desktop_rects:
                                rect["x"] -= min_x
                                rect["y"] -= min_y
                            for left_index, left in enumerate(desktop_rects):
                                for right in desktop_rects[left_index + 1:]:
                                    if (left["x"] < right["x"] + right["width"]
                                            and left["x"] + left["width"] > right["x"]
                                            and left["y"] < right["y"] + right["height"]
                                            and left["y"] + left["height"] > right["y"]):
                                        raise ValueError(
                                            f'Screen {left["index"]} overlaps Screen {right["index"]}'
                                        )
                            logical_width = max(rect["x"] + rect["width"]
                                                for rect in desktop_rects)
                            logical_height = max(rect["y"] + rect["height"]
                                                 for rect in desktop_rects)
                            applied_payload = {
                                "mode": "per-tab", "count": len(raw_screens),
                                "scale": scale, "desktopScale": desktop_scale,
                                "atlasWidth": atlas_width, "atlasHeight": atlas_height,
                                "screens": physical_rects, "desktopScreens": desktop_rects,
                            }

                            async def apply_webkde_mixed_layout(
                                layout_count=len(raw_screens),
                                layout_max_screens=max_screens,
                                layout_width=logical_width,
                                layout_height=logical_height,
                                layout_rects=logical_rects,
                                layout_desktop_rects=desktop_rects,
                                layout_payload=applied_payload,
                                layout_message=message,
                            ):
                                try:
                                    await asyncio.sleep(0.3)
                                    request_dir = pathlib.Path(os.environ.get(
                                        "WEBKDE_BRIDGE_DIR", "/config/.XDG/webkde-bridge"
                                    ))
                                    request_dir.mkdir(parents=True, exist_ok=True)
                                    request_id = time.monotonic_ns()
                                    positions = ";".join(
                                        f'{rect["x"]}:{rect["y"]}' for rect in layout_rects
                                    )
                                    desktop_positions = ";".join(
                                        f'{rect["x"]}:{rect["y"]}'
                                        for rect in layout_desktop_rects
                                    )
                                    request = (
                                        f"{layout_count},grid,{layout_width},{layout_height},"
                                        f"{request_id},{positions},{desktop_positions}\\n"
                                    )
                                    request_path = request_dir / "layout-request"
                                    temporary = request_dir / "layout-request.tmp"
                                    temporary.write_text(request.replace(
                                        f",{request_id},", f",{request_id}-preflight,"
                                    ))
                                    temporary.replace(request_path)
                                    await asyncio.sleep(0.35)
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

                                    reset_commands = []
                                    restore_commands = []
                                    commands = []
                                    for rect in layout_rects:
                                        index = rect["index"] - 1
                                        criteria = f'[title=".*WL-{index}.*"]'
                                        reset_commands.append(f"{criteria} move scratchpad")
                                        restore_commands.append(
                                            f"{criteria} scratchpad show, floating enable, "
                                            f'resize set width {rect["width"]} px height {rect["height"]} px, '
                                            f'move position {rect["x"]} px {rect["y"]} px'
                                        )
                                        commands.append(
                                            f"{criteria} floating enable, "
                                            f'resize set width {rect["width"]} px height {rect["height"]} px, '
                                            f'move position {rect["x"]} px {rect["y"]} px'
                                        )
                                    for index in range(layout_count, layout_max_screens):
                                        await run_sway(
                                            f'[title=".*WL-{index}.*"] move scratchpad',
                                            ignore_missing=True,
                                        )
                                    for attempt in range(40):
                                        try:
                                            for command in reset_commands:
                                                await run_sway(command)
                                            for command in restore_commands:
                                                await run_sway(command)
                                            break
                                        except OSError as error:
                                            if "No matching node." not in str(error) or attempt == 39:
                                                raise
                                            await asyncio.sleep(0.25)
                                    await asyncio.sleep(0.5)
                                    for command in commands:
                                        await run_sway(command)
                                    temporary.write_text(request)
                                    temporary.replace(request_path)
                                    await asyncio.sleep(0.35)
                                    try:
                                        await websocket.send(
                                            "WEBKDE_LAYOUT_V3_APPLIED," + json.dumps(
                                                layout_payload, separators=(",", ":")
                                            )
                                        )
                                    except websockets.exceptions.ConnectionClosed:
                                        data_logger.debug(
                                            "WebKDE mixed-layout client disconnected before acknowledgement"
                                        )
                                    while request_path.read_text() == request:
                                        await asyncio.sleep(0.5)
                                        for command in commands:
                                            await run_sway(command, ignore_missing=True)
                                except asyncio.CancelledError:
                                    data_logger.debug("Superseded WebKDE mixed-layout request")
                                except (OSError, ValueError) as error:
                                    data_logger.warning(
                                        f"Invalid WebKDE mixed-layout request: {layout_message}: {error}"
                                    )

                            self.webkde_layout_task = asyncio.create_task(
                                apply_webkde_mixed_layout()
                            )
                        except (KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as error:
                            data_logger.warning(f"Invalid WebKDE mixed-layout request: {message}: {error}")

                    elif message.startswith("WEBKDE_LAYOUT_V2,"):
                        try:
                            payload = json.loads(message.split(",", 1)[1])
                            count = int(payload["count"])
                            requested_width = int(payload["width"])
                            requested_height = int(payload["height"])
                            max_screens = int(os.environ.get("WEBKDE_MAX_SCREENS", "8"))
                            if not 1 <= count <= max_screens:
                                raise ValueError("invalid screen count")
                            if not 8 <= requested_width <= 16384 or not 2 <= requested_height <= 16384:
                                raise ValueError("invalid screen dimensions")
                            if client_display_id not in (None, "primary"):
                                raise ValueError("only the primary client may change the layout")

                            raw_positions = payload.get("positions")
                            if not isinstance(raw_positions, list) or len(raw_positions) != count:
                                raise ValueError("invalid screen arrangement")
                            position_by_index = {}
                            occupied = set()
                            for raw_position in raw_positions:
                                if not isinstance(raw_position, dict):
                                    raise ValueError("invalid screen position")
                                index = raw_position.get("index")
                                x = raw_position.get("x")
                                y = raw_position.get("y")
                                if (not isinstance(index, int) or isinstance(index, bool)
                                        or not isinstance(x, int) or isinstance(x, bool)
                                        or not isinstance(y, int) or isinstance(y, bool)
                                        or not 1 <= index <= count
                                        or abs(x) >= max_screens or abs(y) >= max_screens):
                                    raise ValueError("invalid screen position")
                                if index in position_by_index or (x, y) in occupied:
                                    raise ValueError("duplicate screen position")
                                position_by_index[index] = (x, y)
                                occupied.add((x, y))
                            if set(position_by_index) != set(range(1, count + 1)):
                                raise ValueError("missing screen position")
                            min_x = min(x for x, _ in occupied)
                            min_y = min(y for _, y in occupied)
                            position_by_index = {
                                index: (x - min_x, y - min_y)
                                for index, (x, y) in position_by_index.items()
                            }
                            occupied = set(position_by_index.values())
                            connected = {position_by_index[1]}
                            frontier = [position_by_index[1]]
                            while frontier:
                                x, y = frontier.pop()
                                for neighbor in ((x - 1, y), (x + 1, y),
                                                 (x, y - 1), (x, y + 1)):
                                    if neighbor in occupied and neighbor not in connected:
                                        connected.add(neighbor)
                                        frontier.append(neighbor)
                            if connected != occupied:
                                raise ValueError("screen arrangement must be edge-connected")

                            atlas_limit = 4080
                            best = None
                            for columns in range(1, count + 1):
                                rows = (count + columns - 1) // columns
                                scale = min(
                                    1.0,
                                    atlas_limit / (columns * requested_width),
                                    atlas_limit / (rows * requested_height),
                                )
                                empty = columns * rows - count
                                preferred = columns if requested_width >= requested_height else -columns
                                candidate = (scale, -empty, preferred, columns, rows)
                                if best is None or candidate[:3] > best[:3]:
                                    best = candidate

                            _, _, _, columns, rows = best
                            scale = best[0]
                            screen_width = max(8, int(requested_width * scale) // 8 * 8)
                            screen_height = max(2, int(requested_height * scale) // 2 * 2)
                            atlas_width = columns * screen_width
                            atlas_height = rows * screen_height
                            physical_rects = [
                                {
                                    "index": index + 1,
                                    "x": (index % columns) * screen_width,
                                    "y": (index // columns) * screen_height,
                                    "width": screen_width,
                                    "height": screen_height,
                                }
                                for index in range(count)
                            ]

                            previous_task = getattr(self, "webkde_layout_task", None)
                            if previous_task and not previous_task.done():
                                previous_task.cancel()

                            client_info = self.display_clients.get("primary", {})
                            current_resolution = (
                                int(client_info.get("width") or 0),
                                int(client_info.get("height") or 0),
                            )
                            if current_resolution != (atlas_width, atlas_height):
                                await on_resize_handler(
                                    f"{atlas_width}x{atlas_height}", self.app, self, "primary"
                                )

                            desktop_scale = float(getattr(self, "webkde_scale", 1.0))
                            logical_screen_width = max(1, round(screen_width / desktop_scale))
                            logical_screen_height = max(1, round(screen_height / desktop_scale))
                            logical_width = columns * logical_screen_width
                            logical_height = rows * logical_screen_height
                            logical_rects = [
                                {
                                    "index": rect["index"],
                                    "x": (rect["index"] - 1) % columns * logical_screen_width,
                                    "y": (rect["index"] - 1) // columns * logical_screen_height,
                                    "width": logical_screen_width,
                                    "height": logical_screen_height,
                                }
                                for rect in physical_rects
                            ]
                            desktop_rects = [
                                {
                                    "index": index,
                                    "x": position_by_index[index][0] * logical_screen_width,
                                    "y": position_by_index[index][1] * logical_screen_height,
                                    "width": logical_screen_width,
                                    "height": logical_screen_height,
                                }
                                for index in range(1, count + 1)
                            ]
                            applied_payload = {
                                "mode": "per-tab",
                                "count": count,
                                "columns": columns,
                                "rows": rows,
                                "requestedWidth": requested_width,
                                "requestedHeight": requested_height,
                                "screenWidth": screen_width,
                                "screenHeight": screen_height,
                                "logicalScreenWidth": logical_screen_width,
                                "logicalScreenHeight": logical_screen_height,
                                "desktopScale": desktop_scale,
                                "atlasWidth": atlas_width,
                                "atlasHeight": atlas_height,
                                "screens": physical_rects,
                                "desktopScreens": desktop_rects,
                            }

                            async def apply_webkde_grid(
                                layout_count=count,
                                layout_max_screens=max_screens,
                                layout_width=logical_width,
                                layout_height=logical_height,
                                layout_rects=logical_rects,
                                layout_desktop_rects=desktop_rects,
                                layout_payload=applied_payload,
                                layout_message=message,
                            ):
                                try:
                                    await asyncio.sleep(0.3)
                                    request_dir = pathlib.Path(os.environ.get(
                                        "WEBKDE_BRIDGE_DIR", "/config/.XDG/webkde-bridge"
                                    ))
                                    request_dir.mkdir(parents=True, exist_ok=True)
                                    request_id = time.monotonic_ns()
                                    positions = ";".join(
                                        f'{rect["x"]}:{rect["y"]}' for rect in layout_rects
                                    )
                                    desktop_positions = ";".join(
                                        f'{rect["x"]}:{rect["y"]}'
                                        for rect in layout_desktop_rects
                                    )
                                    request = (
                                        f"{layout_count},grid,{layout_width},{layout_height},"
                                        f"{request_id},{positions},{desktop_positions}\\n"
                                    )
                                    request_path = request_dir / "layout-request"
                                    temporary = request_dir / "layout-request.tmp"

                                    # A clean nested KWin session initially creates only
                                    # WL-0's host window. Ask KScreen to enable all requested
                                    # outputs first; their Sway nodes must exist before they
                                    # can be resized into the capture atlas.
                                    preflight_request = (
                                        f"{layout_count},grid,{layout_width},{layout_height},"
                                        f"{request_id}-preflight,{positions},{desktop_positions}\\n"
                                    )
                                    temporary.write_text(preflight_request)
                                    temporary.replace(request_path)
                                    await asyncio.sleep(0.35)

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

                                    reset_commands = []
                                    restore_commands = []
                                    commands = []
                                    for rect in layout_rects:
                                        index = rect["index"] - 1
                                        criteria = f'[title=".*WL-{index}.*"]'
                                        reset_commands.append(f"{criteria} move scratchpad")
                                        restore_commands.append(
                                            f"{criteria} scratchpad show, floating enable, "
                                            f'resize set width {rect["width"]} px height {rect["height"]} px, '
                                            f'move position {rect["x"]} px {rect["y"]} px'
                                        )
                                        commands.append(
                                            f"{criteria} floating enable, "
                                            f'resize set width {rect["width"]} px height {rect["height"]} px, '
                                            f'move position {rect["x"]} px {rect["y"]} px'
                                        )
                                    for index in range(layout_count, layout_max_screens):
                                        await run_sway(
                                            f'[title=".*WL-{index}.*"] move scratchpad',
                                            ignore_missing=True,
                                        )
                                    for attempt in range(40):
                                        try:
                                            for command in reset_commands:
                                                await run_sway(command)
                                            for command in restore_commands:
                                                await run_sway(command)
                                            break
                                        except OSError as error:
                                            if "No matching node." not in str(error) or attempt == 39:
                                                raise
                                            await asyncio.sleep(0.25)
                                    await asyncio.sleep(0.5)
                                    for command in commands:
                                        await run_sway(command)

                                    # KWin derives nested output modes from its host-window
                                    # configure size. Publish the KScreen request only after
                                    # every host window has reached its final geometry.
                                    temporary.write_text(request)
                                    temporary.replace(request_path)
                                    await asyncio.sleep(0.35)

                                    try:
                                        await websocket.send(
                                            "WEBKDE_LAYOUT_V2_APPLIED," + json.dumps(
                                                layout_payload, separators=(",", ":")
                                            )
                                        )
                                    except websockets.exceptions.ConnectionClosed:
                                        data_logger.debug(
                                            "WebKDE grid client disconnected before acknowledgement"
                                        )

                                    # KScreen can change a nested KWin window's minimum size
                                    # while Display Settings is open. Keep the Sway-side
                                    # geometry authoritative; after the host bridge restores
                                    # scale 1 this also shrinks any transient enlargement.
                                    while request_path.read_text() == request:
                                        await asyncio.sleep(0.5)
                                        for command in commands:
                                            await run_sway(command, ignore_missing=True)
                                except asyncio.CancelledError:
                                    data_logger.debug("Superseded WebKDE grid request")
                                except (OSError, ValueError) as error:
                                    data_logger.warning(
                                        f"Invalid WebKDE grid request: {layout_message}: {error}"
                                    )

                            self.webkde_layout_task = asyncio.create_task(apply_webkde_grid())
                        except (KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as error:
                            data_logger.warning(f"Invalid WebKDE grid request: {message}: {error}")

                    elif message.startswith("WEBKDE_LAYOUT,"):
                        try:
                            parts = message.split(",")
                            count = int(parts[1])
                            max_screens = int(os.environ.get("WEBKDE_MAX_SCREENS", "8"))
                            if not 1 <= count <= max_screens:
                                raise ValueError("invalid layout")

                            client_info = self.display_clients.get(client_display_id or "primary", {})
                            physical_canvas_width = int(client_info.get("width") or parts[3])
                            physical_canvas_height = int(client_info.get("height") or parts[4])
                            desktop_scale = float(getattr(self, "webkde_scale", 1.0))
                            canvas_width = max(count, round(physical_canvas_width / desktop_scale))
                            canvas_height = max(1, round(physical_canvas_height / desktop_scale))
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

                                    reset_commands = []
                                    restore_commands = []
                                    active_commands = []
                                    offset = 0
                                    for index in range(layout_count):
                                        criteria = f'[title=".*WL-{index}.*"]'
                                        reset_commands.append(f"{criteria} move scratchpad")
                                        if layout_orientation == "horizontal":
                                            size = layout_width // layout_count + (
                                                1 if index < layout_width % layout_count else 0
                                            )
                                            geometry = (
                                                f"resize set width {size} px height {layout_height} px, "
                                                f"move position {offset} px 0 px"
                                            )
                                        else:
                                            size = layout_height // layout_count + (
                                                1 if index < layout_height % layout_count else 0
                                            )
                                            geometry = (
                                                f"resize set width {layout_width} px height {size} px, "
                                                f"move position 0 px {offset} px"
                                            )
                                        restore_commands.append(
                                            f"{criteria} scratchpad show, floating enable, {geometry}"
                                        )
                                        active_commands.append(
                                            f"{criteria} floating enable, {geometry}"
                                        )
                                        offset += size

                                    for index in range(layout_count, layout_max_screens):
                                        await run_sway(
                                            f'[title=".*WL-{index}.*"] move scratchpad',
                                            ignore_missing=True,
                                        )

                                    # Remapping forces KWin to consume a new host-window
                                    # configure even when Sway's outer rectangle already has
                                    # the requested size. A resize alone can otherwise leave
                                    # the client surface at the previous capture-atlas width.
                                    for command in reset_commands:
                                        await run_sway(command)
                                    for command in restore_commands:
                                        await run_sway(command)
                                    await asyncio.sleep(0.5)
                                    if request_path.read_text() != request:
                                        return
                                    for command in active_commands:
                                        await run_sway(command)

                                    try:
                                        await websocket.send(
                                            f"WEBKDE_LAYOUT_APPLIED,{layout_count},{layout_orientation}"
                                        )
                                    except websockets.exceptions.ConnectionClosed:
                                        data_logger.debug(
                                            "WebKDE layout client disconnected before acknowledgement"
                                        )

                                    # Do not allow KScreen's live preview to resize these
                                    # nested output windows behind the stream layout.
                                    while request_path.read_text() == request:
                                        await asyncio.sleep(0.5)
                                        for command in active_commands:
                                            await run_sway(command, ignore_missing=True)
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

                    elif message.startswith("WEBKDE_SCROLL_SCALE,"):
                        try:
                            if client_display_id not in (None, "primary"):
                                raise ValueError("only the primary client may change scroll speed")
                            scroll_scale = float(message.split(",", 1)[1])
                            if scroll_scale != scroll_scale or abs(scroll_scale) == float("inf"):
                                raise ValueError("invalid scroll multiplier")
                            scroll_scale = max(0.05, min(scroll_scale, 4.0))
                            os.environ["WEBKDE_SCROLL_SCALE"] = str(scroll_scale)
                            await websocket.send(f"WEBKDE_SCROLL_SCALE_APPLIED,{scroll_scale:g}")
                        except (TypeError, ValueError) as error:
                            data_logger.warning(
                                f"Invalid WebKDE scroll multiplier request: {message}: {error}"
                            )

                    elif message.startswith("WEBKDE_SCALE,"):
                        try:
                            dpi = int(message.split(",", 1)[1])
                            if dpi < 96 or dpi > 288 or dpi % 24:
                                raise ValueError("scale DPI must be from 96 through 288 in steps of 24")
                            scale = dpi / 96.0
                            sockets = []
                            for attempt in range(20):
                                sockets = list(pathlib.Path("/config/.XDG").glob(
                                    "sway-ipc.*.sock"
                                ))
                                if sockets:
                                    break
                                await asyncio.sleep(0.25)
                            if not sockets:
                                raise OSError("Sway IPC socket is unavailable")
                            sway_socket = max(sockets, key=lambda path: path.stat().st_mtime)
                            process = await asyncio.create_subprocess_exec(
                                "swaymsg", "--socket", str(sway_socket),
                                f"output * scale {scale:g}",
                                stdout=asyncio.subprocess.PIPE,
                                stderr=asyncio.subprocess.PIPE,
                            )
                            stdout, stderr = await process.communicate()
                            replies = json.loads(stdout.decode())
                            failures = [
                                reply.get("error", "unknown Sway error")
                                for reply in replies if not reply.get("success")
                            ]
                            if process.returncode or failures:
                                detail = "; ".join(failures) or stderr.decode(
                                    errors="replace"
                                ).strip()
                                raise OSError(detail or "swaymsg failed")
                            self.webkde_scale = scale
                            await websocket.send(f"WEBKDE_SCALE_APPLIED,{dpi}")
                        except (IndexError, ValueError, OSError, json.JSONDecodeError) as error:
                            data_logger.warning(f"Invalid WebKDE scale request: {message}: {error}")

                    elif message == "WEBKDE_RESET_DISPLAYS":
                        try:
                            request_dir = pathlib.Path(os.environ.get(
                                "WEBKDE_BRIDGE_DIR", "/config/.XDG/webkde-bridge"
                            ))
                            request_dir.mkdir(parents=True, exist_ok=True)
                            request = f"{time.monotonic_ns()}\\n"
                            temporary = request_dir / "reset-displays.tmp"
                            temporary.write_text(request)
                            temporary.replace(request_dir / "reset-displays")
                            await websocket.send("WEBKDE_RESET_DISPLAYS_ACCEPTED")
                        except OSError as error:
                            data_logger.warning(f"Could not request a display reset: {error}")

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
source = source.replace(needle, handler + needle)

# WebKDE applies Selkies' DPI setting to the Sway output that contains the
# nested KWin windows. The upstream wlr-randr fallback targets a different
# Wayland layer and otherwise appears to succeed without changing the desktop.
wlr_needle = '''            elif which("wlr-randr") and display_id == 'primary':
'''
wlr_replacement = '''            elif (which("wlr-randr") and display_id == 'primary'
                  and not os.environ.get("WEBKDE_BRIDGE_DIR")):
'''
if source.count(wlr_needle) != 1:
    raise SystemExit("Pinned Selkies source no longer matches DPI fallback")
selkies.write_text(source.replace(wlr_needle, wlr_replacement))

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

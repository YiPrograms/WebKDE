#!/usr/bin/env bash
set -euo pipefail

resolution="${1:?usage: selkies-resize.sh WIDTHxHEIGHT}"
[[ "${resolution}" =~ ^[0-9]+x[0-9]+$ ]] || { echo "Invalid resolution: ${resolution}" >&2; exit 2; }

# Use a short-lived control connection without sending SETTINGS. This avoids
# taking ownership of (and disconnecting) the active browser display client.
docker exec webkde-selkies /lsiopy/bin/python -c '
import asyncio, sys, websockets
async def resize():
    async with websockets.connect("ws://127.0.0.1:8082") as ws:
        resolution = sys.argv[1]
        expected = f"WEBKDE_RESIZED,primary,{resolution}"
        await ws.send(f"r,{resolution},primary")
        while True:
            message = await asyncio.wait_for(ws.recv(), timeout=30)
            if message == expected:
                return
asyncio.run(resize())
' "${resolution}"

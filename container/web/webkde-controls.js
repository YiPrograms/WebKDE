(() => {
  const screenStorageKey = "webkde.virtualScreens";
  const arrangementStorageKey = "webkde.screenArrangement";
  const maxScreens = Number(document.currentScript?.dataset.maxScreens || 8);
  const atlasLimit = 4080;
  const nativeSend = WebSocket.prototype.send;
  const nativeDocumentAddEventListener = Document.prototype.addEventListener;
  const observedSockets = new WeakSet();
  const satellites = new Map();
  let dataSocket;
  let timer;
  let satelliteButtonMask = 0;
  let requestedWidth = Math.max(2, Math.round(innerWidth * (devicePixelRatio || 1)));
  let requestedHeight = Math.max(2, Math.round(innerHeight * (devicePixelRatio || 1)));
  let manualResolution = false;
  let manualWidth = 0;
  let manualHeight = 0;
  let appliedLayout = null;
  let controlView = null;
  let cursorSignature = "";
  let selectedArrangementScreen = null;
  let draftArrangement = null;

  // Selkies normally stops and clears the stream whenever its page is hidden.
  // Per-tab satellites depend on the control decoder, so keep it alive there.
  Document.prototype.addEventListener = function(type, listener, options) {
    if (this === document && type === "visibilitychange") {
      const wrapped = function() {};
      return nativeDocumentAddEventListener.call(this, type, wrapped, options);
    }
    return nativeDocumentAddEventListener.call(this, type, listener, options);
  };

  function screenCount() {
    const value = Number(localStorage.getItem(screenStorageKey) || 1);
    return Math.max(1, Math.min(maxScreens, Number.isFinite(value) ? value : 1));
  }

  function normalizeArrangement(positions) {
    const minX = Math.min(...positions.map(position => position.x));
    const minY = Math.min(...positions.map(position => position.y));
    return positions.map(position => ({
      index: position.index,
      x: position.x - minX,
      y: position.y - minY,
    })).sort((left, right) => left.index - right.index);
  }

  function presetArrangement(count, preset = "row") {
    const columns = preset === "column" ? 1 :
      (preset === "compact" ? Math.ceil(Math.sqrt(count)) : count);
    return Array.from({length: count}, (_, offset) => ({
      index: offset + 1,
      x: offset % columns,
      y: Math.floor(offset / columns),
    }));
  }

  function arrangementConnected(positions) {
    if (!positions.length) return false;
    const occupied = new Map(positions.map(position => [`${position.x}:${position.y}`, position]));
    const visited = new Set([positions[0].index]);
    const queue = [positions[0]];
    while (queue.length) {
      const position = queue.shift();
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const neighbor = occupied.get(`${position.x + dx}:${position.y + dy}`);
        if (neighbor && !visited.has(neighbor.index)) {
          visited.add(neighbor.index);
          queue.push(neighbor);
        }
      }
    }
    return visited.size === positions.length;
  }

  function screenArrangement(count = screenCount()) {
    try {
      const parsed = JSON.parse(localStorage.getItem(arrangementStorageKey) || "null");
      if (!Array.isArray(parsed) || parsed.length !== count) throw new Error("wrong count");
      const positions = parsed.map(position => ({
        index: Number(position.index),
        x: Number(position.x),
        y: Number(position.y),
      }));
      const indices = new Set(positions.map(position => position.index));
      const cells = new Set(positions.map(position => `${position.x}:${position.y}`));
      if (indices.size !== count || cells.size !== count ||
          positions.some(position => !Number.isInteger(position.index) ||
            position.index < 1 || position.index > count ||
            !Number.isInteger(position.x) || !Number.isInteger(position.y)) ||
          !arrangementConnected(positions)) throw new Error("invalid arrangement");
      return normalizeArrangement(positions);
    } catch (_) {
      return presetArrangement(count, "row");
    }
  }

  function saveArrangement(positions) {
    const normalized = normalizeArrangement(positions);
    localStorage.setItem(arrangementStorageKey, JSON.stringify(normalized));
    return normalized;
  }

  function editableArrangement() {
    if (Array.isArray(draftArrangement) && draftArrangement.length === screenCount())
      return normalizeArrangement(draftArrangement);
    return screenArrangement();
  }

  function arrangementsEqual(left, right) {
    return JSON.stringify(normalizeArrangement(left)) === JSON.stringify(normalizeArrangement(right));
  }

  function even(value) {
    return Math.max(2, Math.floor(value / 2) * 2);
  }

  function calculateAtlas(count, width, height) {
    width = Math.max(8, Math.round(width));
    height = Math.max(2, Math.round(height));
    let best = null;
    for (let columns = 1; columns <= count; columns++) {
      const rows = Math.ceil(count / columns);
      const scale = Math.min(1, atlasLimit / (columns * width), atlasLimit / (rows * height));
      const empty = columns * rows - count;
      const preferred = width >= height ? columns : -columns;
      const candidate = {columns, rows, scale, empty, preferred};
      if (!best || scale > best.scale + 1e-9 ||
          (Math.abs(scale - best.scale) < 1e-9 && empty < best.empty) ||
          (Math.abs(scale - best.scale) < 1e-9 && empty === best.empty && preferred > best.preferred)) {
        best = candidate;
      }
    }
    const screenWidth = Math.max(8, Math.floor(width * best.scale / 8) * 8);
    const screenHeight = even(height * best.scale);
    const screens = [];
    for (let index = 0; index < count; index++) {
      screens.push({
        index: index + 1,
        x: (index % best.columns) * screenWidth,
        y: Math.floor(index / best.columns) * screenHeight,
        width: screenWidth,
        height: screenHeight,
      });
    }
    return {
      mode: "per-tab",
      count,
      columns: best.columns,
      rows: best.rows,
      requestedWidth: width,
      requestedHeight: height,
      screenWidth,
      screenHeight,
      atlasWidth: best.columns * screenWidth,
      atlasHeight: best.rows * screenHeight,
      screens,
    };
  }

  function updateRequestedResolution(width, height) {
    if (Number.isFinite(width) && width > 0) requestedWidth = Math.round(width);
    if (Number.isFinite(height) && height > 0) requestedHeight = Math.round(height);
  }

  function updateRequestedFromViewport() {
    const viewport = window.visualViewport;
    const ratio = devicePixelRatio || 1;
    updateRequestedResolution(
      (viewport?.width || innerWidth) * ratio,
      (viewport?.height || innerHeight) * ratio,
    );
  }

  function updateRequestedFromSettings(settings) {
    manualWidth = Number(settings.manual_width) || 0;
    manualHeight = Number(settings.manual_height) || 0;
    const manualSetting = settings.is_manual_resolution_mode;
    manualResolution = (manualSetting === true || manualSetting === 1 ||
      String(manualSetting).toLowerCase() === "true") &&
      manualWidth >= 8 && manualHeight >= 2;
    if (manualResolution) updateRequestedResolution(manualWidth, manualHeight);
    else updateRequestedFromViewport();
  }

  function updateManualModeFromSelkies() {
    // This value changes immediately when the screen settings UI is used,
    // while SETTINGS is normally sent only when a connection is established.
    if (typeof window.isManualResolutionMode === "boolean")
      manualResolution = window.isManualResolutionMode;
  }

  function observeDataSocket(socket) {
    dataSocket = socket;
    if (observedSockets.has(socket)) return;
    observedSockets.add(socket);
    socket.addEventListener("message", event => {
      if (typeof event.data !== "string" || !event.data.startsWith("WEBKDE_LAYOUT_V2_APPLIED,")) return;
      try {
        appliedLayout = JSON.parse(event.data.slice("WEBKDE_LAYOUT_V2_APPLIED,".length));
        updateControlCrop();
        updateEffectiveResolution();
        notifySatellites("webkde:layout");
      } catch (error) {
        console.warn("Could not read the applied WebKDE layout", error);
      }
    });
  }

  function transformAbsoluteMouse(message) {
    if (!appliedLayout || !message.startsWith("m,")) return message;
    const parts = message.split(",");
    if (parts.length < 5) return message;
    const reportedMask = Number(parts[3]);
    if (Number.isInteger(reportedMask)) satelliteButtonMask = reportedMask;
    const rect = appliedLayout.screens?.[0];
    if (!rect) return message;
    const viewport = window.visualViewport;
    const ratio = devicePixelRatio || 1;
    const inputWidth = Math.max(1, (viewport?.width || innerWidth) * ratio);
    const inputHeight = Math.max(1, (viewport?.height || innerHeight) * ratio);
    const localX = Math.max(0, Math.min(inputWidth, Number(parts[1]) || 0));
    const localY = Math.max(0, Math.min(inputHeight, Number(parts[2]) || 0));
    let normalizedX = localX / inputWidth;
    let normalizedY = localY / inputHeight;
    if (controlView) {
      const cssX = normalizedX * controlView.containerWidth;
      const cssY = normalizedY * controlView.containerHeight;
      normalizedX = (cssX - controlView.x) / controlView.width;
      normalizedY = (cssY - controlView.y) / controlView.height;
    }
    normalizedX = Math.max(0, Math.min(1, normalizedX));
    normalizedY = Math.max(0, Math.min(1, normalizedY));
    parts[1] = String(Math.round(rect.x + normalizedX * rect.width));
    parts[2] = String(Math.round(rect.y + normalizedY * rect.height));
    return parts.join(",");
  }

  WebSocket.prototype.send = function(data) {
    let scalingDpi;
    let scheduleLayout = false;
    if (typeof data === "string" && data.startsWith("SETTINGS,")) {
      observeDataSocket(this);
      try {
        const settings = JSON.parse(data.slice("SETTINGS,".length));
        scalingDpi = Number(settings.scaling_dpi);
        // Selkies measures its video container, whose width changes when the
        // settings sidebar opens. Monitors should follow the browser viewport,
        // not transient dashboard chrome.
        updateRequestedFromSettings(settings);
        const atlas = calculateAtlas(screenCount(), requestedWidth, requestedHeight);
        settings.initialClientWidth = atlas.atlasWidth;
        settings.initialClientHeight = atlas.atlasHeight;
        data = `SETTINGS,${JSON.stringify(settings)}`;
        scheduleLayout = true;
      } catch (error) {
        console.warn("Could not read Selkies settings", error);
      }
    } else if (typeof data === "string" && data.startsWith("r,")) {
      const parts = data.split(",");
      const dimensions = parts[1]?.split("x").map(Number);
      updateManualModeFromSelkies();
      if (dimensions?.length === 2 &&
          dimensions.every(value => Number.isFinite(value) && value > 0)) {
        // Selkies has already accounted for manual/responsive mode, local CSS
        // scaling, and browser DPR when it builds this message. Its dimensions
        // are authoritative in both modes.
        updateRequestedResolution(dimensions[0], dimensions[1]);
        if (manualResolution) {
          manualWidth = dimensions[0];
          manualHeight = dimensions[1];
        }
      }
      const atlas = calculateAtlas(screenCount(), requestedWidth, requestedHeight);
      data = `r,${atlas.atlasWidth}x${atlas.atlasHeight},primary`;
      scheduleLayout = true;
    } else if (typeof data === "string") {
      data = transformAbsoluteMouse(data);
    }

    const result = nativeSend.call(this, data);
    if (scheduleLayout) setTimeout(() => apply(true, false), 0);
    if (scalingDpi >= 96 && scalingDpi <= 288 && scalingDpi % 24 === 0) {
      setTimeout(() => {
        if (this.readyState !== WebSocket.OPEN) return;
        nativeSend.call(this, `WEBKDE_SCALE,${scalingDpi}`);
        setTimeout(() => apply(true), 250);
      }, 0);
    }
    return result;
  };

  function apply(force = false, resizeStream = true) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (dataSocket?.readyState !== WebSocket.OPEN) {
        setTimeout(() => apply(true), 500);
        return;
      }
      const count = screenCount();
      const atlas = calculateAtlas(count, requestedWidth, requestedHeight);
      appliedLayout = atlas;
      if (resizeStream) nativeSend.call(dataSocket, `r,${atlas.atlasWidth}x${atlas.atlasHeight},primary`);
      nativeSend.call(dataSocket, `WEBKDE_LAYOUT_V2,${JSON.stringify({
        count,
        width: requestedWidth,
        height: requestedHeight,
        positions: screenArrangement(count),
      })}`);
      updateControlCrop();
      notifySatellites("webkde:layout");
      updateEffectiveResolution();
    }, force ? 0 : 350);
  }

  function controlCanvas() {
    return document.getElementById("videoCanvas");
  }

  function updateControlCrop() {
    if (!appliedLayout) return clearControlCrop();
    const canvas = controlCanvas();
    const container = document.querySelector(".video-container");
    const overlay = document.getElementById("overlayInput");
    const rect = appliedLayout.screens?.[0];
    if (!canvas || !container || !rect) return;
    const bounds = container.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const scale = Math.min(bounds.width / rect.width, bounds.height / rect.height);
    const visibleWidth = rect.width * scale;
    const visibleHeight = rect.height * scale;
    controlView = {
      x: (bounds.width - visibleWidth) / 2,
      y: (bounds.height - visibleHeight) / 2,
      width: visibleWidth,
      height: visibleHeight,
      containerWidth: bounds.width,
      containerHeight: bounds.height,
    };
    canvas.style.setProperty("max-width", "none", "important");
    canvas.style.setProperty("max-height", "none", "important");
    canvas.style.setProperty("width", `${appliedLayout.atlasWidth * scale}px`, "important");
    canvas.style.setProperty("height", `${appliedLayout.atlasHeight * scale}px`, "important");
    canvas.style.setProperty("left", `${(bounds.width - visibleWidth) / 2 - rect.x * scale}px`, "important");
    canvas.style.setProperty("top", `${(bounds.height - visibleHeight) / 2 - rect.y * scale}px`, "important");
    if (overlay) {
      overlay.style.setProperty("width", "100%", "important");
      overlay.style.setProperty("height", "100%", "important");
      overlay.style.setProperty("left", "0", "important");
      overlay.style.setProperty("top", "0", "important");
    }
  }

  function clearControlCrop() {
    controlView = null;
    const canvas = controlCanvas();
    if (canvas) {
      for (const property of ["max-width", "max-height", "width", "height", "left", "top"])
        canvas.style.removeProperty(property);
    }
    const overlay = document.getElementById("overlayInput");
    if (overlay) {
      for (const property of ["width", "height", "left", "top"])
        overlay.style.removeProperty(property);
    }
  }

  function notifySatellites(type, extra = {}) {
    for (const [index, entry] of satellites) {
      if (entry.window.closed) {
        satellites.delete(index);
        continue;
      }
      entry.window.postMessage({type, screen: index, ...extra}, location.origin);
    }
  }


  function domButtonsToMask(buttons) {
    return ((buttons & 1) ? 1 : 0) | ((buttons & 4) ? 2 : 0) | ((buttons & 2) ? 4 : 0);
  }

  addEventListener("mousedown", event => {
    satelliteButtonMask = domButtonsToMask(event.buttons);
  }, true);
  addEventListener("mouseup", event => {
    satelliteButtonMask = domButtonsToMask(event.buttons);
  }, true);

  function currentCursor() {
    const input = window.webrtcInput;
    const data = input?._cursorBase64Data;
    if (typeof data !== "string" || !data) return null;
    return {
      data,
      hotspotX: Math.max(0, Math.round(Number(input._rawHotspotX) || 0)),
      hotspotY: Math.max(0, Math.round(Number(input._rawHotspotY) || 0)),
      desktopScale: Math.max(1, Number(appliedLayout?.desktopScale) || 1),
    };
  }

  function restoreControlCursorSize() {
    const input = window.webrtcInput;
    const bitmap = input?._cursorImageBitmap;
    const pointer = input?.cursorDiv;
    if (!bitmap || !pointer || input.use_browser_cursors) return;

    // The cursor bitmap follows the remote desktop scale. Browser DPR is
    const scale = Math.max(1, Number(appliedLayout?.desktopScale) || 1);
    pointer.style.width = `${bitmap.width / scale}px`;
    pointer.style.height = `${bitmap.height / scale}px`;
    if (input.cursorHotspot) {
      input.cursorHotspot.x = Math.max(0, Number(input._rawHotspotX) || 0) / scale;
      input.cursorHotspot.y = Math.max(0, Number(input._rawHotspotY) || 0) / scale;
    }
    if (typeof input._updateCursorPosition === "function") {
      input._updateCursorPosition(input._latestMouseX, input._latestMouseY);
    }
  }

  function publishCursor(force = false) {
    const cursor = currentCursor();
    const signature = cursor ?
      `${cursor.hotspotX},${cursor.hotspotY},${cursor.desktopScale},${cursor.data}` : "";
    if (!force && signature === cursorSignature) return;
    cursorSignature = signature;
    notifySatellites("webkde:cursor", {cursor});
  }

  async function publishSatelliteFrames() {
    if (!appliedLayout) return;
    const canvas = controlCanvas();
    if (!canvas || !canvas.width || !canvas.height) return;
    for (const [screen, entry] of satellites) {
      const rect = appliedLayout.screens?.[screen - 1];
      if (!rect || entry.framePending || entry.window.closed) continue;
      entry.framePending = true;
      createImageBitmap(canvas, rect.x, rect.y, rect.width, rect.height).then(bitmap => {
        if (!entry.window.closed)
          entry.window.postMessage({type: "webkde:frame", screen, bitmap}, location.origin, [bitmap]);
        else bitmap.close();
      }).catch(error => {
        console.warn(`Could not publish WebKDE Screen ${screen}`, error);
      }).finally(() => { entry.framePending = false; });
    }
  }

  function maintainPerTabSurface() {
    if (appliedLayout) {
      const canvas = controlCanvas();
      if (canvas && (canvas.width !== appliedLayout.atlasWidth || canvas.height !== appliedLayout.atlasHeight)) {
        canvas.width = appliedLayout.atlasWidth;
        canvas.height = appliedLayout.atlasHeight;
      }
      updateControlCrop();
      publishSatelliteFrames();
      publishCursor();
      restoreControlCursorSize();
    }
    requestAnimationFrame(maintainPerTabSurface);
  }

  function forwardInput(screen, input) {
    const overlay = document.getElementById("overlayInput");
    if (!overlay || !input) return;
    const rect = appliedLayout?.screens?.[screen - 1];
    if (input.kind === "mouse" && rect && dataSocket?.readyState === WebSocket.OPEN) {
      const x = Math.round(rect.x + Math.max(0, Math.min(1, input.x)) * Math.max(0, rect.width - 1));
      const y = Math.round(rect.y + Math.max(0, Math.min(1, input.y)) * Math.max(0, rect.height - 1));
      if ((input.type === "mousedown" || input.type === "mouseup") &&
          Number.isInteger(input.button) && input.button >= 0 && input.button <= 4) {
        const bit = 1 << input.button;
        if (input.type === "mousedown") satelliteButtonMask |= bit;
        else satelliteButtonMask &= ~bit;
      }
      nativeSend.call(dataSocket, `m,${x},${y},${satelliteButtonMask},0`);
    } else if (input.kind === "wheel" && rect && dataSocket?.readyState === WebSocket.OPEN) {
      const x = Math.round(rect.x + Math.max(0, Math.min(1, input.x)) * Math.max(0, rect.width - 1));
      const y = Math.round(rect.y + Math.max(0, Math.min(1, input.y)) * Math.max(0, rect.height - 1));
      nativeSend.call(dataSocket, `m,${x},${y},${satelliteButtonMask},0`);
      const pulse = (bit, magnitude) => {
        satelliteButtonMask |= bit;
        nativeSend.call(dataSocket, `m2,0,0,${satelliteButtonMask},${magnitude}`);
        setTimeout(() => {
          satelliteButtonMask &= ~bit;
          if (dataSocket?.readyState === WebSocket.OPEN)
            nativeSend.call(dataSocket, `m2,0,0,${satelliteButtonMask},${magnitude}`);
        }, 10);
      };
      if (input.deltaY) pulse(1 << (input.deltaY < 0 ? 4 : 3), Math.max(1, Math.round(Math.abs(input.deltaY) / 100)));
      if (input.deltaX) pulse(1 << (input.deltaX < 0 ? 6 : 7), Math.max(1, Math.round(Math.abs(input.deltaX) / 100)));
    } else if (input.kind === "key") {
      window.dispatchEvent(new KeyboardEvent(input.type, {
        bubbles: true,
        cancelable: true,
        key: input.key,
        code: input.code,
        location: input.location,
        repeat: input.repeat,
        ctrlKey: input.ctrlKey,
        shiftKey: input.shiftKey,
        altKey: input.altKey,
        metaKey: input.metaKey,
      }));
    } else if (input.kind === "blur") {
      if (!input.preserveButtons) {
        satelliteButtonMask = 0;
        if (dataSocket?.readyState === WebSocket.OPEN)
          nativeSend.call(dataSocket, "m2,0,0,0,0");
      }
      window.webrtcInput?.resetKeyboard?.();
    }
  }

  function sendClipboardText(text) {
    if (typeof text !== "string" || dataSocket?.readyState !== WebSocket.OPEN) return;
    const bytes = new TextEncoder().encode(text);
    const encode = chunk => {
      let binary = "";
      for (const byte of chunk) binary += String.fromCharCode(byte);
      return btoa(binary);
    };
    if (bytes.length < 65536) {
      nativeSend.call(dataSocket, `cw,${encode(bytes)}`);
      return;
    }
    nativeSend.call(dataSocket, `cws,${bytes.length}`);
    for (let offset = 0; offset < bytes.length; offset += 49152)
      nativeSend.call(dataSocket, `cwd,${encode(bytes.subarray(offset, offset + 49152))}`);
    nativeSend.call(dataSocket, "cwe");
  }

  addEventListener("message", event => {
    if (event.origin !== location.origin || !event.data?.type) return;
    const screen = Number(event.data.screen);
    if (event.data.type === "webkde:satellite-ready") {
      if (!Number.isInteger(screen) || screen < 2 || screen > maxScreens) return;
      satellites.set(screen, {window: event.source, framePending: false});
      event.source.postMessage({
        type: screen <= screenCount() ? "webkde:layout" : "webkde:inactive",
        screen,
      }, location.origin);
      const cursor = currentCursor();
      if (cursor) event.source.postMessage({type: "webkde:cursor", screen, cursor}, location.origin);
      return;
    }
    const registered = satellites.get(screen);
    if (!registered || registered.window !== event.source) return;
    if (event.data.type === "webkde:satellite-input") forwardInput(screen, event.data.input);
    else if (event.data.type === "webkde:clipboard-paste") sendClipboardText(event.data.text);
    else if (event.data.type === "webkde:satellite-closed") satellites.delete(screen);
  });

  addEventListener("message", event => {
    if (event.source === window && event.origin === location.origin &&
        event.data?.type === "clipboardContentUpdate" && typeof event.data.text === "string")
      notifySatellites("webkde:clipboard", {text: event.data.text});
  });

  function updateEffectiveResolution() {
    const output = document.getElementById("webkdeEffectiveResolution");
    if (!output) return;
    if (!appliedLayout) return;
    const physicalWidth = appliedLayout.screenWidth;
    const physicalHeight = appliedLayout.screenHeight;
    const width = appliedLayout.logicalScreenWidth || physicalWidth;
    const height = appliedLayout.logicalScreenHeight || physicalHeight;
    const reduced = appliedLayout.screenWidth < requestedWidth || appliedLayout.screenHeight < requestedHeight;
    output.textContent = `KDE mode ${physicalWidth}×${physicalHeight} at managed 100%` +
      (physicalWidth !== width || physicalHeight !== height
        ? `; effective UI ${width}×${height} at the Selkies scale` : "") +
      (reduced ? ", reduced to fit the shared stream." : ".");
  }

  function rebuildOpenButtons() {
    const host = document.getElementById("webkdeScreenButtons");
    if (!host) return;
    host.replaceChildren();
    host.hidden = false;
    for (let screen = 2; screen <= screenCount(); screen++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "resolution-button";
      button.textContent = `Open Screen ${screen}`;
      button.addEventListener("click", () => {
        const width = Math.max(640, Math.round(innerWidth * .8));
        const height = Math.max(480, Math.round(innerHeight * .8));
        const satellite = window.open(
          `./webkde-screen.html?screen=${screen}`,
          `webkde-screen-${screen}`,
          `popup=yes,width=${width},height=${height},resizable=yes`
        );
        if (!satellite) alert("The browser blocked the screen tab. Allow pop-ups for this WebKDE site.");
      });
      host.appendChild(button);
    }
  }

  function stageArrangement(positions, keepSelection = false) {
    draftArrangement = normalizeArrangement(positions);
    if (!keepSelection) selectedArrangementScreen = null;
    renderArrangementEditor();
  }

  function applyArrangement() {
    if (!draftArrangement || !arrangementConnected(draftArrangement)) return;
    saveArrangement(draftArrangement);
    draftArrangement = null;
    selectedArrangementScreen = null;
    renderArrangementEditor();
    apply(true);
  }

  function resetArrangementDraft() {
    draftArrangement = null;
    selectedArrangementScreen = null;
    renderArrangementEditor();
  }

  function moveSelectedArrangement(dx, dy) {
    const hint = document.getElementById("webkdeArrangementHint");
    if (selectedArrangementScreen === null) {
      if (hint) hint.textContent = "Select a screen before using the arrow controls.";
      return;
    }
    const positions = editableArrangement();
    const selected = positions.find(position => position.index === selectedArrangementScreen);
    const targetX = selected.x + dx;
    const targetY = selected.y + dy;
    const occupant = positions.find(position => position.x === targetX && position.y === targetY);
    const next = positions.map(position => {
      if (position.index === selected.index) return {...position, x: targetX, y: targetY};
      if (occupant && position.index === occupant.index)
        return {...position, x: selected.x, y: selected.y};
      return position;
    });
    stageArrangement(next, true);
  }

  function renderArrangementEditor() {
    const board = document.getElementById("webkdeArrangementBoard");
    const hint = document.getElementById("webkdeArrangementHint");
    if (!board) return;
    const positions = editableArrangement();
    const active = screenArrangement();
    const connected = arrangementConnected(positions);
    const changed = !arrangementsEqual(positions, active);
    const columns = Math.max(...positions.map(position => position.x)) + 1;
    const rows = Math.max(...positions.map(position => position.y)) + 1;
    board.replaceChildren();
    board.style.display = "grid";
    board.style.gridTemplateColumns = `repeat(${columns}, minmax(3rem, 1fr))`;
    board.style.gridTemplateRows = `repeat(${rows}, 2.7rem)`;
    board.style.gap = ".35rem";
    board.style.margin = ".5rem 0";
    board.style.maxWidth = `${Math.max(9, columns * 4.5)}rem`;
    for (const position of positions) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "resolution-button";
      tile.style.gridColumn = String(position.x + 1);
      tile.style.gridRow = String(position.y + 1);
      tile.style.minWidth = "0";
      tile.style.outline = selectedArrangementScreen === position.index ? "2px solid #59a9ff" : "";
      tile.textContent = position.index === 1 ? "Screen 1 ★" : `Screen ${position.index}`;
      tile.title = position.index === 1 ? "Screen 1 (primary)" : `Screen ${position.index}`;
      tile.addEventListener("click", () => {
        if (selectedArrangementScreen === null) {
          selectedArrangementScreen = position.index;
          renderArrangementEditor();
          return;
        }
        if (selectedArrangementScreen === position.index) {
          selectedArrangementScreen = null;
          renderArrangementEditor();
          return;
        }
        const selected = positions.find(item => item.index === selectedArrangementScreen);
        const next = positions.map(item => item.index === selected.index ?
          {...item, x: position.x, y: position.y} : item.index === position.index ?
            {...item, x: selected.x, y: selected.y} : item);
        stageArrangement(next);
      });
      board.appendChild(tile);
    }
    const applyButton = document.getElementById("webkdeArrangementApply");
    const resetButton = document.getElementById("webkdeArrangementReset");
    if (applyButton) applyButton.disabled = !changed || !connected;
    if (resetButton) resetButton.disabled = !changed;
    if (hint) {
      if (!connected)
        hint.textContent = "Screens must share edges before this arrangement can be applied.";
      else if (selectedArrangementScreen !== null)
        hint.textContent = `Screen ${selectedArrangementScreen} selected. Arrows move it; moving into another tile swaps them.`;
      else if (changed)
        hint.textContent = "Arrangement changed. Apply it or reset the draft.";
      else
        hint.textContent = "Choose a preset or select a screen and move it with the arrows; ★ marks the primary output.";
    }
  }

  function mountControl() {
    const section = document.querySelector("#screen-settings-content");
    if (!section || document.querySelector("#webkdeVirtualScreens")) return;

    const screenItem = document.createElement("div");
    screenItem.className = "dev-setting-item";
    screenItem.innerHTML = '<label for="webkdeVirtualScreens">Virtual screens</label><select id="webkdeVirtualScreens"></select><div id="webkdeScreenButtons" style="display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem"></div><small id="webkdeEffectiveResolution"></small><small>Manage virtual output count and UI scale here. KDE Display Configuration scale/rearrange is unsupported for nested outputs.</small>';
    const select = screenItem.querySelector("select");
    for (let count = 1; count <= maxScreens; count++) {
      const option = document.createElement("option");
      option.value = option.textContent = String(count);
      select.appendChild(option);
    }
    select.value = String(screenCount());
    select.addEventListener("change", () => {
      localStorage.setItem(screenStorageKey, select.value);
      saveArrangement(presetArrangement(screenCount(), "row"));
      draftArrangement = null;
      selectedArrangementScreen = null;
      rebuildOpenButtons();
      renderArrangementEditor();
      apply(true);
    });

    const arrangementItem = document.createElement("div");
    arrangementItem.className = "dev-setting-item";
    arrangementItem.innerHTML = '<label>Screen arrangement</label><div id="webkdeArrangementPresets" style="display:flex;flex-wrap:wrap;gap:.35rem"><button type="button" class="resolution-button" data-preset="row">Row</button><button type="button" class="resolution-button" data-preset="column">Column</button><button type="button" class="resolution-button" data-preset="compact">Grid</button></div><div id="webkdeArrangementBoard"></div><div id="webkdeArrangementArrows" style="display:grid;grid-template-columns:repeat(3,2.5rem);grid-template-rows:repeat(3,2.25rem);gap:.25rem;width:max-content;margin:.35rem 0"><button type="button" class="resolution-button" data-move-x="0" data-move-y="-1" style="grid-column:2;grid-row:1">↑</button><button type="button" class="resolution-button" data-move-x="-1" data-move-y="0" style="grid-column:1;grid-row:2">←</button><button type="button" class="resolution-button" data-move-x="1" data-move-y="0" style="grid-column:3;grid-row:2">→</button><button type="button" class="resolution-button" data-move-x="0" data-move-y="1" style="grid-column:2;grid-row:3">↓</button></div><div style="display:flex;gap:.35rem;margin:.5rem 0"><button type="button" id="webkdeArrangementApply" class="resolution-button">Apply</button><button type="button" id="webkdeArrangementReset" class="resolution-button">Reset</button></div><small id="webkdeArrangementHint"></small>';
    for (const button of arrangementItem.querySelectorAll("[data-preset]")) {
      button.addEventListener("click", () =>
        stageArrangement(presetArrangement(screenCount(), button.dataset.preset)));
    }
    for (const button of arrangementItem.querySelectorAll("[data-move-x]")) {
      button.addEventListener("click", () => moveSelectedArrangement(
        Number(button.dataset.moveX), Number(button.dataset.moveY)));
    }
    arrangementItem.querySelector("#webkdeArrangementApply").addEventListener("click", applyArrangement);
    arrangementItem.querySelector("#webkdeArrangementReset").addEventListener("click", resetArrangementDraft);

    const resetItem = document.createElement("div");
    resetItem.className = "dev-setting-item";
    resetItem.innerHTML = '<label for="webkdeResetDisplays">Display recovery</label><button type="button" id="webkdeResetDisplays" class="resolution-button">Reset Displays</button>';
    const resetButton = resetItem.querySelector("button");
    resetButton.addEventListener("click", () => {
      if (!confirm("Reset the persisted KDE display state and restart KWin? Wayland applications may close.")) return;
      if (dataSocket?.readyState !== WebSocket.OPEN)
        return alert("The WebKDE connection is not ready. Try again in a moment.");
      resetButton.disabled = true;
      resetButton.textContent = "Resetting Displays…";
      nativeSend.call(dataSocket, "WEBKDE_RESET_DISPLAYS");
      setTimeout(() => apply(true), 4000);
      setTimeout(() => apply(true), 7000);
      setTimeout(() => {
        resetButton.disabled = false;
        resetButton.textContent = "Reset Displays";
      }, 10000);
    });

    const restartItem = document.createElement("div");
    restartItem.className = "dev-setting-item";
    restartItem.innerHTML = '<label for="webkdeRestartPlasma">Desktop session</label><button type="button" id="webkdeRestartPlasma" class="resolution-button">Restart Plasma</button>';
    const restartButton = restartItem.querySelector("button");
    restartButton.addEventListener("click", () => {
      if (!confirm("Restart the Plasma desktop? Open applications in this session will be closed.")) return;
      if (dataSocket?.readyState !== WebSocket.OPEN) return alert("The WebKDE connection is not ready. Try again in a moment.");
      restartButton.disabled = true;
      restartButton.textContent = "Restarting Plasma…";
      nativeSend.call(dataSocket, "WEBKDE_RESTART_PLASMA");
      setTimeout(() => { restartButton.disabled = false; restartButton.textContent = "Restart Plasma"; }, 10000);
    });

    const kwinItem = document.createElement("div");
    kwinItem.className = "dev-setting-item";
    kwinItem.innerHTML = '<label for="webkdeRestartKwin">Wayland compositor</label><button type="button" id="webkdeRestartKwin" class="resolution-button">Restart KWin</button>';
    const kwinButton = kwinItem.querySelector("button");
    kwinButton.addEventListener("click", () => {
      if (!confirm("Restart KWin? Wayland applications may close, and Plasma may restart as part of recovery.")) return;
      if (dataSocket?.readyState !== WebSocket.OPEN) return alert("The WebKDE connection is not ready. Try again in a moment.");
      kwinButton.disabled = true;
      kwinButton.textContent = "Restarting KWin…";
      nativeSend.call(dataSocket, "WEBKDE_RESTART_KWIN");
      setTimeout(() => apply(true), 3000);
      setTimeout(() => apply(true), 6000);
      setTimeout(() => { kwinButton.disabled = false; kwinButton.textContent = "Restart KWin"; apply(true); }, 10000);
    });

    section.prepend(kwinItem);
    section.prepend(restartItem);
    section.prepend(resetItem);
    section.prepend(arrangementItem);
    section.prepend(screenItem);
    rebuildOpenButtons();
    renderArrangementEditor();
    updateEffectiveResolution();
  }

  new MutationObserver(() => {
    mountControl();
    updateControlCrop();
  }).observe(document.documentElement, {childList: true, subtree: true});
  addEventListener("resize", () => {
    updateControlCrop();
  });
  addEventListener("storage", event => {
    if (event.key === screenStorageKey || event.key === arrangementStorageKey) {
      draftArrangement = null;
      selectedArrangementScreen = null;
      rebuildOpenButtons();
      renderArrangementEditor();
      apply(true);
    }
  });
  addEventListener("beforeunload", () => notifySatellites("webkde:control-closed"));
  addEventListener("load", () => setTimeout(() => apply(true), 1500));
  requestAnimationFrame(maintainPerTabSurface);
})();

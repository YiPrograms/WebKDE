(() => {
  const configStorageKey = "webkde.virtualScreensV3";
  const profileStorageKey = "webkde.virtualScreenProfilesV1";
  const autoStartStorageKey = "webkde.virtualScreensAutoStartV1";
  const legacyCountKey = "webkde.virtualScreens";
  const legacyArrangementKey = "webkde.screenArrangement";
  const maxScreens = Number(document.currentScript?.dataset.maxScreens || 8);
  const atlasLimit = 4080;
  const nativeSend = WebSocket.prototype.send;
  const nativeDocumentAddEventListener = Document.prototype.addEventListener;
  const observedSockets = new WeakSet();
  let streamStarted = localStorage.getItem(autoStartStorageKey) === "true";
  let suspendedSocket = null;
  let suspendedMessages = [];
  const satellites = new Map();
  let dataSocket;
  let layoutTimer;
  let satelliteButtonMask = 0;
  let appliedLayout = null;
  let controlView = null;
  let cursorSignature = "";
  let managerWindow = null;
  let resolutionRequest = 0;
  let config = loadConfig();

  // Satellite tabs depend on this tab's decoder, including while it is hidden.
  Document.prototype.addEventListener = function(type, listener, options) {
    if (this === document && type === "visibilitychange")
      return nativeDocumentAddEventListener.call(this, type, function() {}, options);
    return nativeDocumentAddEventListener.call(this, type, listener, options);
  };

  function viewportResolution() {
    const viewport = window.visualViewport;
    const ratio = devicePixelRatio || 1;
    return {
      width: Math.max(8, Math.floor((viewport?.width || innerWidth) * ratio / 8) * 8),
      height: Math.max(2, Math.floor((viewport?.height || innerHeight) * ratio / 2) * 2),
    };
  }

  function defaultConfig(count = 1) {
    const size = viewportResolution();
    return {
      version: 3,
      screens: Array.from({length: count}, (_, offset) => ({
        index: offset + 1, width: size.width, height: size.height,
        followViewport: offset === 0,
      })),
      anchors: Array.from({length: count}, (_, offset) => offset === 0 ? {index: 1} : ({
        index: offset + 1, parent: offset, side: "right", align: "center",
      })),
    };
  }

  function anchorsFromLegacy(count, positions) {
    const byIndex = new Map((Array.isArray(positions) ? positions : []).map(item => [Number(item.index), item]));
    if (byIndex.size !== count) return defaultConfig(count).anchors;
    const anchors = [{index: 1}];
    const connected = new Set([1]);
    while (connected.size < count) {
      let progress = false;
      for (let index = 2; index <= count; index++) {
        if (connected.has(index)) continue;
        const item = byIndex.get(index);
        for (const parent of connected) {
          const base = byIndex.get(parent);
          const dx = Number(item.x) - Number(base.x);
          const dy = Number(item.y) - Number(base.y);
          if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
          anchors.push({index, parent, side: dx < 0 ? "left" : dx > 0 ? "right" : dy < 0 ? "top" : "bottom", align: "start"});
          connected.add(index);
          progress = true;
          break;
        }
      }
      if (!progress) return defaultConfig(count).anchors;
    }
    return anchors;
  }

  function normalizeConfig(value) {
    const count = Math.max(1, Math.min(maxScreens, value?.screens?.length || 1));
    const fallback = defaultConfig(count);
    const screens = Array.from({length: count}, (_, offset) => {
      const item = value?.screens?.find(screen => Number(screen.index) === offset + 1) || fallback.screens[offset];
      return {
        index: offset + 1,
        width: Math.max(8, Math.min(16384, Math.floor((Number(item.width) || fallback.screens[offset].width) / 8) * 8)),
        height: Math.max(2, Math.min(16384, Math.floor((Number(item.height) || fallback.screens[offset].height) / 2) * 2)),
        followViewport: offset === 0 && item.followViewport === true,
      };
    });
    const known = new Set(screens.map(item => item.index));
    const anchors = [{index: 1}];
    for (let index = 2; index <= count; index++) {
      const item = value?.anchors?.find(anchor => Number(anchor.index) === index);
      anchors.push(item && known.has(Number(item.parent)) ? {
        index, parent: Number(item.parent),
        side: ["left", "right", "top", "bottom"].includes(item.side) ? item.side : "right",
        align: ["start", "center", "end"].includes(item.align) ? item.align : "center",
        ...(Number.isInteger(item.offset) ? {offset: item.offset} : {}),
      } : fallback.anchors[index - 1]);
    }
    return {version: 3, screens, anchors};
  }

  function loadConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(configStorageKey) || "null");
      if (saved?.version === 3) return normalizeConfig(saved);
    } catch (_) {}
    const count = Math.max(1, Math.min(maxScreens, Number(localStorage.getItem(legacyCountKey)) || 1));
    const migrated = defaultConfig(count);
    try {
      migrated.anchors = anchorsFromLegacy(count, JSON.parse(localStorage.getItem(legacyArrangementKey) || "null"));
    } catch (_) {}
    localStorage.setItem(configStorageKey, JSON.stringify(migrated));
    return migrated;
  }

  function saveConfig(next) {
    config = normalizeConfig(next);
    localStorage.setItem(configStorageKey, JSON.stringify(config));
    rebuildOpenButtons();
  }

  function savedProfiles() {
    try {
      const value = JSON.parse(localStorage.getItem(profileStorageKey) || "null");
      if (value?.version !== 1 || !Array.isArray(value.profiles)) return [];
      return value.profiles.filter(profile => typeof profile?.name === "string" && profile.name.trim() &&
        profile.config?.version === 3 && Array.isArray(profile.config.screens) && profile.config.screens.length)
        .map(profile => ({name: profile.name.trim(), config: normalizeConfig(profile.config)}))
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch (_) {
      return [];
    }
  }

  function startStreaming(nextConfig = null) {
    if (nextConfig) saveConfig(nextConfig);
    const remember = document.getElementById("webkdeAutoStart")?.checked === true;
    localStorage.setItem(autoStartStorageKey, String(remember));
    streamStarted = true;
    document.getElementById("webkdeStartup")?.remove();
    const socket = suspendedSocket;
    const messages = suspendedMessages;
    suspendedSocket = null;
    suspendedMessages = [];
    if (!socket) return;
    if (socket.readyState !== WebSocket.OPEN) {
      alert("The WebKDE connection closed while waiting. Reload the tab and try again.");
      return;
    }
    for (const message of messages) socket.send(message);
  }

  function screenCount() {
    return config.screens.length;
  }

  function alignedWidth(value) {
    return Math.max(8, Math.floor(value / 8) * 8);
  }

  function alignedHeight(value) {
    return Math.max(2, Math.floor(value / 2) * 2);
  }

  function splitFreeRect(free, used) {
    if (used.x >= free.x + free.width || used.x + used.width <= free.x ||
        used.y >= free.y + free.height || used.y + used.height <= free.y) return [free];
    const result = [];
    if (used.x > free.x) result.push({x: free.x, y: free.y, width: used.x - free.x, height: free.height});
    if (used.x + used.width < free.x + free.width)
      result.push({x: used.x + used.width, y: free.y, width: free.x + free.width - used.x - used.width, height: free.height});
    if (used.y > free.y) result.push({x: free.x, y: free.y, width: free.width, height: used.y - free.y});
    if (used.y + used.height < free.y + free.height)
      result.push({x: free.x, y: used.y + used.height, width: free.width, height: free.y + free.height - used.y - used.height});
    return result.filter(rect => rect.width > 0 && rect.height > 0);
  }

  function pruneFreeRects(rects) {
    return rects.filter((rect, index) => !rects.some((other, otherIndex) => index !== otherIndex &&
      rect.x >= other.x && rect.y >= other.y &&
      rect.x + rect.width <= other.x + other.width &&
      rect.y + rect.height <= other.y + other.height));
  }

  function packingOrders(rects) {
    const comparators = [
      (a, b) => b.width * b.height - a.width * a.height || b.width - a.width || a.index - b.index,
      (a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height) || a.index - b.index,
      (a, b) => b.height - a.height || b.width - a.width || a.index - b.index,
      (a, b) => b.width - a.width || b.height - a.height || a.index - b.index,
      (a, b) => a.index - b.index,
    ];
    const unique = new Map();
    for (const compare of comparators) {
      const order = rects.slice().sort(compare);
      unique.set(order.map(item => item.index).join(","), order);
    }
    return [...unique.values()];
  }

  function packAtScale(screens, scale) {
    const sized = screens.map(item => ({
      index: item.index,
      requestedWidth: item.width,
      requestedHeight: item.height,
      width: alignedWidth(item.width * scale),
      height: alignedHeight(item.height * scale),
    }));
    let best = null;
    for (const order of packingOrders(sized)) {
      let freeRects = [{x: 0, y: 0, width: atlasLimit, height: atlasLimit}];
      const placed = [];
      let failed = false;
      for (const item of order) {
        const choices = freeRects.filter(rect => item.width <= rect.width && item.height <= rect.height)
          .map(rect => ({rect, short: Math.min(rect.width - item.width, rect.height - item.height), long: Math.max(rect.width - item.width, rect.height - item.height)}))
          .sort((left, right) => left.short - right.short || left.long - right.long || left.rect.y - right.rect.y || left.rect.x - right.rect.x);
        if (!choices.length) { failed = true; break; }
        const used = {...item, x: choices[0].rect.x, y: choices[0].rect.y};
        placed.push(used);
        freeRects = pruneFreeRects(freeRects.flatMap(rect => splitFreeRect(rect, used)));
      }
      if (failed) continue;
      const atlasWidth = Math.max(...placed.map(rect => rect.x + rect.width));
      const atlasHeight = Math.max(...placed.map(rect => rect.y + rect.height));
      const candidate = {screens: placed.sort((a, b) => a.index - b.index), atlasWidth, atlasHeight};
      const score = [atlasWidth * atlasHeight, Math.max(atlasWidth, atlasHeight), atlasHeight, atlasWidth];
      if (!best || score.some((value, index) => value < best.score[index] && score.slice(0, index).every((prior, priorIndex) => prior === best.score[priorIndex])))
        best = {...candidate, score};
    }
    return best;
  }

  function calculateAtlas(current = config) {
    let packed = packAtScale(current.screens, 1);
    let scale = 1;
    if (!packed) {
      let low = 0;
      let high = 1;
      for (let attempt = 0; attempt < 18; attempt++) {
        const middle = (low + high) / 2;
        const candidate = packAtScale(current.screens, middle);
        if (candidate) { low = middle; packed = candidate; }
        else high = middle;
      }
      scale = low;
      packed = packAtScale(current.screens, scale);
    }
    return {mode: "per-tab", count: current.screens.length, scale, ...packed};
  }

  function observeDataSocket(socket) {
    dataSocket = socket;
    if (observedSockets.has(socket)) return;
    observedSockets.add(socket);
    socket.addEventListener("message", event => {
      if (typeof event.data !== "string" || !event.data.startsWith("WEBKDE_LAYOUT_V3_APPLIED,")) return;
      try {
        appliedLayout = JSON.parse(event.data.slice("WEBKDE_LAYOUT_V3_APPLIED,".length));
        updateControlCrop();
        updateEffectiveResolution();
        notifySatellites("webkde:layout");
        managerWindow?.postMessage({type: "webkde:layout-applied", layout: appliedLayout}, location.origin);
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
    const rect = appliedLayout.screens?.find(item => item.index === 1);
    if (!rect) return message;
    const viewport = window.visualViewport;
    const ratio = devicePixelRatio || 1;
    const inputWidth = Math.max(1, (viewport?.width || innerWidth) * ratio);
    const inputHeight = Math.max(1, (viewport?.height || innerHeight) * ratio);
    let normalizedX = Math.max(0, Math.min(inputWidth, Number(parts[1]) || 0)) / inputWidth;
    let normalizedY = Math.max(0, Math.min(inputHeight, Number(parts[2]) || 0)) / inputHeight;
    if (controlView) {
      normalizedX = (normalizedX * controlView.containerWidth - controlView.x) / controlView.width;
      normalizedY = (normalizedY * controlView.containerHeight - controlView.y) / controlView.height;
    }
    parts[1] = String(Math.round(rect.x + Math.max(0, Math.min(1, normalizedX)) * Math.max(0, rect.width - 1)));
    parts[2] = String(Math.round(rect.y + Math.max(0, Math.min(1, normalizedY)) * Math.max(0, rect.height - 1)));
    return parts.join(",");
  }

  WebSocket.prototype.send = function(data) {
    if (!streamStarted && (this === suspendedSocket ||
        (suspendedSocket === null && typeof data === "string" && data.startsWith("SETTINGS,")))) {
      if (suspendedSocket === null) {
        suspendedSocket = this;
        observeDataSocket(this);
      }
      suspendedMessages.push(data);
      return;
    }
    let scalingDpi;
    let scheduleLayout = false;
    if (typeof data === "string" && data.startsWith("SETTINGS,")) {
      observeDataSocket(this);
      try {
        const settings = JSON.parse(data.slice("SETTINGS,".length));
        scalingDpi = Number(settings.scaling_dpi);
        const manual = settings.is_manual_resolution_mode === true || String(settings.is_manual_resolution_mode).toLowerCase() === "true";
        if (screenCount() === 1 && config.screens[0].followViewport) {
          const size = manual ? {width: Number(settings.manual_width), height: Number(settings.manual_height)} : viewportResolution();
          if (size.width > 0 && size.height > 0) {
            config.screens[0].width = alignedWidth(size.width);
            config.screens[0].height = alignedHeight(size.height);
            if (manual) config.screens[0].followViewport = false;
            saveConfig(config);
          }
        }
        const atlas = calculateAtlas();
        settings.initialClientWidth = atlas.atlasWidth;
        settings.initialClientHeight = atlas.atlasHeight;
        data = `SETTINGS,${JSON.stringify(settings)}`;
        scheduleLayout = true;
      } catch (error) {
        console.warn("Could not prepare WebKDE settings", error);
      }
    } else if (typeof data === "string" && data.startsWith("r,")) {
      const dimensions = data.split(",")[1]?.split("x").map(Number);
      if (screenCount() === 1 && config.screens[0].followViewport && dimensions?.length === 2 && dimensions.every(value => value > 0)) {
        config.screens[0].width = alignedWidth(dimensions[0]);
        config.screens[0].height = alignedHeight(dimensions[1]);
        saveConfig(config);
      }
      const atlas = calculateAtlas();
      data = `r,${atlas.atlasWidth}x${atlas.atlasHeight},primary`;
      scheduleLayout = true;
    } else if (typeof data === "string") data = transformAbsoluteMouse(data);

    const result = nativeSend.call(this, data);
    if (scheduleLayout) setTimeout(() => applyLayout(true, false), 0);
    if (scalingDpi >= 96 && scalingDpi <= 288 && scalingDpi % 24 === 0) {
      setTimeout(() => {
        if (this.readyState !== WebSocket.OPEN) return;
        nativeSend.call(this, `WEBKDE_SCALE,${scalingDpi}`);
        setTimeout(() => applyLayout(true), 250);
      }, 0);
    }
    return result;
  };

  function applyLayout(force = false, resizeStream = true) {
    if (!streamStarted) return;
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => {
      if (dataSocket?.readyState !== WebSocket.OPEN) {
        setTimeout(() => applyLayout(true), 500);
        return;
      }
      const atlas = calculateAtlas();
      appliedLayout = atlas;
      if (resizeStream) nativeSend.call(dataSocket, `r,${atlas.atlasWidth}x${atlas.atlasHeight},primary`);
      nativeSend.call(dataSocket, `WEBKDE_LAYOUT_V3,${JSON.stringify(config)}`);
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
    const rect = appliedLayout.screens?.find(item => item.index === 1);
    if (!canvas || !container || !rect) return;
    const bounds = container.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const scale = Math.min(bounds.width / rect.width, bounds.height / rect.height);
    const visibleWidth = rect.width * scale;
    const visibleHeight = rect.height * scale;
    controlView = {x: (bounds.width - visibleWidth) / 2, y: (bounds.height - visibleHeight) / 2,
      width: visibleWidth, height: visibleHeight, containerWidth: bounds.width, containerHeight: bounds.height};
    canvas.style.setProperty("max-width", "none", "important");
    canvas.style.setProperty("max-height", "none", "important");
    canvas.style.setProperty("width", `${appliedLayout.atlasWidth * scale}px`, "important");
    canvas.style.setProperty("height", `${appliedLayout.atlasHeight * scale}px`, "important");
    canvas.style.setProperty("left", `${controlView.x - rect.x * scale}px`, "important");
    canvas.style.setProperty("top", `${controlView.y - rect.y * scale}px`, "important");
    if (overlay) {
      for (const [property, value] of [["width", "100%"], ["height", "100%"], ["left", "0"], ["top", "0"]])
        overlay.style.setProperty(property, value, "important");
    }
  }

  function clearControlCrop() {
    controlView = null;
    const canvas = controlCanvas();
    if (canvas) for (const property of ["max-width", "max-height", "width", "height", "left", "top"])
      canvas.style.removeProperty(property);
    const overlay = document.getElementById("overlayInput");
    if (overlay) for (const property of ["width", "height", "left", "top"]) overlay.style.removeProperty(property);
  }

  function notifySatellites(type, extra = {}) {
    for (const [index, entry] of satellites) {
      if (entry.window.closed) { satellites.delete(index); continue; }
      const requested = config.screens.find(item => item.index === index);
      entry.window.postMessage({type, screen: index, ...extra,
        ...(type === "webkde:layout" && requested ? {configuredWidth: requested.width, configuredHeight: requested.height} : {})}, location.origin);
    }
  }

  function domButtonsToMask(buttons) {
    return ((buttons & 1) ? 1 : 0) | ((buttons & 4) ? 2 : 0) | ((buttons & 2) ? 4 : 0);
  }
  addEventListener("mousedown", event => { satelliteButtonMask = domButtonsToMask(event.buttons); }, true);
  addEventListener("mouseup", event => { satelliteButtonMask = domButtonsToMask(event.buttons); }, true);

  function currentCursor() {
    const input = window.webrtcInput;
    if (typeof input?._cursorBase64Data !== "string" || !input._cursorBase64Data) return null;
    return {data: input._cursorBase64Data, hotspotX: Math.max(0, Math.round(Number(input._rawHotspotX) || 0)),
      hotspotY: Math.max(0, Math.round(Number(input._rawHotspotY) || 0)), desktopScale: Math.max(1, Number(appliedLayout?.desktopScale) || 1)};
  }

  function restoreControlCursorSize() {
    const input = window.webrtcInput;
    const bitmap = input?._cursorImageBitmap;
    const pointer = input?.cursorDiv;
    if (!bitmap || !pointer || input.use_browser_cursors) return;
    const scale = Math.max(1, Number(appliedLayout?.desktopScale) || 1);
    pointer.style.width = `${bitmap.width / scale}px`;
    pointer.style.height = `${bitmap.height / scale}px`;
    if (input.cursorHotspot) {
      input.cursorHotspot.x = Math.max(0, Number(input._rawHotspotX) || 0) / scale;
      input.cursorHotspot.y = Math.max(0, Number(input._rawHotspotY) || 0) / scale;
    }
    input._updateCursorPosition?.(input._latestMouseX, input._latestMouseY);
  }

  function publishCursor(force = false) {
    const cursor = currentCursor();
    const signature = cursor ? `${cursor.hotspotX},${cursor.hotspotY},${cursor.desktopScale},${cursor.data}` : "";
    if (!force && signature === cursorSignature) return;
    cursorSignature = signature;
    notifySatellites("webkde:cursor", {cursor});
  }

  function publishSatelliteFrames() {
    if (!appliedLayout) return;
    const canvas = controlCanvas();
    if (!canvas?.width || !canvas.height) return;
    for (const [screen, entry] of satellites) {
      const rect = appliedLayout.screens?.find(item => item.index === screen);
      if (!rect || entry.framePending || entry.window.closed) continue;
      entry.framePending = true;
      createImageBitmap(canvas, rect.x, rect.y, rect.width, rect.height).then(bitmap => {
        if (!entry.window.closed) entry.window.postMessage({type: "webkde:frame", screen, bitmap}, location.origin, [bitmap]);
        else bitmap.close();
      }).catch(error => console.warn(`Could not publish WebKDE Screen ${screen}`, error))
        .finally(() => { entry.framePending = false; });
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
    const rect = appliedLayout?.screens?.find(item => item.index === screen);
    if (!input) return;
    if ((input.kind === "mouse" || input.kind === "wheel") && rect && dataSocket?.readyState === WebSocket.OPEN) {
      const x = Math.round(rect.x + Math.max(0, Math.min(1, input.x)) * Math.max(0, rect.width - 1));
      const y = Math.round(rect.y + Math.max(0, Math.min(1, input.y)) * Math.max(0, rect.height - 1));
      if (input.kind === "mouse") {
        if ((input.type === "mousedown" || input.type === "mouseup") && Number.isInteger(input.button) && input.button >= 0 && input.button <= 4) {
          const bit = 1 << input.button;
          if (input.type === "mousedown") satelliteButtonMask |= bit;
          else satelliteButtonMask &= ~bit;
        }
        nativeSend.call(dataSocket, `m,${x},${y},${satelliteButtonMask},0`);
      } else {
        nativeSend.call(dataSocket, `m,${x},${y},${satelliteButtonMask},0`);
        const pulse = (bit, magnitude) => {
          satelliteButtonMask |= bit;
          nativeSend.call(dataSocket, `m2,0,0,${satelliteButtonMask},${magnitude}`);
          setTimeout(() => {
            satelliteButtonMask &= ~bit;
            if (dataSocket?.readyState === WebSocket.OPEN) nativeSend.call(dataSocket, `m2,0,0,${satelliteButtonMask},${magnitude}`);
          }, 10);
        };
        if (input.deltaY) pulse(1 << (input.deltaY < 0 ? 4 : 3), Math.max(1, Math.round(Math.abs(input.deltaY) / 100)));
        if (input.deltaX) pulse(1 << (input.deltaX < 0 ? 6 : 7), Math.max(1, Math.round(Math.abs(input.deltaX) / 100)));
      }
    } else if (input.kind === "key") {
      window.dispatchEvent(new KeyboardEvent(input.type, {bubbles: true, cancelable: true, key: input.key, code: input.code,
        location: input.location, repeat: input.repeat, ctrlKey: input.ctrlKey, shiftKey: input.shiftKey, altKey: input.altKey, metaKey: input.metaKey}));
    } else if (input.kind === "blur") {
      if (!input.preserveButtons) {
        satelliteButtonMask = 0;
        if (dataSocket?.readyState === WebSocket.OPEN) nativeSend.call(dataSocket, "m2,0,0,0,0");
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
    if (bytes.length < 65536) return nativeSend.call(dataSocket, `cw,${encode(bytes)}`);
    nativeSend.call(dataSocket, `cws,${bytes.length}`);
    for (let offset = 0; offset < bytes.length; offset += 49152)
      nativeSend.call(dataSocket, `cwd,${encode(bytes.subarray(offset, offset + 49152))}`);
    nativeSend.call(dataSocket, "cwe");
  }

  function openScreen(screen) {
    const width = Math.max(640, Math.round(innerWidth * .8));
    const height = Math.max(480, Math.round(innerHeight * .8));
    const satellite = window.open(`./webkde-screen.html?screen=${screen}`, `webkde-screen-${screen}`,
      `popup=yes,width=${width},height=${height},resizable=yes`);
    if (!satellite) alert("The browser blocked the screen tab. Allow pop-ups for this WebKDE site.");
  }

  function openManager() {
    const availableWidth = window.screen?.availWidth || innerWidth;
    const availableHeight = window.screen?.availHeight || innerHeight;
    const width = Math.min(1280, Math.max(720, Math.round(availableWidth * .86)));
    const height = Math.min(960, Math.max(640, Math.round(availableHeight * .86)));
    const left = Math.max(0, Math.round((availableWidth - width) / 2));
    const top = Math.max(0, Math.round((availableHeight - height) / 2));
    managerWindow = window.open(`./webkde-screens.html?max=${maxScreens}`, "webkde-virtual-screens",
      `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`);
    if (!managerWindow) alert("The browser blocked the virtual-screen control tab. Allow pop-ups for this WebKDE site.");
  }

  function mountStartupChooser() {
    if (streamStarted || document.getElementById("webkdeStartup") || !document.body) return;
    const overlay = document.createElement("div");
    overlay.id = "webkdeStartup";
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:1rem;background:#0b0e13f2;color:#edf2f7;font-family:system-ui,sans-serif";
    overlay.innerHTML = `<section role="dialog" aria-modal="true" aria-labelledby="webkdeStartupTitle" style="width:min(34rem,100%);padding:clamp(1rem,4vw,1.5rem);border:1px solid #526174;border-radius:.75rem;background:#171d26;box-shadow:0 1rem 3rem #000a">
      <h1 id="webkdeStartupTitle" style="margin:0 0 .4rem;font-size:1.35rem">Choose virtual screens</h1>
      <p style="margin:0 0 1rem;color:#aeb9c8;line-height:1.45">Streaming will start after you choose a layout.</p>
      <div style="display:grid;gap:.65rem">
        <button type="button" id="webkdeUseOne" style="min-height:2.6rem;color:inherit;background:#1769aa;border:1px solid #58a6e7;border-radius:.4rem;cursor:pointer">Use one monitor</button>
        <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.5rem"><select id="webkdeStartupProfile" aria-label="Saved screen profile" style="min-width:0;min-height:2.6rem;color:inherit;background:#202936;border:1px solid #526174;border-radius:.4rem;padding:.45rem .65rem"><option value="">Select a saved profile…</option></select><button type="button" id="webkdeUseProfile" disabled style="min-height:2.6rem;color:inherit;background:#202936;border:1px solid #526174;border-radius:.4rem;padding:.45rem .8rem;cursor:pointer">Use profile</button></div>
        <button type="button" id="webkdeUseCustom" style="min-height:2.6rem;color:inherit;background:#202936;border:1px solid #526174;border-radius:.4rem;cursor:pointer">Custom…</button>
        <label style="display:flex;align-items:flex-start;gap:.55rem;margin-top:.35rem;color:#c9d4e2;line-height:1.35"><input type="checkbox" id="webkdeAutoStart" style="margin-top:.2rem">Automatically use the last applied settings next time</label>
      </div>
    </section>`;
    const profiles = savedProfiles();
    const select = overlay.querySelector("#webkdeStartupProfile");
    for (const profile of profiles) select.add(new Option(profile.name, profile.name));
    const useProfile = overlay.querySelector("#webkdeUseProfile");
    select.addEventListener("change", () => { useProfile.disabled = !select.value; });
    overlay.querySelector("#webkdeUseOne").addEventListener("click", () => startStreaming(defaultConfig(1)));
    useProfile.addEventListener("click", () => {
      const profile = profiles.find(item => item.name === select.value);
      if (profile) startStreaming(profile.config);
    });
    overlay.querySelector("#webkdeUseCustom").addEventListener("click", openManager);
    document.body.appendChild(overlay);
  }

  function rebuildOpenButtons() {
    const host = document.getElementById("webkdeScreenButtons");
    if (!host) return;
    host.replaceChildren();
    for (let screen = 2; screen <= screenCount(); screen++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "resolution-button";
      button.textContent = `Open Screen ${screen}`;
      button.addEventListener("click", () => openScreen(screen));
      host.appendChild(button);
    }
  }

  function updateEffectiveResolution() {
    const output = document.getElementById("webkdeEffectiveResolution");
    if (!output || !appliedLayout?.screens) return;
    output.textContent = appliedLayout.screens.map(rect => {
      const requested = config.screens.find(item => item.index === rect.index);
      const reduced = rect.width < requested.width || rect.height < requested.height;
      return `Screen ${rect.index}: ${rect.width}×${rect.height}${reduced ? " reduced" : ""}`;
    }).join("; ") + `. Shared atlas ${appliedLayout.atlasWidth}×${appliedLayout.atlasHeight}.`;
  }

  function recoveryItem(label, id, text, confirmation, command, delays = []) {
    const item = document.createElement("div");
    item.className = "dev-setting-item";
    item.innerHTML = `<label for="${id}">${label}</label><button type="button" id="${id}" class="resolution-button">${text}</button>`;
    const button = item.querySelector("button");
    button.addEventListener("click", () => {
      if (!confirm(confirmation)) return;
      if (dataSocket?.readyState !== WebSocket.OPEN) return alert("The WebKDE connection is not ready. Try again in a moment.");
      button.disabled = true;
      button.textContent = `${text.replace(/^Restart /, "Restarting ").replace(/^Reset /, "Resetting ")}…`;
      nativeSend.call(dataSocket, command);
      for (const delay of delays) setTimeout(() => applyLayout(true), delay);
      setTimeout(() => { button.disabled = false; button.textContent = text; }, 10000);
    });
    return item;
  }

  function hideNativeResolutionControls() {
    const preset = document.getElementById("resolutionPresetSelect");
    preset?.closest(".dev-setting-item")?.setAttribute("hidden", "");
    for (const selector of [
      "#screen-settings-content > .resolution-manual-inputs",
      "#screen-settings-content > .resolution-action-buttons",
      "#screen-settings-content > button.resolution-button.toggle-button",
    ]) {
      document.querySelector(selector)?.setAttribute("hidden", "");
    }
  }

  function mountControl() {
    hideNativeResolutionControls();
    const section = document.querySelector("#screen-settings-content");
    if (!section || document.querySelector("#webkdeManageScreens")) return;
    const item = document.createElement("div");
    item.className = "dev-setting-item";
    item.innerHTML = '<label for="webkdeManageScreens">Virtual screens</label><button type="button" id="webkdeManageScreens" class="resolution-button">Manage Virtual Screens…</button><label style="display:flex;align-items:flex-start;gap:.5rem;margin-top:.65rem;font-weight:normal"><input type="checkbox" id="webkdeAutoStartSetting" style="margin-top:.15rem">Automatically use the last applied settings when WebKDE opens</label><div id="webkdeScreenButtons" style="display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem"></div><small id="webkdeEffectiveResolution"></small><small>Each screen has a fixed configured resolution while multiple screens are active. All screen tabs scale their image to fit.</small>';
    item.querySelector("button").addEventListener("click", openManager);
    const autoStartSetting = item.querySelector("#webkdeAutoStartSetting");
    autoStartSetting.checked = localStorage.getItem(autoStartStorageKey) === "true";
    autoStartSetting.addEventListener("change", () => {
      localStorage.setItem(autoStartStorageKey, String(autoStartSetting.checked));
    });
    section.prepend(recoveryItem("Wayland compositor", "webkdeRestartKwin", "Restart KWin",
      "Restart KWin? Wayland applications may close, and Plasma may restart as part of recovery.", "WEBKDE_RESTART_KWIN", [3000, 6000]));
    section.prepend(recoveryItem("Desktop session", "webkdeRestartPlasma", "Restart Plasma",
      "Restart the Plasma desktop? Open applications in this session will be closed.", "WEBKDE_RESTART_PLASMA"));
    section.prepend(recoveryItem("Display recovery", "webkdeResetDisplays", "Reset Displays",
      "Reset the persisted KDE display state and restart KWin? Wayland applications may close.", "WEBKDE_RESET_DISPLAYS", [4000, 7000]));
    section.prepend(item);
    rebuildOpenButtons();
    updateEffectiveResolution();
  }

  addEventListener("message", event => {
    if (event.origin !== location.origin || !event.data?.type) return;
    const screen = Number(event.data.screen);
    if (event.data.type === "webkde:manager-ready") {
      managerWindow = event.source;
      managerWindow.postMessage({type: "webkde:manager-state", config, layout: appliedLayout}, location.origin);
      return;
    }
    if (event.source === managerWindow) {
      if (event.data.type === "webkde:manager-apply") {
        saveConfig(event.data.config);
        if (streamStarted) applyLayout(true);
        else startStreaming();
      } else if (event.data.type === "webkde:open-screen" && screen >= 2 && screen <= maxScreens) openScreen(screen);
      else if (event.data.type === "webkde:request-tab-resolution") {
        if (screen === 1) {
          const size = viewportResolution();
          managerWindow.postMessage({type: "webkde:tab-resolution", screen, requestId: event.data.requestId, ...size}, location.origin);
        } else {
          const satellite = satellites.get(screen);
          if (!satellite || satellite.window.closed)
            managerWindow.postMessage({type: "webkde:tab-resolution-unavailable", screen, requestId: event.data.requestId}, location.origin);
          else {
            resolutionRequest = event.data.requestId;
            satellite.window.postMessage({type: "webkde:request-resolution", screen, requestId: resolutionRequest}, location.origin);
          }
        }
      }
      return;
    }
    if (event.data.type === "webkde:satellite-ready") {
      if (!Number.isInteger(screen) || screen < 2 || screen > maxScreens) return;
      satellites.set(screen, {window: event.source, framePending: false});
      const requested = config.screens.find(item => item.index === screen);
      event.source.postMessage(requested ? {type: "webkde:layout", screen,
        configuredWidth: requested.width, configuredHeight: requested.height} :
        {type: "webkde:inactive", screen}, location.origin);
      const cursor = currentCursor();
      if (cursor) event.source.postMessage({type: "webkde:cursor", screen, cursor}, location.origin);
      return;
    }
    const registered = satellites.get(screen);
    if (!registered || registered.window !== event.source) return;
    if (event.data.type === "webkde:satellite-input") forwardInput(screen, event.data.input);
    else if (event.data.type === "webkde:clipboard-paste") sendClipboardText(event.data.text);
    else if (event.data.type === "webkde:set-screen-resolution") {
      const requested = config.screens.find(item => item.index === screen);
      const width = alignedWidth(Math.min(16384, Number(event.data.width) || 0));
      const height = alignedHeight(Math.min(16384, Number(event.data.height) || 0));
      if (!requested || width < 8 || height < 2) return;
      requested.width = width;
      requested.height = height;
      requested.followViewport = false;
      saveConfig(config);
      event.source.postMessage({type: "webkde:layout", screen,
        configuredWidth: width, configuredHeight: height}, location.origin);
      applyLayout(true);
    }
    else if (event.data.type === "webkde:satellite-resolution")
      managerWindow?.postMessage({type: "webkde:tab-resolution", screen, requestId: event.data.requestId,
        width: event.data.width, height: event.data.height}, location.origin);
    else if (event.data.type === "webkde:satellite-closed") satellites.delete(screen);
  });

  addEventListener("message", event => {
    if (event.source === window && event.origin === location.origin && event.data?.type === "clipboardContentUpdate" && typeof event.data.text === "string")
      notifySatellites("webkde:clipboard", {text: event.data.text});
  });
  new MutationObserver(() => { mountStartupChooser(); hideNativeResolutionControls(); mountControl(); updateControlCrop(); })
    .observe(document.documentElement, {childList: true, subtree: true});
  addEventListener("resize", updateControlCrop);
  addEventListener("storage", event => {
    if (event.key === autoStartStorageKey) {
      const checkbox = document.getElementById("webkdeAutoStart");
      if (checkbox) checkbox.checked = event.newValue === "true";
      const setting = document.getElementById("webkdeAutoStartSetting");
      if (setting) setting.checked = event.newValue === "true";
    } else if (event.key === configStorageKey) {
      config = loadConfig();
      rebuildOpenButtons();
      applyLayout(true);
    }
  });
  addEventListener("beforeunload", () => notifySatellites("webkde:control-closed"));
  addEventListener("load", () => setTimeout(() => applyLayout(true), 1500));
  mountStartupChooser();
  requestAnimationFrame(maintainPerTabSurface);
})();

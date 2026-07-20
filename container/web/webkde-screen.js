(() => {
  const screen = Number(new URLSearchParams(location.search).get("screen"));
  const canvas = document.getElementById("screen");
  const status = document.getElementById("status");
  const pointer = document.getElementById("pointer");
  const context = canvas.getContext("2d", {alpha: false, desynchronized: true});
  let view = null;
  let latestFrame = null;
  let pendingClipboard = null;
  let keyQueue = Promise.resolve();
  let pointerHotspotX = 0;
  let pointerHotspotY = 0;
  let pointerRawHotspotX = 0;
  let pointerRawHotspotY = 0;
  let pointerAvailable = false;

  document.title = Number.isInteger(screen) ? `WebKDE Screen ${screen}` : "WebKDE Screen";

  function control() {
    try {
      return opener && !opener.closed && opener.location.origin === location.origin ? opener : null;
    } catch (_) {
      return null;
    }
  }

  function post(type, extra = {}) {
    control()?.postMessage({type, screen, ...extra}, location.origin);
  }

  function setStatus(message) {
    status.textContent = message;
    status.classList.toggle("hidden", !message);
  }

  async function syncFullscreenKeyboardLock() {
    const keyboard = navigator.keyboard;
    if (!keyboard) return;
    if (!document.fullscreenElement) {
      keyboard.unlock?.();
      return;
    }
    if (typeof keyboard.lock !== "function") return;
    try {
      // Match Selkies' control window. With Escape captured, Chromium uses its
      // standard "press and hold Escape" gesture to leave fullscreen.
      await keyboard.lock([
        "AltLeft", "AltRight", "Tab", "Escape",
        "MetaLeft", "MetaRight", "ContextMenu",
      ]);
    } catch (_) {
      // Browsers without Keyboard Lock retain their native fullscreen escape.
    }
  }

  function resizeCanvas() {
    const ratio = devicePixelRatio || 1;
    const width = Math.max(2, Math.round(innerWidth * ratio));
    const height = Math.max(2, Math.round(innerHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function updatePointerSize() {
    if (!pointer.naturalWidth || !pointer.naturalHeight) return;
    const scale = Math.max(1, Number(pointer.dataset.desktopScale) || 1);
    pointerHotspotX = pointerRawHotspotX / scale;
    pointerHotspotY = pointerRawHotspotY / scale;
    pointer.style.width = `${pointer.naturalWidth / scale}px`;
    pointer.style.height = `${pointer.naturalHeight / scale}px`;
  }

  function draw() {
    resizeCanvas();
    const parent = control();
    if (!latestFrame) {
      view = null;
      setStatus(parent ? `Waiting for Screen ${screen} frames from the control window…` : "The WebKDE control tab must remain open.");
      requestAnimationFrame(draw);
      return;
    }
    const scale = Math.min(canvas.width / latestFrame.width, canvas.height / latestFrame.height);
    const width = latestFrame.width * scale;
    const height = latestFrame.height * scale;
    const x = (canvas.width - width) / 2;
    const y = (canvas.height - height) / 2;
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    try {
      context.drawImage(latestFrame, x, y, width, height);
      view = {x: x / (devicePixelRatio || 1), y: y / (devicePixelRatio || 1), width: width / (devicePixelRatio || 1), height: height / (devicePixelRatio || 1)};
      updatePointerSize();
      setStatus("");
    } catch (_) {
      view = null;
      setStatus("Waiting for the decoded desktop frame…");
    }
    requestAnimationFrame(draw);
  }

  function point(event, clamp = false) {
    if (!view) return null;
    let x = (event.clientX - view.x) / view.width;
    let y = (event.clientY - view.y) / view.height;
    if (clamp) {
      x = Math.max(0, Math.min(1, x));
      y = Math.max(0, Math.min(1, y));
    }
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return {x, y};
  }

  function movePointer(event) {
    pointer.style.transform = `translate(${event.clientX - pointerHotspotX}px, ${event.clientY - pointerHotspotY}px)`;
  }

  addEventListener("mousemove", event => {
    movePointer(event);
    pointer.style.display = pointerAvailable && event.target === canvas ? "block" : "none";
  });
  addEventListener("mouseleave", () => { pointer.style.display = "none"; });

  for (const type of ["mousedown", "mousemove", "mouseup"]) {
    addEventListener(type, event => {
      if (event.target.closest?.("button")) return;
      const position = point(event, type === "mouseup");
      if (!position) return;
      event.preventDefault();
      canvas.focus({preventScroll: true});
      post("webkde:satellite-input", {input: {
        kind: "mouse", type, ...position, button: event.button, buttons: event.buttons,
        ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
      }});
    });
  }

  for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
    addEventListener(type, event => {
      const touch = event.touches[0] || event.changedTouches[0];
      if (!touch || !view) return;
      event.preventDefault();
      const position = point(touch, type === "touchend" || type === "touchcancel");
      if (!position) return;
      const mouseType = type === "touchstart" ? "mousedown" :
        (type === "touchmove" ? "mousemove" : "mouseup");
      post("webkde:satellite-input", {input: {
        kind: "mouse", type: mouseType, ...position, button: 0,
        buttons: mouseType === "mouseup" ? 0 : 1,
        ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
      }});
    });
  }

  addEventListener("wheel", event => {
    const position = point(event);
    if (!position) return;
    event.preventDefault();
    post("webkde:satellite-input", {input: {
      kind: "wheel", ...position,
      deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode,
      ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
    }});
  }, {passive: false});

  for (const type of ["keydown", "keyup"]) {
    addEventListener(type, event => {
      if (event.target.closest?.("button")) return;
      event.preventDefault();
      const input = {
        kind: "key", type, key: event.key, code: event.code, location: event.location, repeat: event.repeat,
        ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
      };
      const clipboard = type === "keydown" && (event.ctrlKey || event.metaKey) &&
        event.code === "KeyV" && navigator.clipboard ? navigator.clipboard.readText().catch(() => null) : null;
      keyQueue = keyQueue.then(async () => {
        if (clipboard) {
          const text = await clipboard;
          if (text !== null) post("webkde:clipboard-paste", {text});
        }
        post("webkde:satellite-input", {input});
      });
    });
  }

  addEventListener("blur", () => post("webkde:satellite-input", {
    input: {kind: "blur", preserveButtons: false},
  }));
  addEventListener("contextmenu", event => event.preventDefault());
  addEventListener("beforeunload", () => post("webkde:satellite-closed"));
  addEventListener("message", event => {
    if (event.origin !== location.origin || event.source !== control()) return;
    if (event.data?.type === "webkde:control-closed") setStatus("The WebKDE control tab was closed.");
    if (event.data?.type === "webkde:inactive") {
      latestFrame?.close();
      latestFrame = null;
      view = null;
      setStatus(`Screen ${screen} is not active in the current WebKDE layout.`);
    }
    if (event.data?.type === "webkde:frame" && event.data.bitmap) {
      latestFrame?.close();
      latestFrame = event.data.bitmap;
    }
    if (event.data?.type === "webkde:cursor") {
      const cursor = event.data.cursor;
      if (cursor?.data) {
        pointerRawHotspotX = Math.max(0, Number(cursor.hotspotX) || 0);
        pointerRawHotspotY = Math.max(0, Number(cursor.hotspotY) || 0);
        pointer.dataset.desktopScale = String(Math.max(1, Number(cursor.desktopScale) || 1));
        pointer.onload = () => {
          updatePointerSize();
          pointerAvailable = true;
        };
        pointer.src = `data:image/png;base64,${cursor.data}`;
        canvas.style.setProperty("cursor", "none", "important");
      } else {
        pointerAvailable = false;
        pointer.style.display = "none";
        canvas.style.removeProperty("cursor");
      }
    }
    if (event.data?.type === "webkde:clipboard" && typeof event.data.text === "string") {
      pendingClipboard = event.data.text;
      if (document.hasFocus()) navigator.clipboard?.writeText(pendingClipboard).then(() => { pendingClipboard = null; }).catch(() => {});
    }
  });
  addEventListener("focus", () => {
    if (pendingClipboard) navigator.clipboard?.writeText(pendingClipboard).then(() => { pendingClipboard = null; }).catch(() => {});
  });

  document.addEventListener("fullscreenchange", syncFullscreenKeyboardLock);
  document.getElementById("fullscreen").addEventListener("click", async () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else {
      await document.documentElement.requestFullscreen();
      await syncFullscreenKeyboardLock();
    }
  });

  if (!Number.isInteger(screen) || screen < 2) setStatus("Invalid WebKDE screen number.");
  else post("webkde:satellite-ready");
  requestAnimationFrame(draw);
})();

(() => {
  const params = new URLSearchParams(location.search);
  const maxScreens = Math.max(1, Math.min(8, Number(params.get("max")) || 8));
  const storageKey = "webkde.virtualScreensV3";
  const profileStorageKey = "webkde.virtualScreenProfilesV1";
  const desktop = document.getElementById("desktop");
  const indicator = document.getElementById("dropIndicator");
  const dragCoordinates = document.getElementById("dragCoordinates");
  const settings = document.getElementById("screenSettings");
  const message = document.getElementById("message");
  const countOutput = document.getElementById("screenCount");
  const decreaseScreens = document.getElementById("decreaseScreens");
  const increaseScreens = document.getElementById("increaseScreens");
  const profileSelect = document.getElementById("profileSelect");
  const profileName = document.getElementById("profileName");
  const loadProfileButton = document.getElementById("loadProfile");
  const deleteProfileButton = document.getElementById("deleteProfile");
  let applied = loadConfig();
  let draft = structuredClone(applied);
  let appliedLayout = null;
  let dragState = null;
  let desktopView = null;
  let requestCounter = 0;
  let profiles = loadProfiles();
  const resolutionPresets = [
    [1920, 1080], [1280, 720], [1366, 768], [1920, 1200], [2560, 1440],
    [3840, 2160], [1024, 768], [800, 600], [640, 480], [320, 240],
  ];

  function defaultConfig() {
    const ratio = devicePixelRatio || 1;
    return {
      version: 3,
      screens: [{index: 1, width: Math.max(8, Math.round(1920)), height: Math.max(2, Math.round(1080)), followViewport: true}],
      anchors: [{index: 1}],
    };
  }

  function loadConfig() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (value?.version === 3 && Array.isArray(value.screens) && value.screens.length) return normalize(value);
    } catch (_) {}
    return defaultConfig();
  }

  function loadProfiles() {
    try {
      const value = JSON.parse(localStorage.getItem(profileStorageKey) || "null");
      if (value?.version !== 1 || !Array.isArray(value.profiles)) return [];
      return value.profiles.filter(profile => typeof profile?.name === "string" && profile.name.trim() &&
        profile.config?.version === 3 && Array.isArray(profile.config.screens) && profile.config.screens.length)
        .map(profile => ({name: profile.name.trim().slice(0, 64), config: normalize(profile.config)}))
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch (_) {
      return [];
    }
  }

  function saveProfiles() {
    localStorage.setItem(profileStorageKey, JSON.stringify({version: 1, profiles}));
  }

  function renderProfiles(selectedName = profileSelect.value) {
    profileSelect.replaceChildren(new Option("Saved profiles…", ""));
    for (const profile of profiles) profileSelect.add(new Option(profile.name, profile.name));
    profileSelect.value = profiles.some(profile => profile.name === selectedName) ? selectedName : "";
    const hasSelection = Boolean(profileSelect.value);
    loadProfileButton.disabled = !hasSelection;
    deleteProfileButton.disabled = !hasSelection;
  }

  function normalize(config) {
    const screens = config.screens.slice(0, maxScreens).map((screen, offset) => ({
      index: offset + 1,
      width: Math.max(8, Math.min(16384, Math.round(Number(screen.width) || 1920))),
      height: Math.max(2, Math.min(16384, Math.round(Number(screen.height) || 1080))),
      followViewport: offset === 0 && screen.followViewport === true,
    }));
    const known = new Set(screens.map(screen => screen.index));
    const anchors = [{index: 1}];
    for (let index = 2; index <= screens.length; index++) {
      const anchor = config.anchors?.find(item => Number(item.index) === index);
      anchors.push(anchor && known.has(Number(anchor.parent)) ? {
        index, parent: Number(anchor.parent),
        side: ["left", "right", "top", "bottom"].includes(anchor.side) ? anchor.side : "right",
        align: ["start", "center", "end"].includes(anchor.align) ? anchor.align : "center",
        ...(Number.isInteger(anchor.offset) ? {offset: anchor.offset} : {}),
      } : {index, parent: index - 1, side: "right", align: "center"});
    }
    return {version: 3, screens, anchors};
  }

  function screen(index, config = draft) {
    return config.screens.find(item => item.index === index);
  }

  function anchor(index, config = draft) {
    return config.anchors.find(item => item.index === index);
  }

  function aligned(value, alignment) {
    return Math.max(alignment, Math.floor(value / alignment) * alignment);
  }

  function placeRelative(parent, child, relation) {
    let x = parent.x;
    let y = parent.y;
    if (relation.side === "left") x = parent.x - child.width;
    if (relation.side === "right") x = parent.x + parent.width;
    if (relation.side === "top") y = parent.y - child.height;
    if (relation.side === "bottom") y = parent.y + parent.height;
    if (relation.side === "left" || relation.side === "right") {
      if (Number.isInteger(relation.offset)) y += relation.offset;
      else if (relation.align === "center") y += (parent.height - child.height) / 2;
      else if (relation.align === "end") y += parent.height - child.height;
    } else {
      if (Number.isInteger(relation.offset)) x += relation.offset;
      else if (relation.align === "center") x += (parent.width - child.width) / 2;
      else if (relation.align === "end") x += parent.width - child.width;
    }
    return {...child, x: Math.round(x), y: Math.round(y)};
  }

  function resolve(config = draft, dimensions = null) {
    const byIndex = new Map(config.screens.map(item => {
      const size = dimensions?.find(rect => rect.index === item.index) || item;
      return [item.index, {index: item.index, width: size.width, height: size.height}];
    }));
    const placed = new Map([[1, {...byIndex.get(1), x: 0, y: 0}]]);
    const pending = new Set(config.screens.slice(1).map(item => item.index));
    while (pending.size) {
      let progress = false;
      for (const index of [...pending]) {
        const relation = anchor(index, config);
        const parent = placed.get(relation?.parent);
        if (!parent) continue;
        placed.set(index, placeRelative(parent, byIndex.get(index), relation));
        pending.delete(index);
        progress = true;
      }
      if (!progress) return null;
    }
    const rects = [...placed.values()].sort((left, right) => left.index - right.index);
    return rects;
  }

  function overlaps(left, right) {
    return left.x < right.x + right.width && left.x + left.width > right.x &&
      left.y < right.y + right.height && left.y + left.height > right.y;
  }

  function validate(config = draft) {
    if (!config.screens.length || config.screens.length > maxScreens) return "Invalid screen count.";
    if (config.screens.some(item => !Number.isInteger(item.width) || !Number.isInteger(item.height) ||
        item.width < 8 || item.width > 16384 || item.height < 2 || item.height > 16384))
      return "Every resolution must be between 8×2 and 16384×16384.";
    const rects = resolve(config);
    if (!rects) return "The screen attachments must form one tree rooted at Screen 1.";
    for (let left = 0; left < rects.length; left++) {
      for (let right = left + 1; right < rects.length; right++) {
        if (overlaps(rects[left], rects[right]))
          return `Screen ${rects[left].index} overlaps Screen ${rects[right].index}. Move one of them.`;
      }
    }
    return "";
  }

  function descendants(index) {
    const found = new Set([index]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const relation of draft.anchors) {
        if (found.has(relation.parent) && !found.has(relation.index)) {
          found.add(relation.index);
          changed = true;
        }
      }
    }
    return found;
  }

  function movingScreens(index) {
    // Screen 1 is the attachment root. Drag it alone and reverse the chosen
    // relationship on drop so the persisted tree can remain rooted at it.
    return index === 1 ? new Set([1]) : descendants(index);
  }

  function snapAxis(position, size, axis, rects, excluded, low, high, threshold) {
    const targets = [];
    for (const rect of rects) {
      if (excluded.has(rect.index)) continue;
      const start = axis === "x" ? rect.x : rect.y;
      const extent = axis === "x" ? rect.width : rect.height;
      targets.push(start, start + extent - size);
    }
    const valid = targets.filter(value => value >= low && value <= high)
      .sort((left, right) => Math.abs(left - position) - Math.abs(right - position));
    const target = valid[0];
    return Number.isFinite(target) && Math.abs(target - position) <= threshold ?
      {value: target, snapped: true} : {value: position, snapped: false};
  }

  function attachmentCandidates(index, proposedX, proposedY, rects, ignoreSnapping = false) {
    const child = rects.find(rect => rect.index === index);
    const excluded = movingScreens(index);
    const candidates = [];
    const minimumOverlap = 1;
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const threshold = Math.max(1, 14 / Math.max(.0001, desktopView?.scale || 1));
    for (const parent of rects) {
      if (excluded.has(parent.index)) continue;
      const lowY = parent.y - child.height + minimumOverlap;
      const highY = parent.y + parent.height - minimumOverlap;
      const rawY = clamp(Math.round(proposedY), lowY, highY);
      const vertical = ignoreSnapping ? {value: rawY, snapped: false} :
        snapAxis(rawY, child.height, "y", rects, excluded, lowY, highY, threshold);
      let offset = vertical.value - parent.y;
      for (const side of ["left", "right"]) {
        const x = side === "left" ? parent.x - child.width : parent.x + parent.width;
        const y = vertical.value;
        candidates.push({parent: parent.index, side, offset, x, y, snapped: vertical.snapped,
          distance: Math.hypot(proposedX - x, proposedY - y)});
      }
      const lowX = parent.x - child.width + minimumOverlap;
      const highX = parent.x + parent.width - minimumOverlap;
      const rawX = clamp(Math.round(proposedX), lowX, highX);
      const horizontal = ignoreSnapping ? {value: rawX, snapped: false} :
        snapAxis(rawX, child.width, "x", rects, excluded, lowX, highX, threshold);
      offset = horizontal.value - parent.x;
      for (const side of ["top", "bottom"]) {
        const x = horizontal.value;
        const y = side === "top" ? parent.y - child.height : parent.y + parent.height;
        candidates.push({parent: parent.index, side, offset, x, y, snapped: horizontal.snapped,
          distance: Math.hypot(proposedX - x, proposedY - y)});
      }
    }
    return candidates.sort((left, right) => left.distance - right.distance || left.parent - right.parent || left.side.localeCompare(right.side));
  }

  function showAttachment(candidate) {
    const target = desktop.querySelector(`.screen[data-index="${candidate.parent}"]`);
    if (!target) return;
    indicator.style.display = "block";
    indicator.style.left = `${target.offsetLeft + (candidate.side === "right" ? target.offsetWidth - 7 : 0)}px`;
    indicator.style.top = `${target.offsetTop + (candidate.side === "bottom" ? target.offsetHeight - 7 : 0)}px`;
    indicator.style.width = `${candidate.side === "left" || candidate.side === "right" ? 7 : target.offsetWidth}px`;
    indicator.style.height = `${candidate.side === "top" || candidate.side === "bottom" ? 7 : target.offsetHeight}px`;
  }

  function beginDrag(event, index) {
    if (event.button !== 0 || !desktopView || draft.screens.length < 2) return;
    event.preventDefault();
    const moving = movingScreens(index);
    dragState = {
      index,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rects: desktopView.rects,
      scale: desktopView.scale,
      moving,
      candidate: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    for (const movingIndex of moving)
      desktop.querySelector(`.screen[data-index="${movingIndex}"]`)?.classList.add("dragging");
  }

  function moveDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    const original = dragState.rects.find(rect => rect.index === dragState.index);
    const proposedX = original.x + dx / dragState.scale;
    const proposedY = original.y + dy / dragState.scale;
    dragState.candidate = attachmentCandidates(dragState.index, proposedX, proposedY,
      dragState.rects, event.ctrlKey)[0] || null;
    let visualDx = dx;
    let visualDy = dy;
    if (dragState.candidate?.snapped && !event.ctrlKey) {
      if (dragState.candidate.side === "left" || dragState.candidate.side === "right")
        visualDy = (dragState.candidate.y - original.y) * dragState.scale;
      else visualDx = (dragState.candidate.x - original.x) * dragState.scale;
    }
    for (const index of dragState.moving) {
      const tile = desktop.querySelector(`.screen[data-index="${index}"]`);
      if (!tile) continue;
      tile.style.transform = `translate(${visualDx}px, ${visualDy}px)`;
    }
    if (dragState.candidate) {
      showAttachment(dragState.candidate);
      dragCoordinates.style.display = "block";
      dragCoordinates.classList.toggle("snapped", dragState.candidate.snapped && !event.ctrlKey);
      dragCoordinates.textContent = `Screen ${dragState.index} · x ${dragState.candidate.x}, y ${dragState.candidate.y} · ${event.ctrlKey ? "snapping off" : dragState.candidate.snapped ? "edge snapped" : "hold Ctrl to ignore snapping"}`;
    }
  }

  function endDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const state = dragState;
    dragState = null;
    indicator.style.display = "none";
    dragCoordinates.style.display = "none";
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    const original = state.rects.find(rect => rect.index === state.index);
    const candidates = attachmentCandidates(state.index, original.x + dx / state.scale,
      original.y + dy / state.scale, state.rects, event.ctrlKey);
    let chosen = null;
    if (state.index === 1) {
      const opposite = {left: "right", right: "left", top: "bottom", bottom: "top"};
      for (const candidate of candidates) {
        const relation = anchor(candidate.parent);
        const previous = {...relation};
        Object.assign(relation, {parent: 1, side: opposite[candidate.side], align: "start", offset: -candidate.offset});
        if (!validate()) { chosen = candidate; break; }
        for (const key of Object.keys(relation)) delete relation[key];
        Object.assign(relation, previous);
      }
    } else {
      const relation = anchor(state.index);
      const previous = {...relation};
      for (const candidate of candidates) {
        Object.assign(relation, {parent: candidate.parent, side: candidate.side, align: "start", offset: candidate.offset});
        if (!validate()) { chosen = candidate; break; }
      }
      if (!chosen) {
        for (const key of Object.keys(relation)) delete relation[key];
        Object.assign(relation, previous);
      }
    }
    if (!chosen) {
      setMessage("That position would overlap another screen. The previous arrangement was restored.", "error");
    } else {
      setMessage(`Screen ${state.index} moved ${chosen.side} of Screen ${chosen.parent}.`);
    }
    render();
  }

  function cancelDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    dragState = null;
    indicator.style.display = "none";
    dragCoordinates.style.display = "none";
    renderDesktop();
  }

  function setMessage(text, type = "") {
    message.textContent = text;
    message.className = type;
  }

  function renderDesktop() {
    for (const node of [...desktop.querySelectorAll(".screen")]) node.remove();
    const rects = resolve(draft);
    if (!rects) return;
    const minX = Math.min(...rects.map(rect => rect.x));
    const minY = Math.min(...rects.map(rect => rect.y));
    const maxX = Math.max(...rects.map(rect => rect.x + rect.width));
    const maxY = Math.max(...rects.map(rect => rect.y + rect.height));
    const boundsWidth = maxX - minX;
    const boundsHeight = maxY - minY;
    const availableWidth = Math.max(1, desktop.clientWidth - 40);
    const availableHeight = Math.max(1, desktop.clientHeight - 40);
    const scale = Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight);
    const offsetX = (desktop.clientWidth - boundsWidth * scale) / 2 - minX * scale;
    const offsetY = (desktop.clientHeight - boundsHeight * scale) / 2 - minY * scale;
    desktopView = {rects, scale, offsetX, offsetY};
    for (const rect of rects) {
      const tile = document.createElement("div");
      tile.className = "screen";
      tile.dataset.index = String(rect.index);
      tile.style.left = `${offsetX + rect.x * scale}px`;
      tile.style.top = `${offsetY + rect.y * scale}px`;
      tile.style.width = `${Math.max(64, rect.width * scale)}px`;
      tile.style.height = `${Math.max(48, rect.height * scale)}px`;
      tile.innerHTML = `<strong>Screen ${rect.index}${rect.index === 1 ? " ★" : ""}</strong><small>${rect.width}×${rect.height}</small>`;
      tile.addEventListener("pointerdown", event => beginDrag(event, rect.index));
      tile.addEventListener("pointermove", moveDrag);
      tile.addEventListener("pointerup", endDrag);
      tile.addEventListener("pointercancel", cancelDrag);
      desktop.appendChild(tile);
    }
  }

  function updateResolution(index, width, height) {
    const item = screen(index);
    item.width = aligned(Math.max(8, Math.min(16384, Math.round(width))), 8);
    item.height = aligned(Math.max(2, Math.min(16384, Math.round(height))), 2);
    item.followViewport = false;
    render();
  }

  function renderSettings() {
    settings.replaceChildren();
    for (const item of draft.screens) {
      const card = document.createElement("article");
      card.className = "card";
      card.innerHTML = `<h2>Screen ${item.index}${item.index === 1 ? " — primary" : ""}</h2>
        <label class="preset-field">Resolution preset
          <select data-resolution-preset aria-label="Screen ${item.index} resolution preset">
            <option value="custom">Custom</option>
            ${resolutionPresets.map(([width, height]) => `<option value="${width}x${height}"${item.width === width && item.height === height ? " selected" : ""}>${width} × ${height}</option>`).join("")}
          </select>
        </label>
        <div class="resolution"><input type="number" min="8" max="16384" step="8" aria-label="Screen ${item.index} width" value="${item.width}"><span>×</span><input type="number" min="2" max="16384" step="2" aria-label="Screen ${item.index} height" value="${item.height}"></div>
        <div class="card-actions"><button type="button" data-current>Set to current tab resolution</button>${item.index > 1 ? `<button type="button" data-open>Open Screen ${item.index}</button>` : ""}</div>`;
      const inputs = card.querySelectorAll("input");
      card.querySelector("[data-resolution-preset]").addEventListener("change", event => {
        if (event.target.value === "custom") return;
        const [width, height] = event.target.value.split("x").map(Number);
        updateResolution(item.index, width, height);
      });
      for (const input of inputs) input.addEventListener("change", () =>
        updateResolution(item.index, Number(inputs[0].value), Number(inputs[1].value)));
      card.querySelector("[data-current]").addEventListener("click", () => {
        const requestId = ++requestCounter;
        setMessage(`Requesting Screen ${item.index} tab resolution…`);
        window.opener?.postMessage({type: "webkde:request-tab-resolution", screen: item.index, requestId}, location.origin);
      });
      card.querySelector("[data-open]")?.addEventListener("click", () => {
        const width = Math.max(640, Math.round(innerWidth * .8));
        const height = Math.max(480, Math.round(innerHeight * .8));
        const satellite = window.open(
          `./webkde-screen.html?screen=${item.index}`,
          `webkde-screen-${item.index}`,
          `popup=yes,width=${width},height=${height},resizable=yes`,
        );
        if (!satellite) setMessage("The browser blocked the screen tab. Allow pop-ups for this WebKDE site.", "error");
      });
      settings.appendChild(card);
    }
  }

  function setCount(count) {
    count = Math.max(1, Math.min(maxScreens, count));
    while (draft.screens.length < count) {
      const index = draft.screens.length + 1;
      const basis = draft.screens[0];
      draft.screens.push({index, width: basis.width, height: basis.height, followViewport: false});
      draft.anchors.push({index, parent: index - 1, side: "right", align: "center"});
    }
    draft.screens.length = count;
    draft.anchors = draft.anchors.filter(item => item.index <= count && (!item.parent || item.parent <= count));
    for (let index = 2; index <= count; index++) {
      if (!anchor(index)) draft.anchors.push({index, parent: index - 1, side: "right", align: "center"});
    }
    render();
  }

  function applyPreset(preset) {
    draft.anchors = [{index: 1}];
    for (let index = 2; index <= draft.screens.length; index++) {
      if (preset === "column") draft.anchors.push({index, parent: index - 1, side: "bottom", align: "center"});
      else if (preset === "compact") {
        const columns = Math.ceil(Math.sqrt(draft.screens.length));
        draft.anchors.push(index <= columns ?
          {index, parent: index - 1, side: "right", align: "start"} :
          {index, parent: index - columns, side: "bottom", align: "start"});
      } else draft.anchors.push({index, parent: index - 1, side: "right", align: "center"});
    }
    const error = validate();
    setMessage(error || `${preset[0].toUpperCase()}${preset.slice(1)} arrangement selected.`, error ? "error" : "");
    render();
  }

  function render() {
    countOutput.value = String(draft.screens.length);
    countOutput.textContent = String(draft.screens.length);
    decreaseScreens.disabled = draft.screens.length <= 1;
    increaseScreens.disabled = draft.screens.length >= maxScreens;
    renderDesktop();
    renderSettings();
    const error = validate();
    document.getElementById("apply").disabled = Boolean(error);
    if (error) setMessage(error, "error");
  }

  decreaseScreens.addEventListener("click", () => setCount(draft.screens.length - 1));
  increaseScreens.addEventListener("click", () => setCount(draft.screens.length + 1));
  profileSelect.addEventListener("change", () => {
    profileName.value = profileSelect.value;
    renderProfiles(profileSelect.value);
  });
  document.getElementById("profileForm").addEventListener("submit", event => {
    event.preventDefault();
    const name = profileName.value.trim().slice(0, 64);
    if (!name) return setMessage("Enter a profile name before saving.", "error");
    const existing = profiles.find(profile => profile.name === name);
    if (existing) existing.config = normalize(draft);
    else profiles.push({name, config: normalize(draft)});
    profiles.sort((left, right) => left.name.localeCompare(right.name));
    saveProfiles();
    renderProfiles(name);
    setMessage(`${existing ? "Updated" : "Saved"} profile “${name}”.`, "success");
  });
  loadProfileButton.addEventListener("click", () => {
    const profile = profiles.find(item => item.name === profileSelect.value);
    if (!profile) return;
    draft = structuredClone(normalize(profile.config));
    profileName.value = profile.name;
    render();
    setMessage(`Loaded profile “${profile.name}”. Select Apply to activate it.`, "success");
  });
  deleteProfileButton.addEventListener("click", () => {
    const name = profileSelect.value;
    if (!name || !confirm(`Delete screen profile “${name}”?`)) return;
    profiles = profiles.filter(profile => profile.name !== name);
    saveProfiles();
    profileName.value = "";
    renderProfiles();
    setMessage(`Deleted profile “${name}”.`);
  });
  for (const button of document.querySelectorAll("[data-preset]"))
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  document.getElementById("reset").addEventListener("click", () => {
    draft = structuredClone(applied);
    setMessage("Draft reset.");
    render();
  });
  document.getElementById("apply").addEventListener("click", () => {
    const error = validate();
    if (error) return setMessage(error, "error");
    applied = normalize(draft);
    draft = structuredClone(applied);
    localStorage.setItem(storageKey, JSON.stringify(applied));
    window.opener?.postMessage({type: "webkde:manager-apply", config: applied}, location.origin);
    setMessage("Applying virtual screen layout…", "success");
  });
  addEventListener("message", event => {
    if (event.origin !== location.origin || event.source !== window.opener) return;
    if (event.data?.type === "webkde:manager-state") {
      if (event.data.config) applied = normalize(event.data.config);
      draft = structuredClone(applied);
      appliedLayout = event.data.layout || null;
      render();
    }
    if (event.data?.type === "webkde:tab-resolution") {
      updateResolution(Number(event.data.screen), Number(event.data.width), Number(event.data.height));
      setMessage(`Screen ${event.data.screen} set to ${screen(Number(event.data.screen)).width}×${screen(Number(event.data.screen)).height}. Apply to activate it.`, "success");
    }
    if (event.data?.type === "webkde:tab-resolution-unavailable")
      setMessage(`Screen ${event.data.screen} is not open. Open its tab before requesting its resolution.`, "error");
    if (event.data?.type === "webkde:layout-applied") {
      appliedLayout = event.data.layout;
      const reduced = appliedLayout?.scale < .999999;
      setMessage(`Applied ${appliedLayout?.atlasWidth}×${appliedLayout?.atlasHeight} stream atlas${reduced ? ` at ${Math.round(appliedLayout.scale * 100)}% of the requested resolutions` : ""}.`, "success");
    }
  });
  addEventListener("resize", renderDesktop);
  addEventListener("storage", event => {
    if (event.key !== profileStorageKey) return;
    profiles = loadProfiles();
    renderProfiles();
  });
  window.opener?.postMessage({type: "webkde:manager-ready"}, location.origin);
  renderProfiles();
  render();
})();

(() => {
  const storageKey = "webkde.virtualScreens";
  const maxScreens = Number(document.currentScript?.dataset.maxScreens || 8);
  let dataSocket;
  const nativeSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function(data) {
    let scalingDpi;
    if (typeof data === "string" && data.startsWith("SETTINGS,")) {
      dataSocket = this;
      try {
        scalingDpi = Number(JSON.parse(data.slice("SETTINGS,".length)).scaling_dpi);
      } catch (error) {
        console.warn("Could not read Selkies scaling DPI", error);
      }
    }
    const result = nativeSend.call(this, data);
    if (scalingDpi >= 96 && scalingDpi <= 288 && scalingDpi % 24 === 0) {
      setTimeout(() => {
        if (this.readyState !== WebSocket.OPEN) return;
        nativeSend.call(this, `WEBKDE_SCALE,${scalingDpi}`);
        setTimeout(() => apply(true), 250);
      }, 0);
    }
    return result;
  };

  let timer;
  function apply(force = false) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const count = Number(localStorage.getItem(storageKey) || 1);
      const orientation = innerWidth >= innerHeight ? "horizontal" : "vertical";
      const message = `WEBKDE_LAYOUT,${count},${orientation},${innerWidth},${innerHeight}`;
      if (dataSocket?.readyState === WebSocket.OPEN) nativeSend.call(dataSocket, message);
      else setTimeout(() => apply(true), 500);
    }, force ? 0 : 350);
  }

  function mountControl() {
    const section = document.querySelector("#screen-settings-content");
    if (!section || document.querySelector("#webkdeVirtualScreens")) return;
    const screenItem = document.createElement("div");
    screenItem.className = "dev-setting-item";
    screenItem.innerHTML = '<label for="webkdeVirtualScreens">Virtual screens</label><select id="webkdeVirtualScreens"></select>';
    const select = screenItem.querySelector("select");
    for (let count = 1; count <= maxScreens; count++) {
      const option = document.createElement("option");
      option.value = option.textContent = String(count);
      select.appendChild(option);
    }
    select.value = localStorage.getItem(storageKey) || "1";
    select.addEventListener("change", () => {
      localStorage.setItem(storageKey, select.value);
      apply(true);
    });

    const restartItem = document.createElement("div");
    restartItem.className = "dev-setting-item";
    restartItem.innerHTML = '<label for="webkdeRestartPlasma">Desktop session</label><button type="button" id="webkdeRestartPlasma" class="resolution-button">Restart Plasma</button>';
    const restartButton = restartItem.querySelector("button");
    restartButton.addEventListener("click", () => {
      if (!confirm("Restart the Plasma desktop? Open applications in this session will be closed.")) return;
      if (dataSocket?.readyState !== WebSocket.OPEN) {
        alert("The WebKDE connection is not ready. Try again in a moment.");
        return;
      }
      restartButton.disabled = true;
      restartButton.textContent = "Restarting Plasma…";
      nativeSend.call(dataSocket, "WEBKDE_RESTART_PLASMA");
      setTimeout(() => {
        restartButton.disabled = false;
        restartButton.textContent = "Restart Plasma";
      }, 10000);
    });

    const kwinItem = document.createElement("div");
    kwinItem.className = "dev-setting-item";
    kwinItem.innerHTML = '<label for="webkdeRestartKwin">Wayland compositor</label><button type="button" id="webkdeRestartKwin" class="resolution-button">Restart KWin</button>';
    const kwinButton = kwinItem.querySelector("button");
    kwinButton.addEventListener("click", () => {
      if (!confirm("Restart KWin? Wayland applications may close, and Plasma may restart as part of recovery.")) return;
      if (dataSocket?.readyState !== WebSocket.OPEN) {
        alert("The WebKDE connection is not ready. Try again in a moment.");
        return;
      }
      kwinButton.disabled = true;
      kwinButton.textContent = "Restarting KWin…";
      nativeSend.call(dataSocket, "WEBKDE_RESTART_KWIN");
      setTimeout(() => apply(true), 3000);
      setTimeout(() => apply(true), 6000);
      setTimeout(() => {
        kwinButton.disabled = false;
        kwinButton.textContent = "Restart KWin";
        apply(true);
      }, 10000);
    });

    section.prepend(kwinItem);
    section.prepend(restartItem);
    section.prepend(screenItem);
  }

  new MutationObserver(mountControl).observe(document.documentElement, {childList: true, subtree: true});
  addEventListener("resize", () => apply(false));
  addEventListener("load", () => setTimeout(() => apply(true), 1500));
})();

(() => {
  const storageKey = "webkde.virtualScreens";
  const maxScreens = Number(document.currentScript?.dataset.maxScreens || 8);
  let dataSocket;
  const nativeSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function(data) {
    if (typeof data === "string" && data.startsWith("SETTINGS,")) dataSocket = this;
    return nativeSend.call(this, data);
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
    const item = document.createElement("div");
    item.className = "dev-setting-item";
    item.innerHTML = '<label for="webkdeVirtualScreens">Virtual screens</label><select id="webkdeVirtualScreens"></select>';
    const select = item.querySelector("select");
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
    section.prepend(item);
  }

  new MutationObserver(mountControl).observe(document.documentElement, {childList: true, subtree: true});
  addEventListener("resize", () => apply(false));
  addEventListener("load", () => setTimeout(() => apply(true), 1500));
})();

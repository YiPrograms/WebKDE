(() => {
  const storageKey = "webkde.virtualScreens";
  const panel = document.createElement("label");
  panel.id = "webkde-layout-control";
  panel.innerHTML = '<span>Virtual screens</span><select aria-label="Virtual screens"><option value="1">1</option><option value="2">2</option></select>';
  Object.assign(panel.style, {
    position: "fixed", top: "10px", right: "52px", zIndex: "2147483647",
    display: "flex", gap: "8px", alignItems: "center", padding: "7px 9px",
    color: "white", background: "rgba(25,25,28,.88)", border: "1px solid #666",
    borderRadius: "6px", font: "13px system-ui, sans-serif", boxShadow: "0 2px 8px #0008"
  });
  const select = panel.querySelector("select");
  select.value = localStorage.getItem(storageKey) === "2" ? "2" : "1";

  let timer;
  let lastMessage = "";
  function apply(force = false) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const count = Number(select.value);
      const orientation = innerWidth >= innerHeight ? "horizontal" : "vertical";
      const message = `WEBKDE_LAYOUT,${count},${orientation},${innerWidth},${innerHeight}`;
      if (!force && message === lastMessage) return;
      lastMessage = message;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/websocket`);
      const timeout = setTimeout(() => socket.close(), 5000);
      socket.addEventListener("open", () => socket.send(message));
      socket.addEventListener("message", event => {
        if (String(event.data).startsWith("WEBKDE_LAYOUT_APPLIED,")) socket.close();
      });
      socket.addEventListener("close", () => clearTimeout(timeout));
    }, force ? 0 : 350);
  }

  select.addEventListener("change", () => {
    localStorage.setItem(storageKey, select.value);
    apply(true);
  });
  addEventListener("resize", () => apply(false));
  addEventListener("load", () => setTimeout(() => apply(true), 1500));
  document.body.appendChild(panel);
})();

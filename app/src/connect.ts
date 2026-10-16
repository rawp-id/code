import { bridge } from "./bridge";

let overlay: HTMLElement;
let input: HTMLInputElement;
let statusEl: HTMLElement;
let hideTimer: number | undefined;

/** Show a dialog when the server cannot be reached, letting the user set the URL. */
export function initConnectionUi(): void {
  overlay = document.createElement("div");
  overlay.className = "overlay connect";
  overlay.style.display = "none";
  overlay.innerHTML = `
    <div class="palette connect-panel">
      <div class="connect-title">Connect to a Kode server</div>
      <div class="connect-hint">
        Start the server with <code>npm run dev</code> (or on the device) and point the
        editor at its WebSocket address.
      </div>
      <input type="text" spellcheck="false" data-connect-url />
      <div class="connect-status" data-connect-status></div>
      <div class="connect-actions">
        <button data-connect-retry>Retry</button>
        <button class="primary" data-connect-go>Connect</button>
      </div>
    </div>
  `;
  document.body.append(overlay);

  input = overlay.querySelector<HTMLInputElement>("[data-connect-url]")!;
  statusEl = overlay.querySelector<HTMLElement>("[data-connect-status]")!;
  input.value = bridge.serverUrl;

  const connect = () => {
    const url = input.value.trim();
    if (!url) return;
    statusEl.textContent = "Connecting…";
    bridge.setUrl(url);
  };

  overlay.querySelector("[data-connect-go]")!.addEventListener("click", connect);
  overlay.querySelector("[data-connect-retry]")!.addEventListener("click", connect);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") connect();
  });

  bridge.on("status", ({ connected, url }: { connected: boolean; url: string }) => {
    if (connected) {
      window.clearTimeout(hideTimer);
      hideTimer = undefined;
      overlay.style.display = "none";
      statusEl.textContent = "";
      return;
    }
    input.value = url || input.value;
    statusEl.textContent = "Offline. Last address: " + (url || input.value);
    if (hideTimer === undefined) {
      hideTimer = window.setTimeout(() => {
        hideTimer = undefined;
        overlay.style.display = "flex";
        input.focus();
        input.select();
      }, 1800);
    }
  });
}

export function openConnectionDialog(): void {
  overlay.style.display = "flex";
  input.value = bridge.serverUrl;
  input.focus();
  input.select();
}

import { bridge } from "./bridge";

let overlay: HTMLElement;
let input: HTMLInputElement;
let statusEl: HTMLElement;
let hideTimer: number | undefined;
let userDismissed = false;

/** Show a dialog when the server cannot be reached, letting the user set the URL or work offline. */
export function initConnectionUi(): void {
  overlay = document.createElement("div");
  overlay.className = "overlay connect";
  overlay.style.display = "none";
  overlay.innerHTML = `
    <div class="palette connect-panel">
      <div class="connect-header">
        <div class="connect-title">Connect to a Kode server</div>
        <button class="connect-close" data-connect-close title="Close">✕</button>
      </div>
      <div class="connect-hint">
        Currently in <strong>Standalone Mode</strong>. To enable native terminal & extension host, connect to your server address:
      </div>
      <input type="text" spellcheck="false" data-connect-url />
      <div class="connect-status" data-connect-status></div>
      <div class="connect-actions">
        <button data-connect-offline>Work Offline</button>
        <button data-connect-retry>Retry</button>
        <button class="primary" data-connect-go>Connect</button>
      </div>
    </div>
  `;
  document.body.append(overlay);

  input = overlay.querySelector<HTMLInputElement>("[data-connect-url]")!;
  statusEl = overlay.querySelector<HTMLElement>("[data-connect-status]")!;
  input.value = bridge.serverUrl;

  const dismiss = () => {
    userDismissed = true;
    overlay.style.display = "none";
  };

  const connect = () => {
    const url = input.value.trim();
    if (!url) return;
    statusEl.textContent = "Connecting…";
    bridge.setUrl(url);
  };

  overlay.querySelector("[data-connect-go]")!.addEventListener("click", connect);
  overlay.querySelector("[data-connect-retry]")!.addEventListener("click", connect);
  overlay.querySelector("[data-connect-close]")!.addEventListener("click", dismiss);
  overlay.querySelector("[data-connect-offline]")!.addEventListener("click", dismiss);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) dismiss();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") connect();
    if (event.key === "Escape") dismiss();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay.style.display === "flex") {
      dismiss();
    }
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
    statusEl.textContent = "Standalone Mode. Server address: " + (url || input.value);

    // If user explicitly chose to work offline or dismissed, do not auto-popup
    if (userDismissed) return;

    if (hideTimer === undefined) {
      hideTimer = window.setTimeout(() => {
        hideTimer = undefined;
        if (!userDismissed) {
          overlay.style.display = "flex";
          input.focus();
          input.select();
        }
      }, 2500);
    }
  });
}

export function openConnectionDialog(): void {
  overlay.style.display = "flex";
  input.value = bridge.serverUrl;
  input.focus();
  input.select();
}

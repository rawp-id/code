export function toast(
  kind: "info" | "warning" | "error",
  message: string,
  timeout = 4000
): void {
  const container = document.querySelector("[data-toasts]");
  if (!container) return;
  const element = document.createElement("div");
  element.className = `toast ${kind}`;
  element.textContent = message;
  container.append(element);
  setTimeout(() => {
    element.style.opacity = "0";
    element.style.transition = "opacity 0.2s";
    setTimeout(() => element.remove(), 200);
  }, timeout);
}

export interface MenuItem {
  label?: string;
  icon?: string;
  run?: () => void;
  disabled?: boolean;
  separator?: boolean;
}

let activeCleanup: (() => void) | null = null;

export function closeContextMenu(): void {
  const cleanup = activeCleanup;
  activeCleanup = null;
  cleanup?.();
}

/**
 * Shared context menu. Closes only when clicking outside (not on the menu
 * itself), so item clicks actually fire.
 */
export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  closeContextMenu();

  const menu = document.createElement("div");
  menu.className = "tree-menu";
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - 190))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - 260))}px`;

  for (const item of items) {
    if (item.separator) {
      const separator = document.createElement("div");
      separator.className = "tree-menu-sep";
      menu.append(separator);
      continue;
    }
    const element = document.createElement("div");
    element.className = "tree-menu-item" + (item.disabled ? " disabled" : "");
    if (item.icon) {
      const label = document.createElement("span");
      label.textContent = item.label || "";
      element.innerHTML = item.icon;
      element.append(label);
    } else {
      element.textContent = item.label || "";
    }
    if (!item.disabled && item.run) {
      element.onclick = (event) => {
        event.stopPropagation();
        const run = item.run!;
        closeContextMenu();
        run();
      };
    }
    menu.append(element);
  }

  document.body.append(menu);

  const onDown = (event: MouseEvent) => {
    if (!menu.contains(event.target as Node)) closeContextMenu();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeContextMenu();
  };
  const onScroll = () => closeContextMenu();

  setTimeout(() => {
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
  }, 0);

  activeCleanup = () => {
    menu.remove();
    document.removeEventListener("mousedown", onDown);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("scroll", onScroll, true);
  };
}

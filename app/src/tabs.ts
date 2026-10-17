import type { EditorManager } from "./editor";
import { icons, fileColor } from "./icons";

export class TabsView {
  private menu: HTMLElement | null = null;

  constructor(private el: HTMLElement, private editor: EditorManager) {
    editor.onDidChange(() => this.render());

    // Vertical mouse wheel scrolls the tab strip horizontally.
    this.el.addEventListener(
      "wheel",
      (event) => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        if (this.el.scrollWidth <= this.el.clientWidth) return;
        this.el.scrollLeft += event.deltaY;
        event.preventDefault();
      },
      { passive: false }
    );

    // Right-click on the empty area of the tab strip.
    this.el.addEventListener("contextmenu", (event) => {
      if (event.target === this.el) this.openMenu(event);
    });

    this.render();
  }

  render(): void {
    this.el.innerHTML = "";
    for (const doc of this.editor.openDocs) {
      const tab = document.createElement("div");
      tab.className = "tab" + (doc.path === this.editor.active ? " active" : "");
      tab.title = doc.path;

      const icon = document.createElement("span");
      icon.className = "tab-icon";
      icon.innerHTML = icons.file;
      icon.style.color = fileColor(doc.path);

      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = doc.path.split("/").pop() || doc.path;
      tab.append(icon, label);

      if (doc.dirty) {
        const dirty = document.createElement("span");
        dirty.className = "dirty";
        tab.append(dirty);
      }

      const close = document.createElement("button");
      close.className = "close";
      close.innerHTML = icons.close;
      close.title = "Close";
      close.onclick = (event) => {
        event.stopPropagation();
        this.editor.close(doc.path);
      };
      tab.append(close);

      tab.onclick = () => this.editor.activate(doc.path);
      tab.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openMenu(event, doc.path);
      });
      this.el.append(tab);
    }

    const active = this.editor.openDocs.find((doc) => doc.path === this.editor.active);
    if (active) {
      const language = document.createElement("span");
      language.className = "tabs-lang";
      language.textContent = active.languageId;
      language.title = `Detected language: ${active.languageId}`;
      this.el.append(language);
    }
  }

  private openMenu(event: MouseEvent, path?: string): void {
    event.preventDefault();
    this.closeMenu();
    const menu = document.createElement("div");
    menu.className = "tree-menu";
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 190)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 180)}px`;

    const add = (label: string, run: () => void) => {
      const item = document.createElement("div");
      item.className = "tree-menu-item";
      item.textContent = label;
      item.onclick = (click) => {
        click.stopPropagation();
        this.closeMenu();
        run();
      };
      menu.append(item);
    };
    const separator = () => {
      const sep = document.createElement("div");
      sep.className = "tree-menu-sep";
      menu.append(sep);
    };

    if (path) {
      add("Close", () => this.editor.close(path));
      add("Close Others", () => this.closeOthers(path));
      add("Close to the Right", () => this.closeToRight(path));
      separator();
    }
    add("Close Saved", () => this.closeSaved());
    add("Close All", () => this.closeAll());

    document.body.append(menu);
    this.menu = menu;
    const close = () => this.closeMenu();
    setTimeout(() => document.addEventListener("mousedown", close, { once: true }), 0);
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }

  private closeOthers(keep: string): void {
    for (const doc of this.editor.openDocs) {
      if (doc.path !== keep) this.editor.close(doc.path);
    }
  }

  private closeToRight(path: string): void {
    const docs = this.editor.openDocs;
    const index = docs.findIndex((doc) => doc.path === path);
    if (index < 0) return;
    for (const doc of docs.slice(index + 1)) this.editor.close(doc.path);
  }

  private closeSaved(): void {
    for (const doc of this.editor.openDocs) {
      if (!doc.dirty) this.editor.close(doc.path);
    }
  }

  private closeAll(): void {
    const unsaved = this.editor.openDocs.filter((doc) => doc.dirty).length;
    if (unsaved > 0 && !window.confirm(`Close ${unsaved} unsaved file(s)?`)) return;
    this.editor.closeAll();
  }
}

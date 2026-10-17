import type { EditorManager } from "./editor";
import { icons, fileColor, iconFor } from "./icons";
import { httpBase } from "./bridge";
import { showContextMenu, type MenuItem } from "./contextmenu";

export class TabsView {
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
      const fileName = doc.path.split("/").pop() || doc.path;
      const themed = iconFor(fileName, "file");
      if (themed) {
        const img = document.createElement("img");
        img.src = `${httpBase()}${themed}`;
        img.alt = "";
        icon.append(img);
      } else {
        icon.innerHTML = icons.file;
        icon.style.color = fileColor(doc.path);
      }

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
    const items: MenuItem[] = [];
    if (path) {
      items.push({ label: "Close", run: () => this.editor.close(path) });
      items.push({ label: "Close Others", run: () => this.closeOthers(path) });
      items.push({ label: "Close to the Right", run: () => this.closeToRight(path) });
      items.push({ separator: true });
    }
    items.push({ label: "Close Saved", run: () => this.closeSaved() });
    items.push({ label: "Close All", run: () => this.closeAll() });
    showContextMenu(event.clientX, event.clientY, items);
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

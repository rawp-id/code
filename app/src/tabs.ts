import type { EditorManager } from "./editor";
import { icons, fileColor } from "./icons";
export class TabsView {
  constructor(private el: HTMLElement, private editor: EditorManager) {
    editor.onDidChange(() => this.render());
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
}

import { bridge, type DirEntry, type ExtensionInfo } from "./bridge";
import { bus } from "./bus";
import { icons } from "./icons";

export class FileTree {
  private expanded = new Set<string>();
  private rows = new Map<string, HTMLElement>();
  private activePath: string | null = null;

  constructor(private el: HTMLElement, private onOpen: (path: string) => void) {
    bus.on("editor.active", ({ path }: { path: string }) => this.setActive(path));
  }

  async refresh(): Promise<void> {
    this.el.innerHTML = "";
    this.rows.clear();
    await this.renderInto("", this.el, 0);
    if (this.activePath) this.setActive(this.activePath);
  }

  private async renderInto(path: string, container: HTMLElement, depth: number): Promise<void> {
    let entries: DirEntry[] = [];
    try {
      entries = await bridge.request<DirEntry[]>("fs.readDir", { path });
    } catch (error: any) {
      container.textContent = `Failed to read ${path || "."}: ${error?.message}`;
      return;
    }

    for (const entry of entries) {
      const row = this.makeRow(entry, depth);
      this.rows.set(entry.path, row);

      if (entry.type === "dir") {
        const child = document.createElement("div");
        child.className = "tree-children";
        child.style.display = "none";
        row.onclick = () => this.toggle(entry, row, child, depth);
        container.append(row, child);
        if (this.expanded.has(entry.path)) {
          child.style.display = "block";
          child.dataset.loaded = "1";
          await this.renderInto(entry.path, child, depth + 1);
        }
      } else {
        row.onclick = () => {
          this.setActive(entry.path);
          this.onOpen(entry.path);
        };
        container.append(row);
      }
    }
  }

  private makeRow(entry: DirEntry, depth: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "tree-row";
    row.dataset.path = entry.path;
    row.style.paddingLeft = `${6 + depth * 12}px`;

    const chevron = document.createElement("span");
    chevron.className = "tree-chevron";
    if (entry.type === "dir") {
      chevron.innerHTML = this.expanded.has(entry.path)
        ? icons.chevronDown
        : icons.chevronRight;
    }

    const icon = document.createElement("span");
    icon.className = `tree-icon ${entry.type}`;
    icon.innerHTML =
      entry.type === "dir"
        ? this.expanded.has(entry.path)
          ? icons.folderOpen
          : icons.folder
        : icons.file;

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = entry.name;

    row.append(chevron, icon, label);
    return row;
  }

  private updateIcon(entry: DirEntry, row: HTMLElement): void {
    const open = this.expanded.has(entry.path);
    const chevron = row.querySelector(".tree-chevron");
    const icon = row.querySelector(".tree-icon");
    if (chevron && entry.type === "dir") {
      chevron.innerHTML = open ? icons.chevronDown : icons.chevronRight;
    }
    if (icon && entry.type === "dir") {
      icon.innerHTML = open ? icons.folderOpen : icons.folder;
    }
  }

  private async toggle(
    entry: DirEntry,
    row: HTMLElement,
    child: HTMLElement,
    depth: number
  ): Promise<void> {
    if (this.expanded.has(entry.path)) {
      this.expanded.delete(entry.path);
      child.style.display = "none";
    } else {
      this.expanded.add(entry.path);
      child.style.display = "block";
      if (!child.dataset.loaded) {
        child.dataset.loaded = "1";
        await this.renderInto(entry.path, child, depth + 1);
      }
    }
    this.updateIcon(entry, row);
  }

  setActive(path: string): void {
    this.activePath = path;
    for (const [rowPath, row] of this.rows) {
      row.classList.toggle("active", rowPath === path);
    }
  }
}

export class ExtensionsView {
  constructor(
    private el: HTMLElement,
    private onRunCommand: (extensionId: string, command: string) => void
  ) {}

  async refresh(): Promise<void> {
    let extensions: ExtensionInfo[] = [];
    try {
      extensions = await bridge.request<ExtensionInfo[]>("ext.list");
    } catch (error: any) {
      this.el.textContent = `Failed to load extensions: ${error?.message}`;
      return;
    }
    if (extensions.length === 0) {
      this.el.textContent = "No extensions found in server/extensions.";
      return;
    }

    this.el.innerHTML = "";
    for (const extension of extensions) {
      const item = document.createElement("div");
      item.className = "ext-item";

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = extension.displayName;

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `${extension.id} · v${extension.version}${extension.active ? " · active" : ""}`;

      item.append(name, meta);

      for (const command of extension.commands) {
        const link = document.createElement("span");
        link.className = "cmd";
        link.textContent = command.title;
        link.onclick = () => this.onRunCommand(extension.id, command.command);
        item.append(link);
      }

      this.el.append(item);
    }
  }
}

import { bridge, type DirEntry, type ExtensionInfo } from "./bridge";

function setLabel(row: HTMLElement, icon: string, name: string, depth: number): void {
  row.textContent = `${icon} ${name}`;
  row.style.paddingLeft = `${8 + depth * 12}px`;
}

export class FileTree {
  private expanded = new Set<string>();
  private selected: HTMLElement | null = null;

  constructor(private el: HTMLElement, private onOpen: (path: string) => void) {}

  async refresh(): Promise<void> {
    this.el.innerHTML = "";
    this.selected = null;
    await this.renderInto("", this.el, 0);
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
      const row = document.createElement("div");
      row.className = "tree-row";
      if (entry.type === "dir") {
        const child = document.createElement("div");
        child.className = "tree-children";
        child.style.display = "none";
        const open = this.expanded.has(entry.path);
        setLabel(row, open ? "▾" : "▸", entry.name, depth);
        row.onclick = () => this.toggle(entry, row, child, depth);
        container.append(row, child);
        if (open) {
          child.style.display = "block";
          child.dataset.loaded = "1";
          await this.renderInto(entry.path, child, depth + 1);
        }
      } else {
        setLabel(row, " ", entry.name, depth);
        row.onclick = () => {
          this.select(row);
          this.onOpen(entry.path);
        };
        container.append(row);
      }
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
      setLabel(row, "▸", entry.name, depth);
      return;
    }
    this.expanded.add(entry.path);
    child.style.display = "block";
    setLabel(row, "▾", entry.name, depth);
    if (!child.dataset.loaded) {
      child.dataset.loaded = "1";
      await this.renderInto(entry.path, child, depth + 1);
    }
  }

  private select(row: HTMLElement): void {
    this.selected?.classList.remove("selected");
    row.classList.add("selected");
    this.selected = row;
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

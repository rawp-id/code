import { bridge, type DirEntry } from "./bridge";
import { bus } from "./bus";
import { icons, fileColor } from "./icons";
import { showInputBox } from "./palette";
import { pickFolder } from "./folderpicker";
import { toast } from "./toast";

export class FileTree {
  private root: HTMLElement;
  private expanded = new Set<string>();
  private rows = new Map<string, HTMLElement>();
  private activePath: string | null = null;
  private selected: { path: string; type: "file" | "dir" } | null = null;
  private menu: HTMLElement | null = null;

  constructor(private el: HTMLElement, private onOpen: (path: string) => void) {
    this.el.innerHTML = "";
    this.root = document.createElement("div");
    this.root.className = "tree-root";
    this.el.append(this.root);
    bus.on("editor.active", ({ path }: { path: string }) => this.setActive(path));
  }

  async refresh(): Promise<void> {
    this.root.innerHTML = "";
    this.rows.clear();
    await this.renderInto("", this.root, 0);
    if (this.activePath) this.setActive(this.activePath);
  }

  expandedPaths(): string[] {
    return [...this.expanded];
  }

  async setExpanded(paths: string[]): Promise<void> {
    this.expanded = new Set(paths);
    await this.refresh();
  }

  createFile(base?: string): Promise<void> {
    return this.create("file", base);
  }

  createFolder(base?: string): Promise<void> {
    return this.create("dir", base);
  }

  private baseDir(): string {
    if (!this.selected) return "";
    if (this.selected.type === "dir") return this.selected.path;
    const slash = this.selected.path.lastIndexOf("/");
    return slash >= 0 ? this.selected.path.slice(0, slash) : "";
  }

  private async create(kind: "file" | "dir", baseArg?: string): Promise<void> {
    const name = await showInputBox({
      prompt: kind === "file" ? "New file name" : "New folder name",
    });
    if (!name) return;
    const base = baseArg ?? this.baseDir();
    const path = base ? `${base}/${name}` : name;
    try {
      await bridge.request(kind === "file" ? "fs.createFile" : "fs.mkdir", { path });
      if (base) this.expanded.add(base);
      await this.refresh();
      if (kind === "file") this.onOpen(path);
    } catch (error: any) {
      toast("error", `Could not create ${name}: ${error?.message}`);
    }
    bus.emit("tree.changed");
  }

  async openFolder(): Promise<void> {
    const root = await pickFolder();
    if (!root) return;
    try {
      const info = await bridge.request<{ root: string; name: string }>("ws.setRoot", { root });
      this.expanded.clear();
      this.selected = null;
      await this.refresh();
      bus.emit("workspace.changed", { root: info.root });
      bus.emit("tree.changed");
      toast("info", `Opened ${info.root}`);
    } catch (error: any) {
      toast("error", `Could not open folder: ${error?.message}`);
    }
  }

  private async rename(entry: DirEntry): Promise<void> {
    const name = await showInputBox({ prompt: "New name", value: entry.name });
    if (!name || name === entry.name) return;
    const slash = entry.path.lastIndexOf("/");
    const dir = slash >= 0 ? entry.path.slice(0, slash) : "";
    const to = dir ? `${dir}/${name}` : name;
    try {
      await bridge.request("fs.rename", { from: entry.path, to });
      bus.emit("file.renamed", { from: entry.path, to });
      await this.refresh();
      bus.emit("tree.changed");
    } catch (error: any) {
      toast("error", `Rename failed: ${error?.message}`);
    }
  }

  private async remove(entry: DirEntry): Promise<void> {
    if (!window.confirm(`Delete ${entry.path}?`)) return;
    try {
      await bridge.request("fs.delete", { path: entry.path });
      bus.emit("file.deleted", { path: entry.path });
      await this.refresh();
      bus.emit("tree.changed");
    } catch (error: any) {
      toast("error", `Delete failed: ${error?.message}`);
    }
  }

  private openMenu(event: MouseEvent, entry: DirEntry): void {
    event.preventDefault();
    event.stopPropagation();
    this.closeMenu();
    const menu = document.createElement("div");
    menu.className = "tree-menu";
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;

    const add = (label: string, icon: string, run: () => void) => {
      const item = document.createElement("div");
      item.className = "tree-menu-item";
      item.innerHTML = `${icon}<span>${label}</span>`;
      item.onclick = (click) => {
        click.stopPropagation();
        this.closeMenu();
        run();
      };
      menu.append(item);
    };

    if (entry.type === "dir") {
      add("New File…", icons.newFile, () => this.create("file", entry.path));
      add("New Folder…", icons.newFolder, () => this.create("dir", entry.path));
      const separator = document.createElement("div");
      separator.className = "tree-menu-sep";
      menu.append(separator);
    }
    add("Rename…", icons.rename, () => this.rename(entry));
    add("Delete", icons.trash, () => this.remove(entry));

    document.body.append(menu);
    this.menu = menu;
    const close = () => this.closeMenu();
    setTimeout(() => document.addEventListener("mousedown", close, { once: true }), 0);
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
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
        row.onclick = () => {
          this.selected = { path: entry.path, type: "dir" };
          this.toggle(entry, row, child, depth);
        };
        container.append(row, child);
        if (this.expanded.has(entry.path)) {
          child.style.display = "block";
          child.dataset.loaded = "1";
          await this.renderInto(entry.path, child, depth + 1);
        }
      } else {
        row.onclick = () => {
          this.selected = { path: entry.path, type: "file" };
          this.setActive(entry.path);
          this.onOpen(entry.path);
        };
        container.append(row);
      }
      row.addEventListener("contextmenu", (event) => this.openMenu(event, entry));
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
    if (entry.type === "dir") {
      icon.innerHTML = this.expanded.has(entry.path) ? icons.folderOpen : icons.folder;
    } else {
      icon.innerHTML = icons.file;
      icon.style.color = fileColor(entry.name);
    }

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = entry.name;

    row.append(chevron, icon, label);

    if (entry.type === "dir") {
      const actions = document.createElement("span");
      actions.className = "tree-row-actions";
      actions.append(
        this.rowAction("New File", icons.newFile, () => this.create("file", entry.path)),
        this.rowAction("New Folder", icons.newFolder, () => this.create("dir", entry.path))
      );
      row.append(actions);
    }
    return row;
  }

  private rowAction(title: string, icon: string, run: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "tree-row-action";
    button.title = title;
    button.innerHTML = icon;
    button.onclick = (event) => {
      event.stopPropagation();
      run();
    };
    return button;
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
    bus.emit("tree.changed");
  }

  setActive(path: string): void {
    this.activePath = path;
    for (const [rowPath, row] of this.rows) {
      row.classList.toggle("active", rowPath === path);
    }
  }
}

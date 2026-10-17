import { bridge } from "./bridge";
import { icons } from "./icons";

interface DirListing {
  path: string;
  parent: string | null;
  home: string;
  dirs: { name: string; path: string }[];
  truncated: boolean;
}

/** Browse the server's filesystem and return the chosen absolute path. */
export function pickFolder(start?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay folder-picker";
    overlay.innerHTML = `
      <div class="palette folder-panel">
        <div class="folder-path">
          <button data-folder-up title="Parent folder">↑</button>
          <input type="text" spellcheck="false" data-folder-input placeholder="Type a path or browse" />
          <button data-folder-home title="Home">~</button>
        </div>
        <div class="folder-list" data-folder-list></div>
        <div class="folder-actions">
          <button data-folder-cancel>Cancel</button>
          <button class="primary" data-folder-select>Open</button>
        </div>
      </div>
    `;
    document.body.append(overlay);

    const input = overlay.querySelector<HTMLInputElement>("[data-folder-input]")!;
    const list = overlay.querySelector<HTMLElement>("[data-folder-list]")!;
    const upButton = overlay.querySelector<HTMLButtonElement>("[data-folder-up]")!;
    const homeButton = overlay.querySelector<HTMLButtonElement>("[data-folder-home]")!;

    let current = "";
    let parent: string | null = null;
    let home = "";

    const close = (value: string | null) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(value);
    };

    const load = async (target?: string): Promise<void> => {
      list.innerHTML = `<div class="folder-empty">Loading…</div>`;
      try {
        const listing = await bridge.request<DirListing>("fs.listDirs", { path: target });
        current = listing.path;
        parent = listing.parent;
        home = listing.home;
        input.value = listing.path;
        upButton.disabled = !parent;

        list.innerHTML = "";
        if (listing.dirs.length === 0) {
          list.innerHTML = `<div class="folder-empty">No subfolders here</div>`;
        }
        for (const dir of listing.dirs) {
          const row = document.createElement("div");
          row.className = "folder-row";
          row.innerHTML = icons.folder;
          const label = document.createElement("span");
          label.textContent = dir.name;
          row.append(label);
          row.onclick = () => load(dir.path);
          list.append(row);
        }
      } catch (error: any) {
        list.innerHTML = `<div class="folder-empty">${error?.message}</div>`;
        upButton.disabled = true;
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(null);
      }
    };

    upButton.onclick = () => {
      if (parent) load(parent);
    };
    homeButton.onclick = () => {
      if (home) load(home);
    };
    overlay.querySelector("[data-folder-cancel]")!.addEventListener("click", () => close(null));
    overlay.querySelector("[data-folder-select]")!.addEventListener("click", () => close(current));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        load(input.value);
      }
    });
    overlay.onmousedown = (event) => {
      if (event.target === overlay) close(null);
    };
    document.addEventListener("keydown", onKey, true);

    load(start);
    input.focus();
  });
}

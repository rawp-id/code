export interface Command {
  id: string;
  title: string;
  hint?: string;
  run: () => void;
}

interface OverlayEntry<T> {
  label: string;
  hint?: string;
  value: T;
}

function createOverlay(className: string): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = `overlay ${className}`;
  overlay.tabIndex = -1;
  document.body.append(overlay);
  return overlay;
}

function listPicker<T>(
  title: string,
  entries: OverlayEntry<T>[],
  emptyText = "No matching results"
): Promise<T | undefined> {
  return new Promise((resolve) => {
    const overlay = createOverlay("picker");
    overlay.innerHTML = `
      <div class="palette">
        <input type="text" spellcheck="false" placeholder="${title}" />
        <div class="palette-list"></div>
      </div>
    `;
    const input = overlay.querySelector("input")!;
    const listEl = overlay.querySelector(".palette-list")!;

    let filtered = entries.slice();
    let index = 0;

    const close = (value: T | undefined) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(value);
    };

    const render = () => {
      listEl.innerHTML = "";
      if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "palette-item";
        empty.textContent = emptyText;
        listEl.append(empty);
        return;
      }
      index = Math.min(index, filtered.length - 1);
      filtered.forEach((entry, i) => {
        const row = document.createElement("div");
        row.className = "palette-item" + (i === index ? " active" : "");
        const label = document.createElement("span");
        label.textContent = entry.label;
        row.append(label);
        if (entry.hint) {
          const hint = document.createElement("span");
          hint.className = "hint";
          hint.textContent = entry.hint;
          row.append(hint);
        }
        row.onclick = () => close(entry.value);
        listEl.append(row);
      });
    };

    const filter = () => {
      const query = input.value.toLowerCase().trim();
      filtered = query
        ? entries.filter((entry) => entry.label.toLowerCase().includes(query))
        : entries.slice();
      index = 0;
      render();
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(undefined);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        index = Math.min(index + 1, filtered.length - 1);
        render();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        index = Math.max(index - 1, 0);
        render();
      } else if (event.key === "Enter") {
        event.preventDefault();
        close(filtered[index]?.value);
      }
    };

    input.oninput = filter;
    overlay.onmousedown = (event) => {
      if (event.target === overlay) close(undefined);
    };
    document.addEventListener("keydown", onKey, true);
    input.focus();
    render();
  });
}

export class CommandPalette {
  private commands: Command[] = [];

  register(...commands: Command[]): void {
    this.commands.push(...commands);
  }

  setCommands(commands: Command[]): void {
    this.commands = commands;
  }

  open(): void {
    const entries: OverlayEntry<Command>[] = this.commands.map((command) => ({
      label: command.title,
      hint: command.hint,
      value: command,
    }));
    listPicker("Type a command", entries).then((command) => command?.run());
  }
}

export function showQuickPick(items: any[], options?: any): Promise<any> {
  const entries: OverlayEntry<any>[] = (items || []).map((item) => ({
    label: typeof item === "string" ? item : item.label ?? String(item),
    hint: typeof item === "string" ? undefined : item.description,
    value: item,
  }));
  return listPicker(options?.placeHolder || "Select an item", entries);
}

export function showInputBox(options?: any): Promise<string | undefined> {
  return new Promise((resolve) => {
    const overlay = createOverlay("input-box");
    overlay.innerHTML = `
      <div class="palette">
        <input type="text" spellcheck="false" />
      </div>
    `;
    const input = overlay.querySelector("input")!;
    input.placeholder = options?.prompt || "";
    input.value = options?.value || "";

    const close = (value: string | undefined) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(undefined);
      } else if (event.key === "Enter") {
        event.preventDefault();
        close(input.value);
      }
    };
    overlay.onmousedown = (event) => {
      if (event.target === overlay) close(undefined);
    };
    document.addEventListener("keydown", onKey, true);
    input.focus();
  });
}

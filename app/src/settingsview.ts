import { bridge } from "./bridge";
import { DEFAULT_SETTINGS, getPath, setPath, type Settings } from "./settings";

interface SettingDef {
  id: string;
  section: string;
  label: string;
  description?: string;
  type: "boolean" | "number" | "string" | "select" | "stringArray";
  options?: { label: string; value: string }[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

const SCHEMA: SettingDef[] = [
  {
    id: "editor.fontSize",
    section: "Editor",
    label: "Font Size",
    description: "Editor font size in pixels.",
    type: "number",
    min: 10,
    max: 32,
    step: 1,
  },
  {
    id: "editor.tabSize",
    section: "Editor",
    label: "Tab Size",
    description: "Spaces inserted per indentation level.",
    type: "number",
    min: 1,
    max: 8,
    step: 1,
  },
  {
    id: "editor.wordWrap",
    section: "Editor",
    label: "Word Wrap",
    type: "select",
    options: [
      { label: "Off", value: "off" },
      { label: "On", value: "on" },
    ],
  },
  { id: "editor.lineNumbers", section: "Editor", label: "Line Numbers", type: "boolean" },
  {
    id: "editor.highlightActiveLine",
    section: "Editor",
    label: "Highlight Active Line",
    type: "boolean",
  },
  {
    id: "editor.autoSave",
    section: "Editor",
    label: "Auto Save",
    description: "Automatically save modified files.",
    type: "select",
    options: [
      { label: "Off", value: "off" },
      { label: "After Delay", value: "afterDelay" },
      { label: "On Focus Change", value: "onFocusChange" },
    ],
  },
  {
    id: "editor.autoSaveDelay",
    section: "Editor",
    label: "Auto Save Delay (ms)",
    type: "number",
    min: 200,
    max: 10000,
    step: 100,
  },
  {
    id: "files.exclude",
    section: "Files",
    label: "Exclude",
    description: "Folder or file names hidden from the Explorer (one per line).",
    type: "stringArray",
    placeholder: "node_modules",
  },
  {
    id: "search.exclude",
    section: "Search",
    label: "Search Exclude",
    description: "Folder or file names skipped when searching (one per line).",
    type: "stringArray",
    placeholder: "node_modules",
  },
  {
    id: "search.maxResults",
    section: "Search",
    label: "Max Results",
    description: "Upper bound on matches returned by a search.",
    type: "number",
    min: 100,
    max: 10000,
    step: 100,
  },
  {
    id: "terminal.fontSize",
    section: "Terminal",
    label: "Font Size",
    type: "number",
    min: 10,
    max: 24,
    step: 1,
  },
  {
    id: "terminal.prompt",
    section: "Terminal",
    label: "Prompt (PS1)",
    description: "Prompt template for new terminal sessions.",
    type: "string",
  },
  {
    id: "workbench.sidebarWidth",
    section: "Workbench",
    label: "Sidebar Width (px)",
    type: "number",
    min: 160,
    max: 500,
    step: 10,
  },
];

const SECTION_ORDER = ["Editor", "Files", "Search", "Terminal", "Workbench"];

export class SettingsView {
  private searchEl: HTMLInputElement;
  private bodyEl: HTMLElement;
  private settings: Settings = structuredClone(DEFAULT_SETTINGS);
  private timer: number | undefined;

  constructor(
    private el: HTMLElement,
    private onChange?: (settings: Settings) => void
  ) {
    this.el.innerHTML = `
      <div class="settings-view">
        <div class="settings-search">
          <input type="text" spellcheck="false" placeholder="Search settings" data-settings-search />
        </div>
        <div class="settings-body" data-settings-body></div>
      </div>
    `;
    this.searchEl = this.el.querySelector<HTMLInputElement>("[data-settings-search]")!;
    this.bodyEl = this.el.querySelector<HTMLElement>("[data-settings-body]")!;
    this.searchEl.addEventListener("input", () => this.render());
  }

  focus(): void {
    this.searchEl.focus();
  }

  async refresh(): Promise<void> {
    try {
      this.settings = await bridge.request<Settings>("settings.get");
    } catch {
      /* keep defaults */
    }
    this.render();
    this.onChange?.(this.settings);
  }

  private render(): void {
    const query = this.searchEl.value.trim().toLowerCase();
    this.bodyEl.innerHTML = "";

    for (const section of SECTION_ORDER) {
      const defs = SCHEMA.filter(
        (def) =>
          def.section === section &&
          (!query ||
            def.label.toLowerCase().includes(query) ||
            def.id.toLowerCase().includes(query) ||
            section.toLowerCase().includes(query))
      );
      if (defs.length === 0) continue;

      const heading = document.createElement("div");
      heading.className = "settings-section";
      heading.textContent = section;
      this.bodyEl.append(heading);

      for (const def of defs) {
        this.bodyEl.append(this.row(def));
      }
    }

    if (this.bodyEl.childElementCount === 0) {
      this.bodyEl.innerHTML = `<div class="settings-empty">No matching settings</div>`;
    }
  }

  private row(def: SettingDef): HTMLElement {
    const row = document.createElement("div");
    row.className = "setting-row";

    const info = document.createElement("div");
    info.className = "setting-info";
    const label = document.createElement("div");
    label.className = "setting-label";
    label.textContent = def.label;
    info.append(label);
    if (def.description) {
      const description = document.createElement("div");
      description.className = "setting-desc";
      description.textContent = def.description;
      info.append(description);
    }

    const control = document.createElement("div");
    control.className = "setting-control";
    control.append(this.control(def));

    row.append(info, control);
    return row;
  }

  private control(def: SettingDef): HTMLElement {
    const value = getPath(this.settings, def.id, getPath(DEFAULT_SETTINGS, def.id));

    if (def.type === "boolean") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(value);
      input.onchange = () => this.update(def.id, input.checked);
      return input;
    }

    if (def.type === "number") {
      const input = document.createElement("input");
      input.type = "number";
      if (def.min !== undefined) input.min = String(def.min);
      if (def.max !== undefined) input.max = String(def.max);
      if (def.step !== undefined) input.step = String(def.step);
      input.value = String(value ?? "");
      input.onchange = () => {
        let next = Number(input.value);
        if (!Number.isFinite(next)) next = Number(getPath(DEFAULT_SETTINGS, def.id, 0));
        if (def.min !== undefined) next = Math.max(def.min, next);
        if (def.max !== undefined) next = Math.min(def.max, next);
        input.value = String(next);
        this.update(def.id, next);
      };
      return input;
    }

    if (def.type === "select") {
      const select = document.createElement("select");
      for (const option of def.options || []) {
        const element = document.createElement("option");
        element.value = option.value;
        element.textContent = option.label;
        if (option.value === value) element.selected = true;
        select.append(element);
      }
      select.onchange = () => this.update(def.id, select.value);
      return select;
    }

    if (def.type === "stringArray") {
      const textarea = document.createElement("textarea");
      textarea.rows = 4;
      textarea.spellcheck = false;
      if (def.placeholder) textarea.placeholder = def.placeholder;
      textarea.value = Array.isArray(value) ? value.join("\n") : "";
      textarea.onchange = () => {
        const list = textarea.value
          .split("\n")
          .map((entry) => entry.trim())
          .filter(Boolean);
        this.update(def.id, list);
      };
      return textarea;
    }

    const input = document.createElement("input");
    input.type = "text";
    input.spellcheck = false;
    if (def.placeholder) input.placeholder = def.placeholder;
    input.value = typeof value === "string" ? value : "";
    input.onchange = () => this.update(def.id, input.value);
    return input;
  }

  private update(id: string, value: any): void {
    setPath(this.settings, id, value);
    this.onChange?.(this.settings);
    this.save();
  }

  private save(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      bridge
        .request<Settings>("settings.update", { settings: this.settings })
        .then((merged) => {
          this.settings = merged;
        })
        .catch(() => {
          /* keep local values */
        });
    }, 300);
  }
}

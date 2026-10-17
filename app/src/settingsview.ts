import { bridge } from "./bridge";
import { DEFAULT_SETTINGS, getPath, setPath, type Settings } from "./settings";
import { SHIKI_THEMES, registerShikiTheme } from "./highlight";
import { icons, setExtensionIconTheme } from "./icons";

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

const COLOR_THEMES = Object.entries(SHIKI_THEMES).map(([value, entry]) => ({
  value,
  label: entry.label,
}));

const ICON_THEMES = [
  { value: "default", label: "Default (colored)" },
  { value: "minimal", label: "Minimal (monochrome)" },
];

const SCHEMA: SettingDef[] = [
  {
    id: "editor.colorTheme",
    section: "Themes",
    label: "Color Theme",
    description: "Syntax highlighting theme (TextMate, via Shiki).",
    type: "select",
    options: COLOR_THEMES,
  },
  {
    id: "workbench.iconTheme",
    section: "Themes",
    label: "File Icon Theme",
    description: "Colour style for file icons in the Explorer and tabs.",
    type: "select",
    options: ICON_THEMES,
  },
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

const SECTIONS = ["Themes", "Editor", "Files", "Search", "Terminal", "Workbench"];

export class SettingsView {
  private searchEl: HTMLInputElement;
  private bodyEl: HTMLElement;
  private settings: Settings = structuredClone(DEFAULT_SETTINGS);
  private lspConfig: Record<string, { command: string; args?: string[] }> = {};
  private extensionThemes: { id: string; label: string; extensionId: string; path: string }[] = [];
  private extensionIconThemes: { id: string; label: string; extensionId: string; path: string }[] =
    [];
  private mode: "list" | "detail" = "list";
  private selectedId: string | null = null;
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
    this.searchEl.addEventListener("input", () => {
      if (this.mode === "detail") {
        this.mode = "list";
        this.selectedId = null;
      }
      this.render();
    });
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
    try {
      this.extensionThemes = await bridge.request("ext.themes");
    } catch {
      this.extensionThemes = [];
    }
    try {
      this.extensionIconThemes = await bridge.request("ext.iconThemes");
    } catch {
      this.extensionIconThemes = [];
    }
    try {
      this.lspConfig = await bridge.request("lsp.config");
    } catch {
      this.lspConfig = {};
    }
    await this.ensureThemeData();
    await this.ensureIconThemeData();
    this.mode = "list";
    this.selectedId = null;
    this.render();
    this.onChange?.(this.settings);
  }

  private optionsFor(def: SettingDef): { label: string; value: string }[] {
    if (def.id === "editor.colorTheme") {
      return [
        ...COLOR_THEMES,
        ...this.extensionThemes.map((theme) => ({ value: theme.id, label: theme.label })),
      ];
    }
    if (def.id === "workbench.iconTheme") {
      return [
        ...ICON_THEMES,
        ...this.extensionIconThemes.map((theme) => ({ value: theme.id, label: theme.label })),
      ];
    }
    return def.options || [];
  }

  private async loadTheme(value: string): Promise<void> {
    if (!value.startsWith("ext:")) return;
    const theme = this.extensionThemes.find((item) => item.id === value);
    if (!theme) return;
    try {
      const data = await bridge.request("ext.themeData", {
        extensionId: theme.extensionId,
        path: theme.path,
      });
      registerShikiTheme(value, data);
    } catch {
      /* ignore */
    }
  }

  private async loadIconTheme(value: string): Promise<void> {
    if (!value.startsWith("ext:")) {
      setExtensionIconTheme(null);
      return;
    }
    const theme = this.extensionIconThemes.find((item) => item.id === value);
    if (!theme) return;
    try {
      const data = await bridge.request("ext.iconThemeData", {
        extensionId: theme.extensionId,
        path: theme.path,
      });
      setExtensionIconTheme(data);
    } catch {
      /* ignore */
    }
  }

  private async ensureThemeData(): Promise<void> {
    const value = getPath(this.settings, "editor.colorTheme");
    if (typeof value === "string") await this.loadTheme(value);
  }

  private async ensureIconThemeData(): Promise<void> {
    const value = getPath(this.settings, "workbench.iconTheme");
    if (typeof value === "string") await this.loadIconTheme(value);
  }

  private render(): void {
    this.bodyEl.innerHTML = "";
    if (this.mode === "detail" && this.selectedId) {
      this.renderDetail(this.selectedId);
      return;
    }
    this.renderList();
  }

  private renderList(): void {
    const query = this.searchEl.value.trim().toLowerCase();
    let count = 0;

    for (const section of SECTIONS) {
      const defs = SCHEMA.filter(
        (def) =>
          def.section === section &&
          (!query ||
            def.label.toLowerCase().includes(query) ||
            def.id.toLowerCase().includes(query) ||
            section.toLowerCase().includes(query))
      );
      if (defs.length === 0) continue;

      this.bodyEl.append(this.heading(section));
      for (const def of defs) {
        this.bodyEl.append(this.listRow(def));
        count += 1;
      }
    }

    // Language servers are shown read-only.
    const servers = Object.entries(this.lspConfig || {});
    if (servers.length > 0 && (!query || "language servers lsp".includes(query))) {
      this.bodyEl.append(this.heading("Language Servers"));
      for (const [language, spec] of servers) {
        const row = document.createElement("div");
        row.className = "setting-row clickable";
        const info = document.createElement("div");
        info.className = "setting-info";
        const label = document.createElement("div");
        label.className = "setting-label";
        label.textContent = language;
        const value = document.createElement("div");
        value.className = "setting-value";
        value.textContent = `${spec.command} ${(spec.args || []).join(" ")}`.trim();
        info.append(label, value);
        row.append(info, this.chevron());
        row.onclick = () => {
          this.mode = "detail";
          this.selectedId = `lsp:${language}`;
          this.render();
        };
        this.bodyEl.append(row);
        count += 1;
      }
    }

    if (count === 0) {
      this.bodyEl.innerHTML = `<div class="settings-empty">No matching settings</div>`;
    }
  }

  private renderDetail(id: string): void {
    const wrap = document.createElement("div");
    wrap.className = "settings-detail";
    wrap.append(this.backButton());

    if (id.startsWith("lsp:")) {
      const language = id.slice(4);
      const spec = this.lspConfig[language];
      const header = document.createElement("div");
      header.className = "settings-detail-header";
      const title = document.createElement("div");
      title.className = "settings-detail-title";
      title.textContent = `Language server: ${language}`;
      const note = document.createElement("div");
      note.className = "settings-detail-desc";
      note.textContent =
        "Configure servers in lsp.config.json (workspace root or server package).";
      header.append(title, note);
      const pre = document.createElement("pre");
      pre.className = "settings-code";
      pre.textContent = JSON.stringify(spec ?? {}, null, 2);
      wrap.append(header, pre);
      this.bodyEl.append(wrap);
      return;
    }

    const def = SCHEMA.find((item) => item.id === id);
    if (!def) {
      this.mode = "list";
      this.render();
      return;
    }

    const header = document.createElement("div");
    header.className = "settings-detail-header";
    const title = document.createElement("div");
    title.className = "settings-detail-title";
    title.textContent = def.label;
    const description = document.createElement("div");
    description.className = "settings-detail-desc";
    description.textContent = def.description || def.id;
    header.append(title, description);

    const field = document.createElement("div");
    field.className = "settings-detail-field";
    const fieldLabel = document.createElement("div");
    fieldLabel.className = "settings-field-label";
    fieldLabel.textContent = "Value";
    const control = document.createElement("div");
    control.className = "setting-control";
    control.append(this.control(def));
    field.append(fieldLabel, control);

    const actions = document.createElement("div");
    actions.className = "settings-detail-actions";
    const reset = document.createElement("button");
    reset.className = "ext-btn";
    reset.textContent = "Reset to default";
    reset.onclick = () => {
      this.update(def.id, structuredClone(getPath(DEFAULT_SETTINGS, def.id)));
      this.render();
    };
    actions.append(reset);

    wrap.append(header, field, actions);
    this.bodyEl.append(wrap);
  }

  private heading(text: string): HTMLElement {
    const heading = document.createElement("div");
    heading.className = "settings-section";
    heading.textContent = text;
    return heading;
  }

  private chevron(): HTMLElement {
    const chevron = document.createElement("span");
    chevron.className = "setting-chevron";
    chevron.innerHTML = icons.chevronRight;
    return chevron;
  }

  private backButton(): HTMLElement {
    const back = document.createElement("button");
    back.className = "settings-back";
    back.innerHTML = `${icons.chevronLeft}<span>Back</span>`;
    back.onclick = () => {
      this.mode = "list";
      this.selectedId = null;
      this.render();
    };
    return back;
  }

  private listRow(def: SettingDef): HTMLElement {
    const row = document.createElement("div");
    row.className = "setting-row clickable";
    const info = document.createElement("div");
    info.className = "setting-info";
    const label = document.createElement("div");
    label.className = "setting-label";
    label.textContent = def.label;
    const value = document.createElement("div");
    value.className = "setting-value";
    value.textContent = this.formatValue(def);
    info.append(label, value);
    row.append(info, this.chevron());
    row.onclick = () => {
      this.mode = "detail";
      this.selectedId = def.id;
      this.render();
    };
    return row;
  }

  private formatValue(def: SettingDef): string {
    const value = getPath(this.settings, def.id, getPath(DEFAULT_SETTINGS, def.id));
    if (def.type === "boolean") return value ? "On" : "Off";
    if (def.type === "select") {
      return this.optionsFor(def).find((option) => option.value === value)?.label ?? String(value ?? "");
    }
    if (def.type === "stringArray") {
      const list = Array.isArray(value) ? value : [];
      return list.length ? `${list.length} entries` : "None";
    }
    return value === "" || value === undefined ? "—" : String(value);
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
      for (const option of this.optionsFor(def)) {
        const element = document.createElement("option");
        element.value = option.value;
        element.textContent = option.label;
        if (option.value === value) element.selected = true;
        select.append(element);
      }
      select.onchange = async () => {
        const next = select.value;
        if (def.id === "editor.colorTheme") await this.loadTheme(next);
        if (def.id === "workbench.iconTheme") await this.loadIconTheme(next);
        this.update(def.id, next);
      };
      return select;
    }

    if (def.type === "stringArray") {
      const textarea = document.createElement("textarea");
      textarea.rows = 6;
      textarea.spellcheck = false;
      if (def.placeholder) textarea.placeholder = def.placeholder;
      textarea.value = Array.isArray(value) ? value.join("\n") : "";
      textarea.onchange = () => {
        this.update(
          def.id,
          textarea.value
            .split("\n")
            .map((entry) => entry.trim())
            .filter(Boolean)
        );
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

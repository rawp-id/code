import { bridge, type ExtensionInfo } from "./bridge";
import { icons } from "./icons";
import { showQuickPick } from "./palette";

interface MarketplaceExtension {
  id: string;
  namespace: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  downloads: number;
  rating: number;
  publisher: string;
  iconUrl?: string;
  downloadUrl?: string;
}

interface MarketplaceResult {
  extensions: MarketplaceExtension[];
  total: number;
}

function formatDownloads(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

export class ExtensionsView {
  private searchEl: HTMLInputElement;
  private registryEl: HTMLSelectElement;
  private sectionEl: HTMLElement;
  private listEl: HTMLElement;
  private installed: ExtensionInfo[] = [];
  private results: MarketplaceResult | null = null;
  private timer: number | undefined;
  private searchSeq = 0;

  constructor(
    private el: HTMLElement,
    private onRunCommand: (extensionId: string, command: string) => void,
    private onChanged?: () => void
  ) {
    this.el.innerHTML = `
      <div class="extensions-view">
        <div class="ext-search">
          <input type="text" spellcheck="false" placeholder="Search Extensions" data-ext-search />
          <select data-ext-registry title="Registry">
            <option value="open-vsx">Open VSX</option>
            <option value="vscode">VS Code Marketplace</option>
          </select>
        </div>
        <div class="ext-section" data-ext-section>Installed</div>
        <div class="ext-list" data-ext-list></div>
      </div>
    `;
    this.searchEl = this.el.querySelector<HTMLInputElement>("[data-ext-search]")!;
    this.registryEl = this.el.querySelector<HTMLSelectElement>("[data-ext-registry]")!;
    this.sectionEl = this.el.querySelector<HTMLElement>("[data-ext-section]")!;
    this.listEl = this.el.querySelector<HTMLElement>("[data-ext-list]")!;

    this.searchEl.addEventListener("input", () => this.scheduleSearch());
    this.registryEl.addEventListener("change", () => {
      if (this.searchEl.value.trim()) this.runSearch();
    });
  }

  focus(): void {
    this.searchEl.focus();
  }

  async refresh(): Promise<void> {
    try {
      this.installed = await bridge.request<ExtensionInfo[]>("ext.list");
    } catch {
      this.installed = [];
    }
    if (this.searchEl.value.trim() && this.results) this.renderMarketplace(this.results);
    else this.renderInstalled();
  }

  private scheduleSearch(): void {
    window.clearTimeout(this.timer);
    if (!this.searchEl.value.trim()) {
      this.results = null;
      this.renderInstalled();
      return;
    }
    this.timer = window.setTimeout(() => this.runSearch(), 300);
  }

  private async runSearch(): Promise<void> {
    const query = this.searchEl.value.trim();
    if (!query) return;
    const seq = ++this.searchSeq;
    this.sectionEl.textContent = "Searching…";
    this.listEl.innerHTML = "";
    try {
      const result = await bridge.request<MarketplaceResult>("ext.marketplace.search", {
        registry: this.registryEl.value,
        query,
        size: 30,
      });
      if (seq !== this.searchSeq) return;
      this.results = result;
      this.renderMarketplace(result);
    } catch (error: any) {
      if (seq !== this.searchSeq) return;
      this.sectionEl.textContent = "Marketplace";
      this.listEl.innerHTML = `<div class="ext-empty">Search failed: ${error?.message}</div>`;
    }
  }

  private renderInstalled(): void {
    this.sectionEl.textContent = `Installed (${this.installed.length})`;
    this.listEl.innerHTML = "";
    if (this.installed.length === 0) {
      this.listEl.innerHTML = `<div class="ext-empty">No extensions installed.</div>`;
      return;
    }
    for (const extension of this.installed) this.listEl.append(this.installedCard(extension));
  }

  private renderMarketplace(result: MarketplaceResult): void {
    this.sectionEl.textContent = `Marketplace · ${result.total} results`;
    this.listEl.innerHTML = "";
    if (result.extensions.length === 0) {
      this.listEl.innerHTML = `<div class="ext-empty">No extensions found.</div>`;
      return;
    }
    for (const extension of result.extensions) this.listEl.append(this.marketplaceCard(extension));
  }

  private installedCard(extension: ExtensionInfo): HTMLElement {
    const card = this.card({
      name: extension.displayName,
      publisher: extension.publisher,
      version: extension.version,
      description: extension.runtime ? "Extension with runtime code" : "Declarative extension",
      meta: `${extension.id} · ${extension.runtime ? "runtime" : "declarative"}${
        extension.active ? " · active" : ""
      }`,
    });
    const actions = card.querySelector(".ext-actions")!;

    if (extension.commands.length > 0) {
      const run = document.createElement("button");
      run.className = "ext-btn";
      run.textContent = `Run command (${extension.commands.length})`;
      run.onclick = async () => {
        const choice = await showQuickPick(
          extension.commands.map((command) => ({
            label: command.title,
            description: command.command,
            command: command.command,
          }))
        );
        if (choice) this.onRunCommand(extension.id, choice.command);
      };
      actions.append(run);
    }

    const remove = document.createElement("button");
    remove.className = "ext-btn";
    remove.textContent = "Uninstall";
    remove.onclick = async () => {
      remove.disabled = true;
      try {
        await bridge.request("ext.uninstall", { id: extension.id });
      } finally {
        await this.refresh();
        this.onChanged?.();
      }
    };
    actions.append(remove);
    return card;
  }

  private marketplaceCard(extension: MarketplaceExtension): HTMLElement {
    const isInstalled = this.installed.some((item) => item.id === extension.id);
    const card = this.card({
      iconUrl: extension.iconUrl,
      name: extension.displayName,
      publisher: extension.publisher,
      version: extension.version,
      description: extension.description,
      meta: `${extension.id} · ${formatDownloads(extension.downloads)} installs${
        extension.rating ? ` · ${extension.rating.toFixed(1)}/5` : ""
      }`,
    });
    const actions = card.querySelector(".ext-actions")!;

    if (isInstalled) {
      const badge = document.createElement("span");
      badge.className = "ext-installed";
      badge.textContent = "Installed";
      actions.append(badge);
      return card;
    }

    const install = document.createElement("button");
    install.className = "ext-btn primary";
    install.textContent = "Install";
    install.onclick = async () => {
      install.disabled = true;
      install.textContent = "Installing…";
      try {
        await bridge.request("ext.marketplace.install", { downloadUrl: extension.downloadUrl });
        await this.refresh();
        this.onChanged?.();
      } catch (error: any) {
        install.textContent = "Failed";
        install.title = error?.message || "Install failed";
      } finally {
        install.disabled = false;
      }
    };
    actions.append(install);
    return card;
  }

  private card(opts: {
    iconUrl?: string;
    name: string;
    publisher?: string;
    version?: string;
    description?: string;
    meta?: string;
  }): HTMLElement {
    const card = document.createElement("div");
    card.className = "ext-card";

    const icon = document.createElement("div");
    icon.className = "ext-icon";
    if (opts.iconUrl) {
      const img = document.createElement("img");
      img.src = opts.iconUrl;
      img.alt = "";
      img.loading = "lazy";
      img.onerror = () => {
        img.remove();
        icon.innerHTML = icons.extensions;
        icon.classList.add("fallback");
      };
      icon.append(img);
    } else {
      icon.innerHTML = icons.extensions;
      icon.classList.add("fallback");
    }

    const body = document.createElement("div");
    body.className = "ext-body";

    const title = document.createElement("div");
    title.className = "ext-title";
    const name = document.createElement("span");
    name.className = "ext-name";
    name.textContent = opts.name;
    title.append(name);
    if (opts.version) {
      const version = document.createElement("span");
      version.className = "ext-ver";
      version.textContent = `v${opts.version}`;
      title.append(version);
    }

    const description = document.createElement("div");
    description.className = "ext-desc";
    description.textContent = opts.description || "";

    const meta = document.createElement("div");
    meta.className = "ext-meta";
    meta.textContent = opts.meta || opts.publisher || "";

    const actions = document.createElement("div");
    actions.className = "ext-actions";

    body.append(title, description, meta, actions);
    card.append(icon, body);
    return card;
  }
}

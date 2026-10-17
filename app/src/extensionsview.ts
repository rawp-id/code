import { bridge, httpBase, type ExtensionInfo } from "./bridge";
import { icons } from "./icons";
import { showQuickPick } from "./palette";
import { marked } from "marked";
import DOMPurify from "dompurify";

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

interface DetailData extends MarketplaceExtension {
  readme?: string;
  changelog?: string;
  readmeIsHtml?: boolean;
  repository?: string;
  license?: string;
  categories?: string[];
  commands?: { command: string; title: string }[];
}

type Tab = "installed" | "marketplace";
type InstalledFilter = "all" | "active" | "inactive";
type Sort = "relevance" | "installs";
type Registry = "open-vsx" | "vscode";

function formatDownloads(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function renderMarkdown(text?: string, isHtml?: boolean): string {
  if (!text) return "";
  const html = isHtml ? text : (marked.parse(text, { async: false }) as string);
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

export class ExtensionsView {
  private searchEl: HTMLInputElement;
  private tabsEl: HTMLElement;
  private filtersEl: HTMLElement;
  private sectionEl: HTMLElement;
  private listEl: HTMLElement;

  private installed: ExtensionInfo[] = [];
  private popular: MarketplaceExtension[] = [];
  private results: MarketplaceExtension[] = [];
  private resultTotal = 0;

  private tab: Tab = "installed";
  private installedFilter: InstalledFilter = "all";
  private sort: Sort = "relevance";
  private registry: Registry = "open-vsx";

  private detail: { data: DetailData; installed: boolean } | null = null;
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
        </div>
        <div class="ext-tabs" data-ext-tabs>
          <button data-ext-tab="installed">Installed</button>
          <button data-ext-tab="marketplace">Marketplace</button>
        </div>
        <div class="ext-filters" data-ext-filters></div>
        <div class="ext-section" data-ext-section></div>
        <div class="ext-list" data-ext-list></div>
      </div>
    `;
    this.searchEl = this.el.querySelector<HTMLInputElement>("[data-ext-search]")!;
    this.tabsEl = this.el.querySelector<HTMLElement>("[data-ext-tabs]")!;
    this.filtersEl = this.el.querySelector<HTMLElement>("[data-ext-filters]")!;
    this.sectionEl = this.el.querySelector<HTMLElement>("[data-ext-section]")!;
    this.listEl = this.el.querySelector<HTMLElement>("[data-ext-list]")!;

    this.searchEl.addEventListener("input", () => {
      this.detail = null;
      window.clearTimeout(this.timer);
      if (this.tab === "marketplace") {
        this.timer = window.setTimeout(() => this.runSearch(), 300);
      } else {
        this.render();
      }
    });

    this.tabsEl.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-ext-tab]");
      if (!button?.dataset.extTab) return;
      this.setTab(button.dataset.extTab as Tab);
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
    if (this.popular.length === 0) await this.loadPopular();
    this.render();
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    this.detail = null;
    if (tab === "marketplace" && this.searchEl.value.trim()) void this.runSearch();
    this.render();
  }

  private isInstalled(id: string): boolean {
    return this.installed.some((item) => item.id === id);
  }

  private async loadPopular(): Promise<void> {
    try {
      const result = await bridge.request<MarketplaceResult>("ext.marketplace.search", {
        registry: "open-vsx",
        query: "",
        size: 30,
        sortBy: "installs",
        sortOrder: "desc",
      });
      this.popular = result.extensions;
    } catch {
      this.popular = [];
    }
  }

  private async runSearch(): Promise<void> {
    const query = this.searchEl.value.trim();
    if (!query) {
      this.results = [];
      this.resultTotal = 0;
      this.render();
      return;
    }
    const seq = ++this.searchSeq;
    this.sectionEl.textContent = "Searching…";
    this.listEl.innerHTML = "";
    try {
      const result = await bridge.request<MarketplaceResult>("ext.marketplace.search", {
        registry: this.registry,
        query,
        size: 30,
        sortBy: this.sort,
      });
      if (seq !== this.searchSeq) return;
      this.results = result.extensions;
      this.resultTotal = result.total;
      this.render();
    } catch (error: any) {
      if (seq !== this.searchSeq) return;
      this.sectionEl.textContent = "Marketplace";
      this.listEl.innerHTML = `<div class="ext-empty">Search failed: ${error?.message}</div>`;
    }
  }

  // ---- rendering ----------------------------------------------------------

  private render(): void {
    this.tabsEl
      .querySelectorAll<HTMLElement>("[data-ext-tab]")
      .forEach((button) => button.classList.toggle("active", button.dataset.extTab === this.tab));

    this.renderFilters();

    if (this.detail) {
      this.renderDetail(this.detail.data, this.detail.installed);
      return;
    }
    if (this.tab === "installed") this.renderInstalled();
    else this.renderMarketplace();
  }

  private renderFilters(): void {
    this.filtersEl.innerHTML = "";
    if (this.detail) {
      this.filtersEl.style.display = "none";
      return;
    }
    this.filtersEl.style.display = "";

    if (this.tab === "installed") {
      for (const [value, label] of [
        ["all", "All"],
        ["active", "Active"],
        ["inactive", "Inactive"],
      ] as [InstalledFilter, string][]) {
        const chip = document.createElement("button");
        chip.className = "ext-chip" + (this.installedFilter === value ? " active" : "");
        chip.textContent = label;
        chip.onclick = () => {
          this.installedFilter = value;
          this.render();
        };
        this.filtersEl.append(chip);
      }
      return;
    }

    if (this.tab === "marketplace") {
      const registry = document.createElement("select");
      registry.title = "Registry";
      for (const [value, label] of [
        ["open-vsx", "Open VSX"],
        ["vscode", "VS Code Marketplace"],
      ] as [Registry, string][]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        if (this.registry === value) option.selected = true;
        registry.append(option);
      }
      registry.onchange = () => {
        this.registry = registry.value as Registry;
        if (this.searchEl.value.trim()) void this.runSearch();
        else this.render();
      };
      this.filtersEl.append(registry);
    }

    this.filtersEl.append(this.sortSelect());
  }

  private sortSelect(): HTMLElement {
    const select = document.createElement("select");
    select.title = "Sort";
    const options: [Sort, string][] = [
      ["relevance", "Relevance"],
      ["installs", "Most installed"],
    ];
    if (!options.some(([value]) => value === this.sort)) this.sort = options[0][0];
    for (const [value, label] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      if (this.sort === value) option.selected = true;
      select.append(option);
    }
    select.onchange = () => {
      this.sort = select.value as Sort;
      if (this.searchEl.value.trim()) void this.runSearch();
      else void this.loadPopular().then(() => this.render());
    };
    return select;
  }

  private renderInstalled(): void {
    const query = this.searchEl.value.trim().toLowerCase();
    let list = this.installed;
    if (this.installedFilter === "active") list = list.filter((item) => item.active);
    if (this.installedFilter === "inactive") list = list.filter((item) => !item.active);
    if (query) {
      list = list.filter(
        (item) =>
          item.displayName.toLowerCase().includes(query) || item.id.toLowerCase().includes(query)
      );
    }

    this.sectionEl.textContent = `Installed (${list.length})`;
    this.listEl.innerHTML = "";
    if (list.length === 0) {
      this.listEl.innerHTML = `<div class="ext-empty">No extensions installed.</div>`;
      return;
    }
    for (const extension of list) this.listEl.append(this.installedCard(extension));
  }

  private renderMarketplace(): void {
    const query = this.searchEl.value.trim();
    const list = query ? this.results : this.popular;

    this.sectionEl.textContent = query
      ? `Marketplace · ${this.resultTotal} results`
      : `Marketplace · popular`;
    this.listEl.innerHTML = "";
    if (list.length === 0) {
      this.listEl.innerHTML = `<div class="ext-empty">${
        query ? "No extensions found." : "Type to search the marketplace."
      }</div>`;
      return;
    }
    for (const extension of list) this.listEl.append(this.marketplaceCard(extension));
  }

  // ---- detail -------------------------------------------------------------

  private async openDetail(id: string): Promise<void> {
    const installed = this.isInstalled(id);
    this.listEl.innerHTML = `<div class="ext-empty">Loading…</div>`;
    try {
      const detail: DetailData = installed
        ? await bridge.request<DetailData>("ext.detail", { id })
        : await bridge.request<DetailData>("ext.marketplace.detail", {
            registry: this.registry,
            id,
          });
      this.detail = { data: detail, installed };
      this.render();
    } catch (error: any) {
      this.listEl.innerHTML = `<div class="ext-empty">Failed to load details: ${error?.message}</div>`;
    }
  }

  private renderDetail(detail: DetailData, installed: boolean): void {
    this.sectionEl.textContent = "";
    this.listEl.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "ext-detail";

    const back = document.createElement("button");
    back.className = "ext-back";
    back.innerHTML = `${icons.chevronLeft}<span>Back</span>`;
    back.onclick = () => {
      this.detail = null;
      this.render();
    };
    wrapper.append(back);

    const header = document.createElement("div");
    header.className = "ext-detail-header";
    header.append(this.iconElement(detail.iconUrl));

    const info = document.createElement("div");
    info.className = "ext-detail-info";

    const name = document.createElement("h2");
    name.className = "ext-detail-name";
    name.textContent = detail.displayName;

    const meta = document.createElement("div");
    meta.className = "ext-meta";
    meta.textContent =
      `${detail.id} · v${detail.version} · ${formatDownloads(detail.downloads)} installs` +
      `${detail.rating ? ` · ${detail.rating.toFixed(1)}/5` : ""}`;

    const description = document.createElement("div");
    description.className = "ext-desc";
    description.textContent = detail.description || "";

    const actions = document.createElement("div");
    actions.className = "ext-actions";
    this.buildActions(actions, detail, installed);

    info.append(name, meta, description, actions);
    header.append(info);
    wrapper.append(header);

    const tags: string[] = [];
    if (detail.categories?.length) tags.push(...detail.categories);
    if (detail.license) tags.push(detail.license);
    if (tags.length > 0) {
      const tagRow = document.createElement("div");
      tagRow.className = "ext-tags";
      for (const tag of tags) {
        const chip = document.createElement("span");
        chip.className = "ext-tag";
        chip.textContent = tag;
        tagRow.append(chip);
      }
      wrapper.append(tagRow);
    }

    if (detail.repository) {
      const repo = document.createElement("a");
      repo.className = "ext-repo";
      repo.href = detail.repository;
      repo.target = "_blank";
      repo.rel = "noopener noreferrer";
      repo.textContent = detail.repository;
      wrapper.append(repo);
    }

    const readme = document.createElement("div");
    readme.className = "markdown ext-readme";
    readme.innerHTML =
      renderMarkdown(detail.readme, detail.readmeIsHtml) ||
      `<p class="ext-empty">No README available.</p>`;
    readme.querySelectorAll("a").forEach((link) => {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
    wrapper.append(readme);

    this.listEl.append(wrapper);
    this.listEl.scrollTop = 0;
  }

  private buildActions(actions: HTMLElement, detail: DetailData, installed: boolean): void {
    if (installed) {
      if (detail.commands?.length) {
        const run = document.createElement("button");
        run.className = "ext-btn";
        run.textContent = `Run command (${detail.commands.length})`;
        run.onclick = async (event) => {
          event.stopPropagation();
          const choice = await showQuickPick(
            detail.commands!.map((command) => ({
              label: command.title,
              description: command.command,
              command: command.command,
            }))
          );
          if (choice) this.onRunCommand(detail.id, choice.command);
        };
        actions.append(run);
      }
      const remove = document.createElement("button");
      remove.className = "ext-btn";
      remove.textContent = "Uninstall";
      remove.onclick = async (event) => {
        event.stopPropagation();
        remove.disabled = true;
        try {
          await bridge.request("ext.uninstall", { id: detail.id });
        } finally {
          this.detail = null;
          await this.refresh();
          this.onChanged?.();
        }
      };
      actions.append(remove);
      return;
    }

    const install = document.createElement("button");
    install.className = "ext-btn primary";
    install.textContent = "Install";
    install.onclick = async (event) => {
      event.stopPropagation();
      install.disabled = true;
      install.textContent = "Installing…";
      try {
        await bridge.request("ext.marketplace.install", { downloadUrl: detail.downloadUrl });
        this.detail = null;
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
  }

  // ---- cards --------------------------------------------------------------

  private installedCard(extension: ExtensionInfo): HTMLElement {
    const card = this.card({
      iconUrl: extension.icon
        ? `${httpBase()}/ext-asset?ext=${encodeURIComponent(extension.id)}&path=${encodeURIComponent(extension.icon)}`
        : undefined,
      name: extension.displayName,
      version: extension.version,
      description: extension.runtime ? "Extension with runtime code" : "Declarative extension",
      meta: `${extension.id} · ${extension.runtime ? "runtime" : "declarative"}${
        extension.active ? " · active" : ""
      }`,
    });
    card.onclick = () => this.openDetail(extension.id);

    const actions = card.querySelector(".ext-actions")!;
    if (extension.commands.length > 0) {
      const run = document.createElement("button");
      run.className = "ext-btn";
      run.textContent = `Run command (${extension.commands.length})`;
      run.onclick = async (event) => {
        event.stopPropagation();
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
    remove.onclick = async (event) => {
      event.stopPropagation();
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
    const installed = this.isInstalled(extension.id);
    const card = this.card({
      iconUrl: extension.iconUrl,
      name: extension.displayName,
      version: extension.version,
      description: extension.description,
      meta: `${extension.id} · ${formatDownloads(extension.downloads)} installs${
        extension.rating ? ` · ${extension.rating.toFixed(1)}/5` : ""
      }`,
    });
    card.onclick = () => this.openDetail(extension.id);

    const actions = card.querySelector(".ext-actions")!;
    if (installed) {
      const badge = document.createElement("span");
      badge.className = "ext-installed";
      badge.textContent = "Installed";
      actions.append(badge);
      return card;
    }

    const install = document.createElement("button");
    install.className = "ext-btn primary";
    install.textContent = "Install";
    install.onclick = async (event) => {
      event.stopPropagation();
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
    version?: string;
    description?: string;
    meta?: string;
  }): HTMLElement {
    const card = document.createElement("div");
    card.className = "ext-card";

    const icon = this.iconElement(opts.iconUrl);

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
    meta.textContent = opts.meta || "";

    const actions = document.createElement("div");
    actions.className = "ext-actions";

    body.append(title, description, meta, actions);
    card.append(icon, body);
    return card;
  }

  private iconElement(iconUrl?: string): HTMLElement {
    const icon = document.createElement("div");
    icon.className = "ext-icon";
    if (iconUrl) {
      const img = document.createElement("img");
      img.src = iconUrl;
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
    return icon;
  }
}

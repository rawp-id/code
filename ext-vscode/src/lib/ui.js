import { h, clear, debounce, formatCount, timeAgo } from "./dom.js";
import { getRegistry, listRegistries } from "./registries/index.js";
import { downloadVsix, openVsix } from "./vsix.js";
import { analyze, buildPlugin, makePluginId } from "./converter.js";
import {
  activatePlugin,
  installConverted,
  listConverted,
  reloadPlugin,
  removeConverted,
} from "./installer.js";
import { renderMarkdown } from "./markdown.js";
import { store } from "./store.js";
import {
  detectLanguages,
  installServer,
  isLspAvailable,
  isServerEnabled,
  listCustomServers,
  planSupport,
  registerCustomServers,
  serversForRecord,
  setServerEnabled,
  syncForInstalled,
} from "./lsp.js";

const SORT_LABELS = {
  relevance: "Relevance",
  installs: "Installs",
  rating: "Rating",
  updated: "Recently updated",
};

const KIND_LABELS = {
  theme: "Theme",
  "icon-theme": "Icon pack",
  "theme+icons": "Theme + icon pack",
  language: "Language support",
  code: "Code extension",
  unsupported: "Extension",
};

let stylesInjected = false;
let pageCounter = 0;
let context = { fileIcons: null };

export function setContext(next) {
  context = { ...context, ...next };
}

function mod(name) {
  try {
    return acode.require(name);
  } catch {
    return null;
  }
}

function toast(message, ms = 3000) {
  const fn = mod("toast") || (typeof window !== "undefined" ? window.toast : null);
  if (fn) fn(message, ms);
}

function alertBox(title, message) {
  const fn = mod("alert");
  if (fn) return fn(title, message);
  window.alert(`${title}\n\n${message}`);
  return Promise.resolve();
}

function confirmBox(title, message) {
  const fn = mod("confirm");
  if (fn) return fn(title, message);
  return Promise.resolve(window.confirm(`${title}\n\n${message}`));
}

function createPage(title) {
  const Page = mod("page");
  const actionStack = mod("actionStack");
  const id = `vscmk-page-${++pageCounter}`;
  const page = Page(title);
  page.show = () => {
    actionStack?.push({ id, action: page.hide });
    (typeof app !== "undefined" ? app : document.body).append(page);
  };
  page.onhide = () => actionStack?.remove(id);
  return page;
}

// --- Styles ----------------------------------------------------------------

export function installStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.id = "vscmk-styles";
  style.textContent = `
.vscmk { display:flex; flex-direction:column; height:100%; background:var(--secondary-color); color:var(--secondary-text-color); font-size:14px; }
.vscmk * { box-sizing:border-box; }
.vscmk-toolbar { display:flex; align-items:center; gap:6px; padding:8px; background:var(--primary-color); color:var(--primary-text-color); }
.vscmk-search { flex:1; min-width:0; padding:8px 12px; border-radius:20px; border:1px solid var(--border-color); background:var(--secondary-color); color:var(--secondary-text-color); outline:none; font-size:14px; }
.vscmk-select { padding:7px 8px; border-radius:8px; border:1px solid var(--border-color); background:var(--secondary-color); color:var(--secondary-text-color); font-size:12px; }
.vscmk-iconbtn { border:none; background:transparent; color:inherit; font-size:13px; padding:6px 8px; border-radius:8px; cursor:pointer; }
.vscmk-iconbtn:active { background:rgba(127,127,127,0.2); }
.vscmk-filters { display:flex; gap:6px; padding:8px; align-items:center; flex-wrap:wrap; border-bottom:1px solid var(--border-color); }
.vscmk-tabs { display:flex; margin-left:auto; border:1px solid var(--border-color); border-radius:8px; overflow:hidden; }
.vscmk-tabs button { border:none; background:transparent; color:inherit; padding:6px 12px; font-size:12px; cursor:pointer; }
.vscmk-tabs button.active { background:var(--button-background-color); color:var(--button-text-color); }
.vscmk-list { flex:1; min-height:0; overflow-y:auto; padding:8px; -webkit-overflow-scrolling:touch; }
.vscmk-card { display:flex; gap:10px; padding:10px; margin-bottom:8px; border-radius:12px; background:rgba(127,127,127,0.1); border:1px solid var(--border-color); cursor:pointer; }
.vscmk-card:active { background:rgba(127,127,127,0.2); }
.vscmk-card img { width:44px; height:44px; border-radius:10px; object-fit:contain; background:rgba(127,127,127,0.12); flex:none; }
.vscmk-card .body { min-width:0; flex:1; }
.vscmk-name { font-weight:600; display:flex; align-items:center; gap:6px; }
.vscmk-name .name { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.vscmk-meta { font-size:12px; opacity:0.72; margin-top:2px; }
.vscmk-meta.small { font-size:11px; opacity:0.58; }
.vscmk-desc { font-size:13px; opacity:0.88; margin-top:3px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.vscmk-badge { font-size:10px; padding:1px 6px; border-radius:10px; background:var(--active-color, var(--button-background-color)); color:#fff; flex:none; text-transform:uppercase; letter-spacing:0.4px; }
.vscmk-badge.soft { background:rgba(127,127,127,0.25); color:inherit; }
.vscmk-badge.warn { background:#b26a00; }
.vscmk-status { padding:24px 12px; text-align:center; opacity:0.75; }
.vscmk-status.small { padding:10px; font-size:12px; }
.vscmk-btn { border:none; border-radius:8px; padding:9px 14px; font-size:13px; font-weight:600; background:var(--button-background-color); color:var(--button-text-color); cursor:pointer; }
.vscmk-btn:disabled { opacity:0.5; }
.vscmk-btn.secondary { background:transparent; color:inherit; border:1px solid var(--border-color); font-weight:500; }
.vscmk-btn.danger { background:var(--danger-color, #a03300); color:#fff; }
.vscmk-progress { height:5px; border-radius:3px; background:var(--border-color); overflow:hidden; margin-top:8px; }
.vscmk-progress > i { display:block; height:100%; width:0; background:var(--active-color, var(--button-background-color)); transition:width 0.15s linear; }
.vscmk-detail { flex:1; min-height:0; overflow-y:auto; padding:12px; -webkit-overflow-scrolling:touch; }
.vscmk-hero { display:flex; gap:12px; }
.vscmk-hero img { width:64px; height:64px; border-radius:14px; object-fit:contain; background:rgba(127,127,127,0.12); flex:none; }
.vscmk-hero h2 { margin:0 0 4px; font-size:17px; }
.vscmk-stats { display:flex; gap:12px; flex-wrap:wrap; font-size:12px; opacity:0.8; margin-top:6px; }
.vscmk-actions { display:flex; gap:8px; margin:14px 0; flex-wrap:wrap; align-items:center; }
.vscmk-panel { border:1px solid var(--border-color); border-radius:12px; padding:12px; margin-bottom:12px; background:rgba(127,127,127,0.06); }
.vscmk-panel h3 { margin:0 0 8px; font-size:14px; }
.vscmk-panel ul { margin:6px 0 0; padding-left:18px; }
.vscmk-panel li { margin:2px 0; font-size:13px; }
.vscmk-tabs2 { display:flex; gap:6px; margin:8px 0; }
.vscmk-tabs2 button { flex:1; padding:8px; border-radius:8px; border:1px solid var(--border-color); background:transparent; color:inherit; font-size:13px; cursor:pointer; }
.vscmk-tabs2 button.active { background:var(--button-background-color); color:var(--button-text-color); border-color:transparent; }
.vscmk-markdown { font-size:14px; line-height:1.55; word-wrap:break-word; }
.vscmk-markdown img { max-width:100%; height:auto; border-radius:8px; }
.vscmk-markdown h1, .vscmk-markdown h2 { font-size:1.35em; border-bottom:1px solid var(--border-color); padding-bottom:4px; }
.vscmk-markdown h3 { font-size:1.15em; }
.vscmk-markdown pre { overflow:auto; padding:10px; border-radius:8px; background:rgba(0,0,0,0.2); }
.vscmk-markdown code { background:rgba(0,0,0,0.16); padding:1px 5px; border-radius:4px; font-size:0.92em; }
.vscmk-markdown pre code { background:none; padding:0; }
.vscmk-markdown table { border-collapse:collapse; display:block; overflow:auto; }
.vscmk-markdown th, .vscmk-markdown td { border:1px solid var(--border-color); padding:5px 8px; }
.vscmk-markdown a { color:var(--link-text-color); }
.vscmk-row { display:flex; justify-content:space-between; gap:10px; padding:5px 0; font-size:13px; border-bottom:1px solid var(--border-color); }
.vscmk-row:last-child { border-bottom:none; }
.vscmk-row .k { opacity:0.7; }
.vscmk-row .v { text-align:right; word-break:break-word; }
.vscmk-footer { padding:8px 12px; font-size:12px; opacity:0.7; text-align:center; }
.vscmk-check { display:flex; align-items:center; gap:8px; padding:8px 0; font-size:13px; }
.vscmk-check input { width:18px; height:18px; }
`;
  document.head.append(style);
}

// --- Cards -----------------------------------------------------------------

function placeholderIcon() {
  const span = h("span", {
    style: {
      width: "44px",
      height: "44px",
      borderRadius: "10px",
      flex: "none",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(127,127,127,0.18)",
      fontWeight: "700",
    },
  });
  return span;
}

function card(item, onClick) {
  const icon = item.iconUrl
    ? h("img", { src: item.iconUrl, alt: "", loading: "lazy" })
    : placeholderIcon();

  const badges = [];
  if (item.verified) badges.push(h("span", { class: "vscmk-badge soft" }, "verified"));
  const installed = store.isInstalled(makePluginId(item.namespace, item.name));
  if (installed) badges.push(h("span", { class: "vscmk-badge" }, "installed"));

  const metaParts = [];
  if (item.downloadCount) metaParts.push(`${formatCount(item.downloadCount)} installs`);
  if (item.rating) metaParts.push(`★ ${Number(item.rating).toFixed(1)}`);
  if (item.version) metaParts.push(`v${item.version}`);
  if (item.published) metaParts.push(timeAgo(item.published));

  return h(
    "div",
    { class: "vscmk-card", onclick: () => onClick(item) },
    icon,
    h(
      "div",
      { class: "body" },
      h("div", { class: "vscmk-name" }, h("span", { class: "name" }, item.displayName), ...badges),
      h("div", { class: "vscmk-meta" }, `${item.id} - ${metaParts.join(" · ")}`),
      item.description ? h("div", { class: "vscmk-desc" }, item.description) : null,
    ),
  );
}

// --- Marketplace page ------------------------------------------------------

export function openMarketplace(options = {}) {
  installStyles();
  const registry = getRegistry(store.get("source"));
  const page = createPage("VS Code Marketplace");

  const shell = h("div", { class: "vscmk" });
  page.appendBody(shell);

  const searchInput = h("input", {
    class: "vscmk-search",
    type: "search",
    placeholder: `Search ${registry.label}...`,
    value: options.query || "",
  });

  const sourceSelect = h(
    "select",
    {
      class: "vscmk-select",
      onchange: () => {
        store.set("source", sourceSelect.value);
        currentRegistry = getRegistry(sourceSelect.value);
        searchInput.placeholder = `Search ${currentRegistry.label}...`;
        state.page = 1;
        state.items = [];
        runSearch();
      },
    },
    ...listRegistries().map((entry) =>
      h("option", { value: entry.id, selected: entry.id === store.get("source") }, entry.label),
    ),
  );

  const sortSelect = h(
    "select",
    {
      class: "vscmk-select",
      onchange: () => {
        store.set("sort", sortSelect.value);
        state.page = 1;
        state.items = [];
        runSearch();
      },
    },
    ...Object.entries(SORT_LABELS)
      .filter(([key]) => registry.sorts.includes(key))
      .map(([key, label]) => h("option", { value: key, selected: key === store.get("sort") }, label)),
  );

  const tabSearch = h("button", { class: "active", onclick: () => switchTab("search") }, "Search");
  const tabInstalled = h("button", { onclick: () => switchTab("installed") }, "Installed");
  const tabs = h("div", { class: "vscmk-tabs" }, tabSearch, tabInstalled);

  const list = h("div", { class: "vscmk-list" });
  const footer = h("div", { class: "vscmk-footer" });

  shell.append(
    h(
      "div",
      { class: "vscmk-toolbar" },
      searchInput,
      h(
        "button",
        {
          class: "vscmk-iconbtn",
          title: "Settings",
          onclick: openSettings,
        },
        "Settings",
      ),
    ),
    h("div", { class: "vscmk-filters" }, sourceSelect, sortSelect, tabs),
    list,
    footer,
  );

  let currentRegistry = registry;
  const state = { query: options.query || "", page: 1, items: [], total: 0, loading: false, tab: "search", done: false };

  const debouncedSearch = debounce(() => {
    state.query = searchInput.value.trim();
    state.page = 1;
    state.items = [];
    runSearch();
  }, 450);
  searchInput.addEventListener("input", debouncedSearch);
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      debouncedSearch.cancel();
      state.query = searchInput.value.trim();
      state.page = 1;
      state.items = [];
      runSearch();
    }
  });

  list.addEventListener("scroll", () => {
    if (state.tab !== "search" || state.loading || state.done) return;
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 320) {
      state.page += 1;
      runSearch(true);
    }
  });

  function switchTab(tab) {
    state.tab = tab;
    tabSearch.classList.toggle("active", tab === "search");
    tabInstalled.classList.toggle("active", tab === "installed");
    clear(list);
    if (tab === "search") {
      if (state.items.length) renderItems();
      else runSearch();
    } else {
      renderInstalled();
    }
  }

  function setStatus(text, small = false) {
    clear(list).append(h("div", { class: `vscmk-status${small ? " small" : ""}` }, text));
  }

  async function runSearch(append = false) {
    if (state.loading) return;
    state.loading = true;
    if (!append) setStatus("Loading...");
    else footer.textContent = "Loading more...";

    try {
      const result = await currentRegistry.search({
        query: state.query,
        page: state.page,
        pageSize: store.get("pageSize"),
        sort: store.get("sort"),
      });
      state.total = result.total;
      if (append) state.items.push(...result.items);
      else state.items = result.items;
      state.done = state.items.length >= state.total || result.items.length === 0;
      renderItems();
      if (state.query) store.addRecent(state.query);
    } catch (error) {
      if (!append) setStatus(`Could not load extensions.\n${error.message}`);
      footer.textContent = "";
    } finally {
      state.loading = false;
    }
  }

  function renderItems() {
    clear(list);
    if (!state.items.length) {
      setStatus("No extensions found.");
      footer.textContent = "";
      return;
    }
    const frag = document.createDocumentFragment();
    for (const item of state.items) frag.append(card(item, openDetail));
    list.append(frag);
    footer.textContent = state.done
      ? `${state.items.length} of ${state.total} result(s)`
      : `${state.items.length} of ${state.total} - scroll for more`;
  }

  async function renderInstalled() {
    setStatus("Loading...");
    const dirs = await listConverted();
    const entries = new Map();
    for (const dir of dirs) entries.set(dir.id, { id: dir.id, json: dir.json });
    for (const [id, record] of Object.entries(store.data.installed)) {
      if (!entries.has(id)) entries.set(id, { id, json: null, record });
    }
    const items = [...entries.values()];
    clear(list);
    if (!items.length) {
      setStatus("No converted VS Code extensions installed yet.");
      footer.textContent = "";
      return;
    }
    const frag = document.createDocumentFragment();
    for (const entry of items) {
      frag.append(renderInstalledCard(entry, store.data.installed[entry.id] || entry.record || {}, entry.json || {}));
    }
    list.append(frag);
    footer.textContent = `${items.length} extension(s)`;
  }

  function renderInstalledCard(entry, record, json) {
    const name = json.name || record.name || entry.id;
    const version = json.version || record.version || "";
    const kind = KIND_LABELS[record.kind] || (record.kind || "extension");
    const languageOnly = record.languageOnly === true || !json;
    const recordServers = serversForRecord(record);

    const actions = [];
    if (languageOnly && recordServers.length) {
      for (const serverId of recordServers) {
        actions.push(installLspButton(serverId, record.displayName || name, renderInstalled));
      }
    } else if (!languageOnly) {
      actions.push(
        h(
          "button",
          {
            class: "vscmk-btn secondary",
            onclick: async (event) => {
              event.stopPropagation();
              try {
                await reloadPlugin(entry.id);
                toast("Reloaded");
              } catch (error) {
                toast(`Reload failed: ${error.message}`, 4000);
              }
            },
          },
          "Reload",
        ),
      );
    }

    actions.push(
      h(
        "button",
        {
          class: "vscmk-btn danger",
          onclick: async (event) => {
            event.stopPropagation();
            const ok = await confirmBox("Uninstall", `Remove "${name}"?`);
            if (!ok) return;
            await removeConverted(entry.id);
            await store.unmarkInstalled(entry.id);
            syncForInstalled(store.data.installed);
            toast("Uninstalled");
            renderInstalled();
          },
        },
        "Uninstall",
      ),
    );

    return h(
      "div",
      { class: "vscmk-card" },
      h(
        "div",
        { class: "body" },
        h("div", { class: "vscmk-name" }, h("span", { class: "name" }, name)),
        h("div", { class: "vscmk-meta" }, `${record.originalId || entry.id}${version ? ` · v${version}` : ""} · ${kind}`),
        h("div", { class: "vscmk-actions", style: { marginBottom: "0" } }, ...actions),
      ),
    );
  }

  page.on("hide", () => debouncedSearch.cancel?.());

  page.show();
  if (options.tab === "installed") switchTab("installed");
  else runSearch();

  return { page, focus: () => searchInput.focus() };
}

// --- Detail page -----------------------------------------------------------

export async function openDetail(item) {
  installStyles();
  const registry = getRegistry(item.source);
  const page = createPage(item.displayName || item.name);
  const shell = h("div", { class: "vscmk" }, h("div", { class: "vscmk-detail" }, h("div", { class: "vscmk-status" }, "Loading...")));
  page.appendBody(shell);
  const detailRoot = shell.firstChild;
  page.show();

  let detail;
  try {
    detail = await registry.detail(item);
  } catch (error) {
    clear(detailRoot).append(h("div", { class: "vscmk-status" }, `Failed to load: ${error.message}`));
    return;
  }

  page.settitle?.(detail.displayName || detail.name);
  renderDetail(detailRoot, detail, registry);
}

function renderDetail(root, detail, registry) {
  clear(root);

  const icon = detail.iconUrl ? h("img", { src: detail.iconUrl, alt: "" }) : placeholderIcon();

  const stats = [];
  if (detail.downloadCount) stats.push(`${formatCount(detail.downloadCount)} installs`);
  if (detail.rating) stats.push(`★ ${Number(detail.rating).toFixed(1)} (${formatCount(detail.ratingCount)})`);
  if (detail.version) stats.push(`v${detail.version}`);
  if (detail.published) stats.push(`Updated ${timeAgo(detail.published)}`);

  const compatibility = h("div", { class: "vscmk-panel" }, h("div", { class: "vscmk-status small" }, "Checking compatibility..."));
  const languagePanel = h("div", { class: "vscmk-panel", style: { display: "none" } });

  const actionRow = h("div", { class: "vscmk-actions" });
  const progress = h("div", { class: "vscmk-progress", style: { display: "none" } }, h("i"));

  root.append(
    h(
      "div",
      { class: "vscmk-hero" },
      icon,
      h(
        "div",
        { class: "body", style: { minWidth: "0" } },
        h("h2", {}, detail.displayName || detail.name),
        h("div", { class: "vscmk-meta" }, `${detail.id}${detail.publisher ? ` by ${detail.publisher}` : ""}`),
        h("div", { class: "vscmk-stats" }, ...stats.map((text) => h("span", {}, text))),
      ),
    ),
    actionRow,
    progress,
    compatibility,
    languagePanel,
  );

  const aboutTab = h("button", { class: "active" }, "About");
  const detailsTab = h("button", {}, "Details");
  const tabContent = h("div", { class: "vscmk-markdown" }, h("div", { class: "vscmk-status" }, "Loading README..."));
  root.append(h("div", { class: "vscmk-tabs2" }, aboutTab, detailsTab), tabContent);

  aboutTab.onclick = async () => {
    aboutTab.classList.add("active");
    detailsTab.classList.remove("active");
    clear(tabContent);
    tabContent.className = "vscmk-markdown";
    tabContent.append(h("div", { class: "vscmk-status" }, "Loading README..."));
    const readme = await registry.readme(detail).catch(() => "");
    clear(tabContent).append(
      h("div", { class: "vscmk-markdown", html: renderMarkdown(readme || "_No README available._", dirOf(detail.readmeUrl)) }),
    );
  };

  detailsTab.onclick = () => {
    detailsTab.classList.add("active");
    aboutTab.classList.remove("active");
    tabContent.className = "";
    clear(tabContent);
    tabContent.append(
      h(
        "div",
        { class: "vscmk-panel" },
        row("Identifier", detail.id),
        row("Source", registry.label),
        row("Version", detail.version || "-"),
        row("Published", detail.published ? new Date(detail.published).toLocaleString() : "-"),
        row("License", detail.license || "-"),
        detail.repository ? row("Repository", detail.repository) : null,
        detail.homepage ? row("Homepage", detail.homepage) : null,
        row("Download", detail.downloadUrl ? "VSIX" : "unavailable"),
      ),
    );
  };

  aboutTab.onclick();

  loadCompatibility();

  async function loadCompatibility() {
    let manifest = null;
    try {
      manifest = await registry.manifest(detail);
    } catch {
      manifest = null;
    }
    const analysis = analyze(manifest || { contributes: {}, publisher: detail.publisher, name: detail.name, version: detail.version });
    renderCompatibility(analysis, manifest);
    renderActions(analysis);
    renderLanguageSupport(manifest);
  }

  function renderCompatibility(analysis, manifest) {
    clear(compatibility);
    const supported = analysis.convertible;
    compatibility.append(
      h("h3", {}, "Converter"),
      h(
        "div",
        {},
        h("span", { class: `vscmk-badge ${supported ? "" : "warn"}` }, supported ? KIND_LABELS[analysis.kind] || analysis.kind : "Not supported"),
      ),
    );

    if (supported) {
      const included = [];
      if (analysis.capabilities.themes) included.push(`${analysis.capabilities.themes} editor + app theme(s)`);
      if (analysis.capabilities.iconThemes) included.push(`${analysis.capabilities.iconThemes} file icon theme(s)`);
      if (analysis.capabilities.languages) included.push(`${analysis.capabilities.languages} language(s) via a language server (LSP)`);
      if (included.length) {
        compatibility.append(h("div", { class: "vscmk-meta", style: { marginTop: "8px" } }, "Will be converted:"), ul(included));
      }
      if (analysis.partial && analysis.skipped.length) {
        compatibility.append(
          h("div", { class: "vscmk-meta", style: { marginTop: "8px" } }, "Skipped (not supported by Acode):"),
          ul(analysis.skipped),
        );
      }
    } else {
      compatibility.append(
        h(
          "div",
          { class: "vscmk-meta", style: { marginTop: "8px" } },
          "This extension relies on the VS Code runtime API. Acode plugins use a different API, so it cannot be converted automatically. This marketplace focuses on themes and icon packs.",
        ),
      );
    }
  }

  function renderLanguageSupport(manifest) {
    clear(languagePanel);
    if (!isLspAvailable()) return;

    const languages = detectLanguages(manifest);
    if (!languages.length) return;

    const plan = planSupport(detail.id, languages);
    languagePanel.style.display = "";
    languagePanel.append(
      h("h3", {}, "Language support (LSP)"),
      h("div", { class: "vscmk-meta" }, `Languages: ${languages.join(", ")}`),
    );

    const builtin = Object.entries(plan.builtin);
    if (builtin.length) {
      languagePanel.append(
        h("div", { class: "vscmk-meta", style: { marginTop: "8px" } }, "Acode already bundles a language server for:"),
        ul(builtin.map(([lang, servers]) => `${lang} - ${servers.map((server) => `${server.label}${server.enabled ? "" : " (disabled)"}`).join(", ")}`)),
        h("div", { class: "vscmk-meta small" }, "Enable it in Acode settings (LSP) to get autocomplete."),
      );
    }

    if (plan.custom.length) {
      languagePanel.append(
        h("div", { class: "vscmk-meta", style: { marginTop: "8px" } }, "This marketplace can add (installed with the extension):"),
        ul(plan.custom.map((entry) => entry.server.label)),
      );
    }

    if (!builtin.length && !plan.custom.length) {
      languagePanel.append(h("div", { class: "vscmk-meta", style: { marginTop: "8px" } }, "No Acode language server is available for these languages yet."));
    }
  }

  function renderActions(analysis) {
    clear(actionRow);
    progress.style.display = "none";

    if (!analysis.convertible) {
      actionRow.append(h("span", { class: "vscmk-meta" }, "Installation disabled"));
      return;
    }

    const pluginId = makePluginId(detail.namespace, detail.name);
    const already = store.isInstalled(pluginId);
    const installBtn = h(
      "button",
      { class: "vscmk-btn", onclick: () => startInstall(detail, registry, installBtn, analysis) },
      already ? "Reinstall" : "Install",
    );
    actionRow.append(installBtn);

    if (already) {
      const record = store.data.installed[pluginId] || {};
      if (record.languageOnly) {
        for (const serverId of serversForRecord(record)) {
          actionRow.append(installLspButton(serverId, detail.displayName, () => renderActions(analysis)));
        }
      } else {
        actionRow.append(
          h(
            "button",
            {
              class: "vscmk-btn secondary",
              onclick: async () => {
                try {
                  await reloadPlugin(pluginId);
                  toast("Reloaded");
                } catch (error) {
                  toast(`Reload failed: ${error.message}`, 4000);
                }
              },
            },
            "Reload",
          ),
        );
      }
      actionRow.append(
        h(
          "button",
          {
            class: "vscmk-btn danger",
            onclick: async () => {
              const ok = await confirmBox("Uninstall", `Remove "${detail.displayName}"?`);
              if (!ok) return;
              await removeConverted(pluginId);
              await store.unmarkInstalled(pluginId);
              syncForInstalled(store.data.installed);
              toast("Uninstalled");
              renderActions(analysis);
            },
          },
          "Uninstall",
        ),
      );
    }
  }

  async function startInstall(detailRef, registryRef, button, analysis) {
    const languageOnly =
      analysis.capabilities.languages > 0 &&
      !analysis.capabilities.themes &&
      !analysis.capabilities.iconThemes;

    if (!languageOnly && !detailRef.downloadUrl) {
      toast("No download available for this extension", 4000);
      return;
    }
    const ok = await confirmBox(
      "Install extension",
      languageOnly
        ? `Add language support for "${detailRef.displayName}" to Acode?`
        : `Download and convert "${detailRef.displayName}" for Acode?`,
    );
    if (!ok) return;

    if (languageOnly) {
      button.disabled = true;
      button.textContent = "Registering...";
      try {
        const manifest = await registryRef.manifest(detailRef).catch(() => null);
        const languages = detectLanguages(manifest || {});
        const plan = planSupport(detailRef.id, languages);
        const lspServers = registerCustomServers(plan.custom);
        const builtinIds = [];
        for (const servers of Object.values(plan.builtin)) {
          for (const builtin of servers) {
            if (!builtinIds.includes(builtin.id)) builtinIds.push(builtin.id);
          }
        }
        const installable = [...lspServers, ...builtinIds];
        const pluginId = makePluginId(detailRef.namespace, detailRef.name);

        await store.markInstalled({
          id: pluginId,
          source: detailRef.source,
          originalId: detailRef.id,
          namespace: detailRef.namespace,
          name: detailRef.name,
          displayName: detailRef.displayName,
          version: detailRef.version,
          kind: analysis.kind,
          installedAt: Date.now(),
          languageOnly: true,
          languages,
          lspServers,
        });

        if (installable.length) {
          const wantsServer = await confirmBox(
            "Language server",
            `Set up a language server for ${languages.join(", ") || detailRef.displayName}? Acode Terminal is required to download new servers.`,
          );
          if (wantsServer) {
            for (const serverId of installable) {
              try {
                await installServer(serverId);
                toast("Language server ready", 2500);
              } catch (error) {
                toast(`Language server (${serverId}): ${error.message}`, 5000);
              }
            }
          }
        } else {
          toast("Language registered. No Acode language server is available for it yet.", 4500);
        }

        toast(`Added language support for ${detailRef.displayName}`, 3000);
        button.textContent = "Installed";
        renderActions(analysis);
      } catch (error) {
        await alertBox("Could not add language support", error.message || String(error));
        button.disabled = false;
        button.textContent = "Install";
      }
      return;
    }

    button.disabled = true;
    button.textContent = "Downloading...";
    progress.style.display = "block";
    const bar = progress.firstChild;

    try {
      const buffer = await downloadVsix(detailRef.downloadUrl, (event) => {
        if (event.total) {
          const percent = Math.round((event.loaded / event.total) * 100);
          bar.style.width = `${percent}%`;
          button.textContent = `Downloading ${percent}%`;
        } else {
          button.textContent = `Downloading ${(event.loaded / 1048576).toFixed(1)} MB`;
        }
      });

      button.textContent = "Converting...";
      bar.style.width = "100%";
      const pkg = await openVsix(buffer);
      const built = await buildPlugin(pkg, { source: detailRef.source });
      if (!built.convertible) {
        throw new Error("This extension cannot be converted to an Acode plugin.");
      }

      button.textContent = "Installing...";
      await installConverted(built, {
        onProgress: ({ loaded, total }) => {
          bar.style.width = `${Math.round((loaded / total) * 100)}%`;
        },
      });

      let lspServers = [];
      let languages = [];
      try {
        languages = detectLanguages(pkg.manifest);
        lspServers = registerCustomServers(planSupport(detailRef.id, languages).custom);
      } catch (error) {
        console.warn("[vscmk] could not register language servers", error);
      }

      await store.markInstalled({
        id: built.id,
        source: detailRef.source,
        originalId: detailRef.id,
        namespace: detailRef.namespace,
        name: detailRef.name,
        displayName: detailRef.displayName,
        version: pkg.version,
        kind: built.report.kind,
        installedAt: Date.now(),
        languages,
        lspServers,
      });

      if (lspServers.length && isLspAvailable()) {
        const wantsServer = await confirmBox(
          "Language server",
          "Install the language server for this extension? Acode Terminal is required.",
        );
        if (wantsServer) {
          for (const serverId of lspServers) {
            try {
              await installServer(serverId);
              toast("Language server installed", 3000);
            } catch (error) {
              toast(`Language server: ${error.message}`, 5000);
            }
          }
        }
      }

      if (store.get("autoActivate")) {
        button.textContent = "Activating...";
        try {
          await activatePlugin(built.id, { fileIcons: context.fileIcons, firstInit: true });
        } catch (error) {
          toast("Installed. Restart Acode to activate it.", 5000);
        }
      }

      toast(`Installed ${detailRef.displayName}`, 3000);
      button.textContent = "Installed";
      renderActions(analysis);
    } catch (error) {
      await alertBox("Installation failed", error.message || String(error));
      button.disabled = false;
      button.textContent = "Install";
    } finally {
      progress.style.display = "none";
    }
  }
}

// --- Settings page ---------------------------------------------------------

export function openSettings() {
  installStyles();
  const page = createPage("Marketplace settings");
  const content = h("div", { class: "vscmk" }, h("div", { class: "vscmk-detail" }));
  const body = content.firstChild;
  page.appendBody(content);

  const sourceSelect = h(
    "select",
    { class: "vscmk-select", onchange: () => store.set("source", sourceSelect.value) },
    ...listRegistries().map((entry) => h("option", { value: entry.id, selected: entry.id === store.get("source") }, entry.label)),
  );

  const autoActivate = h("input", {
    type: "checkbox",
    checked: store.get("autoActivate"),
    onchange: () => store.set("autoActivate", autoActivate.checked),
  });

  const lspPanel = h("div", { class: "vscmk-panel" });
  const refreshLsp = () => {
    clear(lspPanel);
    lspPanel.append(h("h3", {}, "Language servers (LSP)"), ...lspSettingsSection(refreshLsp));
  };
  refreshLsp();

  body.append(
    h("div", { class: "vscmk-panel" }, h("h3", {}, "General"), h("div", { class: "vscmk-row" }, h("span", { class: "k" }, "Default registry"), h("span", { class: "v", style: { marginLeft: "auto" } }, sourceSelect))),
    h("div", { class: "vscmk-panel" }, h("h3", {}, "Installation"), h("label", { class: "vscmk-check" }, autoActivate, "Activate converted plugins immediately after install")),
    lspPanel,
    h(
      "div",
      { class: "vscmk-panel" },
      h("h3", {}, "About"),
      h(
        "div",
        { class: "vscmk-meta" },
        "VS Code Marketplace for Acode converts declarative VS Code extensions (color themes and file icon themes) into native Acode plugins. Extensions that ship runtime code cannot be converted because the extension APIs differ.",
      ),
    ),
  );

  page.show();
}

// --- Registration ----------------------------------------------------------

export function registerSidebar() {
  installStyles();
  const sidebarApps = mod("sidebarApps");
  if (!sidebarApps) return null;
  return sidebarApps.add(
    "shop",
    "vscmk-marketplace",
    "VS Code Market",
    (container) => {
      container.append(
        h(
          "div",
          { style: { padding: "12px", display: "flex", flexDirection: "column", gap: "8px" } },
          h("div", { style: { fontWeight: "600" } }, "VS Code Marketplace"),
          h("div", { class: "vscmk-meta" }, "Browse VS Code themes and icon packs, converted for Acode."),
          h("button", { class: "vscmk-btn", onclick: () => openMarketplace() }, "Browse extensions"),
        ),
      );
    },
    false,
    () => {},
  );
}

export function registerCommand() {
  const commands = mod("commands");
  if (!commands?.addCommand) return;
  commands.addCommand({
    name: "vscode-marketplace.open",
    description: "VS Code Marketplace: Browse extensions",
    exec: () => {
      openMarketplace();
      return true;
    },
  });
  commands.addCommand({
    name: "vscode-marketplace.installed",
    description: "VS Code Marketplace: Installed converted plugins",
    exec: () => {
      openMarketplace({ tab: "installed" });
      return true;
    },
  });
}

// --- Misc ------------------------------------------------------------------

function row(key, value) {
  return h("div", { class: "vscmk-row" }, h("span", { class: "k" }, key), h("span", { class: "v" }, String(value)));
}

function ul(items) {
  return h("ul", {}, ...items.map((text) => h("li", {}, text)));
}

function installLspButton(serverId, label, onChange) {
  const button = h(
    "button",
    {
      class: "vscmk-btn secondary",
      onclick: async () => {
        button.disabled = true;
        button.textContent = "Installing...";
        try {
          const result = await installServer(serverId);
          toast(result.alreadyInstalled ? `${label} is already installed` : `${label} language server installed`, 3000);
          button.textContent = "Installed";
          onChange?.();
        } catch (error) {
          toast(`Could not install ${label}: ${error.message}`, 5000);
          button.disabled = false;
          button.textContent = "Install server";
        }
      },
    },
    "Install server",
  );
  return button;
}

function lspSettingsSection(onChange) {
  if (!isLspAvailable()) {
    return [
      h(
        "div",
        { class: "vscmk-meta" },
        "This Acode version does not expose the LSP API. Update Acode to enable language-server autocomplete for converted extensions.",
      ),
    ];
  }

  const nodes = [];
  const custom = listCustomServers();
  if (custom.length) {
    nodes.push(h("div", { class: "vscmk-meta" }, "Added by installed marketplace extensions:"));
    for (const server of custom) {
      const enabled = isServerEnabled(server.id);
      const toggle = h(
        "button",
        {
          class: "vscmk-btn secondary",
          onclick: async () => {
            const next = !isServerEnabled(server.id);
            await setServerEnabled(server.id, next);
            toast(`${server.label} ${next ? "enabled" : "disabled"}`, 2500);
            onChange?.();
          },
        },
        enabled ? "Disable" : "Enable",
      );
      nodes.push(
        h(
          "div",
          { class: "vscmk-actions", style: { marginTop: "6px" } },
          h(
            "span",
            { class: "vscmk-meta", style: { alignSelf: "center", flex: "1" } },
            `${server.label} - ${(server.languages || []).join(", ")}${enabled ? " (enabled)" : ""}`,
          ),
          installLspButton(server.id, server.label, onChange),
          toggle,
        ),
      );
    }
  } else {
    nodes.push(
      h(
        "div",
        { class: "vscmk-meta" },
        "No extra language servers yet. Install a supported language extension to add one.",
      ),
    );
  }
  nodes.push(
    h(
      "div",
      { class: "vscmk-meta small", style: { marginTop: "8px" } },
      "Acode's bundled language servers and their settings live in Acode settings (LSP).",
    ),
  );
  return nodes;
}

function dirOf(url) {
  if (!url) return "";
  return String(url).replace(/[^/]*$/, "");
}

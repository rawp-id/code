/**
 * LSP bridge for the marketplace.
 *
 * Acode ships a full LSP client (exposed to plugins as `acode.require("lsp")`)
 * plus runtime providers that can launch language servers (built-in Alpine,
 * external WebSocket, or bundled Web Workers).
 *
 * A VS Code extension can never run its own language server 1:1, but many
 * language extensions map to a server Acode can run. This module:
 *   - reports which built-in Acode servers cover an extension's languages, and
 *   - registers a small curated catalog of "custom" servers for languages
 *     Acode does not bundle (Vue, Svelte, Astro, YAML, ...).
 *
 * Everything here is defensive: if the running Acode has no LSP API, the
 * marketplace keeps working and simply hides the language-support UI.
 */

import { store } from "./store.js";
import { LSP_SERVER_CATALOG } from "./lsp-catalog.js";

const CUSTOM_PREFIX = "vscmk-";

let cachedApi;

/** Return Acode's `lsp` module, or null when unavailable. */
export function getLspApi() {
  if (cachedApi !== undefined) return cachedApi;
  try {
    cachedApi =
      typeof acode !== "undefined" && typeof acode.require === "function"
        ? acode.require("lsp")
        : null;
  } catch {
    cachedApi = null;
  }
  return cachedApi;
}

export function isLspAvailable() {
  const api = getLspApi();
  return Boolean(api && api.defineServer && api.register && api.servers);
}

/** Unique, lowercased language ids declared by a package.json manifest. */
export function detectLanguages(manifest) {
  const contributes = (manifest && manifest.contributes) || {};
  const list = Array.isArray(contributes.languages) ? contributes.languages : [];
  const ids = [];
  for (const entry of list) {
    const id = String((entry && entry.id) || "")
      .trim()
      .toLowerCase();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Built-in Acode servers that can serve a language id (disabled included). */
export function builtinServersForLanguage(languageId) {
  const api = getLspApi();
  const lang = String(languageId || "").trim().toLowerCase();
  if (!lang || !api?.servers?.listForLanguage) return [];
  try {
    return api.servers
      .listForLanguage(lang, { includeDisabled: true })
      .filter((server) => !String(server.id).startsWith(CUSTOM_PREFIX));
  } catch {
    return [];
  }
}

/**
 * Compare an extension's languages with what Acode can run.
 * @returns {{ languages: string[], custom: object[], builtin: Record<string, object[]> }}
 */
export function planSupport(extensionId, languages) {
  const id = String(extensionId || "").toLowerCase();
  const langs = (languages || []).map((lang) => String(lang).toLowerCase());
  const custom = [];
  for (const entry of LSP_SERVER_CATALOG) {
    const byExtension = (entry.match.extensions || []).includes(id);
    const byLanguage = (entry.match.languages || []).some((lang) => langs.includes(lang));
    if (byExtension || byLanguage) custom.push(entry);
  }

  const builtin = {};
  for (const lang of langs) {
    const servers = builtinServersForLanguage(lang);
    if (servers.length) {
      builtin[lang] = servers.map((server) => ({
        id: server.id,
        label: server.label,
        enabled: Boolean(server.enabled),
      }));
    }
  }

  return { languages: langs, custom, builtin };
}

/** Register the given catalog entries with Acode's LSP registry. */
export function registerCustomServers(entries) {
  const api = getLspApi();
  if (!isLspAvailable() || !api.defineServer) return [];
  const registered = [];
  for (const entry of entries) {
    try {
      // `defineServer` normalises the manifest (websocket transport + Alpine
      // bridge). A raw object would be rejected by the registry.
      const manifest = api.defineServer(entry.server);
      manifest.priority = 10;
      manifest.enabled = store.data.lspEnabled?.[entry.server.id] === true;
      api.upsert(manifest);
      registered.push(entry.server.id);
    } catch (error) {
      console.warn("[vscmk] could not register language server", entry.server.id, error);
    }
  }
  return registered;
}

export function unregisterCustomServers(ids) {
  const api = getLspApi();
  if (!api?.servers?.unregister) return;
  for (const id of ids || []) {
    try {
      api.servers.unregister(id);
    } catch {
      /* ignore */
    }
  }
}

/** List the language servers currently registered by this plugin. */
export function listCustomServers() {
  const api = getLspApi();
  if (!api?.servers?.list) return [];
  try {
    return api.servers.list().filter((server) => String(server.id).startsWith(CUSTOM_PREFIX));
  } catch {
    return [];
  }
}

/**
 * All custom language-server ids associated with an installed record,
 * including mappings added after the record was written.
 */
export function serversForRecord(record) {
  const ids = new Set(record?.lspServers || []);
  const plan = planSupport(record?.originalId || record?.id, record?.languages || []);
  for (const entry of plan.custom) ids.add(entry.server.id);
  return [...ids];
}

/**
 * Make the LSP registry match the set of installed marketplace plugins.
 * Call on init, after install, and after uninstall.
 */
export function syncForInstalled(installed) {
  if (!isLspAvailable()) return [];
  const wanted = new Set();
  for (const record of Object.values(installed || {})) {
    for (const id of serversForRecord(record)) wanted.add(id);
  }

  const entries = LSP_SERVER_CATALOG.filter((entry) => wanted.has(entry.server.id));
  registerCustomServers(entries);

  for (const server of listCustomServers()) {
    if (!wanted.has(server.id)) unregisterCustomServers([server.id]);
  }

  // Re-apply persisted enable state. This also covers Acode's built-in servers
  // (e.g. clangd, gopls) that a marketplace language extension turned on.
  const api = getLspApi();
  for (const [id, enabled] of Object.entries(store.data.lspEnabled || {})) {
    try {
      api?.servers?.update?.(id, () => ({ enabled: Boolean(enabled) }));
    } catch {
      /* server not registered in this Acode build */
    }
  }

  return entries.map((entry) => entry.server.id);
}

/** Enable or disable a registered language server (persisted across restarts). */
export async function setServerEnabled(serverId, enabled) {
  const api = getLspApi();
  store.data.lspEnabled = store.data.lspEnabled || {};
  if (enabled) store.data.lspEnabled[serverId] = true;
  else delete store.data.lspEnabled[serverId];
  await store.save();
  try {
    api?.servers?.update?.(serverId, () => ({ enabled: Boolean(enabled) }));
  } catch (error) {
    console.warn("[vscmk] could not toggle language server", serverId, error);
  }
}

/** Try to install a language server binary through its runtime provider. */
export async function installServer(serverId) {
  const api = getLspApi();
  if (!isLspAvailable() || !api.servers?.get || !api.runtimes?.select) {
    throw new Error("This Acode version does not expose the LSP API.");
  }

  const server = api.servers.get(serverId);
  if (!server) throw new Error("Language server is not registered.");

  const context = { runtimeAction: "install" };
  const provider = await api.runtimes.select(server, context);
  if (!provider) throw new Error("No runtime is available to run this language server.");

  if (typeof provider.checkInstallation === "function") {
    const status = await provider.checkInstallation(server, context);
    if (status && status.status === "present") {
      await setServerEnabled(serverId, true);
      return { alreadyInstalled: true, version: status.version || null };
    }
  }

  if (typeof provider.install !== "function") {
    throw new Error("This runtime cannot install the language server automatically.");
  }

  const ok = await provider.install(server, context, "install");
  if (ok) await setServerEnabled(serverId, true);
  return { alreadyInstalled: false, ok: Boolean(ok) };
}

export function isServerEnabled(serverId) {
  return store.data.lspEnabled?.[serverId] === true;
}

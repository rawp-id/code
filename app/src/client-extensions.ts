import { unzipSync, strFromU8 } from "fflate";
import type { ExtensionInfo } from "./bridge";

export interface ClientMarketplaceExtension {
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

export interface ClientMarketplaceResult {
  extensions: ClientMarketplaceExtension[];
  total: number;
}

export interface ClientMarketplaceDetail extends ClientMarketplaceExtension {
  readme?: string;
  changelog?: string;
  readmeIsHtml?: boolean;
  repository?: string;
  license?: string;
  categories?: string[];
  commands?: { command: string; title: string }[];
}

interface StoredExtension {
  id: string;
  name: string;
  displayName: string;
  publisher: string;
  version: string;
  icon?: string;
  iconUrl?: string;
  manifest: any;
  files: Record<string, string>;
  disabled?: boolean;
}

const DB_NAME = "kode-extensions-db";
const STORE_NAME = "extensions";
const LS_FALLBACK_KEY = "kode.client_extensions_summary";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(): Promise<StoredExtension[]> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

async function idbSet(item: StoredExtension): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* fallback to in-memory */
  }
}

async function idbDelete(id: string): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* ignore */
  }
}

class ClientExtensionService {
  private extensions = new Map<string, StoredExtension>();
  private initialized = false;

  constructor() {
    this.loadFallback();
    void this.initIndexedDb();
  }

  private loadFallback(): void {
    try {
      const raw = localStorage.getItem(LS_FALLBACK_KEY);
      if (!raw) return;
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item?.id && !this.extensions.has(item.id)) {
            this.extensions.set(item.id, item);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  private saveFallback(): void {
    try {
      // Save lightweight summary to localStorage (without heavy files)
      const list = [...this.extensions.values()].map((e) => ({
        id: e.id,
        name: e.name,
        displayName: e.displayName,
        publisher: e.publisher,
        version: e.version,
        icon: e.icon,
        iconUrl: e.iconUrl,
        manifest: e.manifest,
        disabled: e.disabled,
        files: Object.fromEntries(
          Object.entries(e.files || {}).filter(([k]) => k.endsWith(".json"))
        ),
      }));
      localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  }

  private async initIndexedDb(): Promise<void> {
    const items = await idbGetAll();
    for (const item of items) {
      if (item?.id) this.extensions.set(item.id, item);
    }
    this.initialized = true;
  }

  async searchMarketplace(
    query: string,
    size = 30,
    offset = 0,
    sortBy?: string,
    sortOrder?: string
  ): Promise<ClientMarketplaceResult> {
    try {
      const params = new URLSearchParams({
        query: query.trim(),
        size: String(size),
        offset: String(offset || 0),
      });
      // Open VSX uses `downloadCount`; accept the UI's friendlier `installs`.
      if (sortBy) {
        const sortMap: Record<string, string> = {
          installs: "downloadCount",
          rating: "relevance",
          updated: "timestamp",
        };
        const value = sortMap[sortBy] ?? sortBy;
        if (value) {
          params.set("sortBy", value);
          params.set("sortOrder", sortOrder || "desc");
        }
      }

      const res = await fetch(`https://open-vsx.org/api/-/search?${params}`);
      if (!res.ok) throw new Error(`Marketplace returned HTTP ${res.status}`);
      const data = await res.json();

      const extensions: ClientMarketplaceExtension[] = (data.extensions || []).map((ext: any) => ({
        id: `${ext.namespace}.${ext.name}`,
        namespace: ext.namespace,
        name: ext.name,
        displayName: ext.displayName || ext.name,
        description: ext.description || "",
        version: ext.version || "0.0.0",
        downloads: ext.downloadCount || 0,
        rating: ext.averageRating || 0,
        publisher: ext.namespace,
        iconUrl: ext.files?.icon,
        downloadUrl: ext.files?.download,
      }));

      return {
        extensions,
        total: data.totalSize || extensions.length,
      };
    } catch (err: any) {
      console.warn("[ClientMarketplace] search error:", err);
      return { extensions: [], total: 0 };
    }
  }

  async getMarketplaceDetail(id: string): Promise<ClientMarketplaceDetail> {
    const [namespace, name] = id.split(".");
    if (!namespace || !name) throw new Error("Invalid extension ID");

    const res = await fetch(`https://open-vsx.org/api/${namespace}/${name}`);
    if (!res.ok) throw new Error(`Failed to load details for ${id}`);
    const data = await res.json();

    return {
      id,
      namespace,
      name,
      displayName: data.displayName || name,
      description: data.description || "",
      version: data.version || "0.0.0",
      downloads: data.downloadCount || 0,
      rating: data.averageRating || 0,
      publisher: namespace,
      iconUrl: data.files?.icon,
      downloadUrl: data.files?.download,
      readme: data.readme,
      changelog: data.changelog,
      repository: data.repository,
      license: data.license,
      categories: data.categories,
    };
  }

  async installVsix(
    downloadUrl: string,
    iconUrl?: string,
    onProgress?: (received: number, total: number, done: boolean) => void
  ): Promise<ExtensionInfo> {
    onProgress?.(0, 100, false);
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`Download failed with HTTP ${res.status}`);

    const buffer = await res.arrayBuffer();
    onProgress?.(40, 100, false);

    const unzipped = unzipSync(new Uint8Array(buffer));
    onProgress?.(70, 100, false);

    // Look for extension/package.json
    const manifestKey = Object.keys(unzipped).find(
      (k) => k === "extension/package.json" || k.endsWith("/package.json")
    );
    if (!manifestKey) throw new Error("Invalid VSIX: package.json missing");

    const manifest = JSON.parse(strFromU8(unzipped[manifestKey]));
    const publisher = manifest.publisher || "local";
    const name = manifest.name;
    const id = `${publisher}.${name}`;

    // Collect targeted file paths (avoid unpacking thousands of unneeded files)
    const needed = new Set<string>();
    for (const theme of manifest.contributes?.themes || []) {
      if (theme.path) needed.add(theme.path.replace(/^\.?\//, ""));
    }
    for (const it of manifest.contributes?.iconThemes || []) {
      if (it.path) needed.add(it.path.replace(/^\.?\//, ""));
    }
    for (const snip of manifest.contributes?.snippets || []) {
      if (snip.path) needed.add(snip.path.replace(/^\.?\//, ""));
    }
    if (manifest.icon) needed.add(manifest.icon.replace(/^\.?\//, ""));

    // Extract relevant files (themes, icons, configs, readmes)
    const files: Record<string, string> = {};
    let iconDataUrl = iconUrl;

    for (const [key, rawBytes] of Object.entries(unzipped)) {
      const rel = key.replace(/^extension\//, "");
      const isNeeded =
        needed.has(rel) ||
        rel.toLowerCase() === "readme.md" ||
        rel.toLowerCase() === "changelog.md" ||
        (manifest.contributes?.iconThemes && (rel.endsWith(".json") || rel.endsWith(".svg")));

      if (isNeeded) {
        try {
          files[rel] = strFromU8(rawBytes);
        } catch {
          /* ignore non-utf8 */
        }
      }

      // Extract icon as data URL if not provided via iconUrl
      if (!iconDataUrl && manifest.icon) {
        const cleanIcon = manifest.icon.replace(/^\.?\//, "");
        if (rel === cleanIcon || key.endsWith(cleanIcon)) {
          const mime = rel.endsWith(".svg")
            ? "image/svg+xml"
            : rel.endsWith(".png")
              ? "image/png"
              : "image/jpeg";
          let binary = "";
          for (let i = 0; i < rawBytes.length; i++) binary += String.fromCharCode(rawBytes[i]);
          iconDataUrl = `data:${mime};base64,${btoa(binary)}`;
        }
      }
    }

    const effectiveIcon = iconDataUrl || iconUrl || manifest.icon;

    const stored: StoredExtension = {
      id,
      name,
      displayName: manifest.displayName || name,
      publisher,
      version: manifest.version || "0.0.0",
      icon: effectiveIcon,
      iconUrl: effectiveIcon,
      manifest,
      files,
      disabled: false,
    };

    this.extensions.set(id, stored);
    await idbSet(stored);
    this.saveFallback();
    onProgress?.(100, 100, true);

    return {
      id,
      name,
      displayName: stored.displayName,
      publisher,
      version: stored.version,
      dir: "client-storage",
      active: true,
      runtime: Boolean(manifest.main),
      disabled: false,
      icon: effectiveIcon,
      commands: (manifest.contributes?.commands || []).map((c: any) => ({
        command: c.command,
        title: c.title || c.command,
      })),
    };
  }

  list(): ExtensionInfo[] {
    return [...this.extensions.values()].map((ext) => ({
      id: ext.id,
      name: ext.name,
      displayName: ext.displayName,
      publisher: ext.publisher,
      version: ext.version,
      dir: "client-storage",
      active: true,
      runtime: Boolean(ext.manifest?.main),
      disabled: Boolean(ext.disabled),
      icon: ext.icon || ext.iconUrl,
      commands: (ext.manifest?.contributes?.commands || []).map((c: any) => ({
        command: c.command,
        title: c.title || c.command,
      })),
    }));
  }

  detail(id: string): any {
    const ext = this.extensions.get(id);
    if (!ext) return null;
    return {
      id: ext.id,
      namespace: ext.publisher,
      name: ext.name,
      displayName: ext.displayName,
      description: ext.manifest?.description || "",
      version: ext.version,
      downloads: 0,
      rating: 5,
      publisher: ext.publisher,
      iconUrl: ext.icon || ext.iconUrl,
      readme: ext.files["README.md"] || ext.files["readme.md"] || "",
      changelog: ext.files["CHANGELOG.md"] || "",
      categories: ext.manifest?.categories || [],
      commands: (ext.manifest?.contributes?.commands || []).map((c: any) => ({
        command: c.command,
        title: c.title || c.command,
      })),
    };
  }

  enable(id: string): void {
    const ext = this.extensions.get(id);
    if (ext) {
      ext.disabled = false;
      void idbSet(ext);
      this.saveFallback();
    }
  }

  disable(id: string): void {
    const ext = this.extensions.get(id);
    if (ext) {
      ext.disabled = true;
      void idbSet(ext);
      this.saveFallback();
    }
  }

  uninstall(id: string): boolean {
    const deleted = this.extensions.delete(id);
    void idbDelete(id);
    this.saveFallback();
    return deleted;
  }

  listThemes(): { id: string; label: string; extensionId: string; path: string }[] {
    const results: { id: string; label: string; extensionId: string; path: string }[] = [];
    for (const ext of this.extensions.values()) {
      if (ext.disabled) continue;
      for (const theme of ext.manifest?.contributes?.themes || []) {
        if (!theme?.path) continue;
        results.push({
          id: `client:${ext.id}:${theme.path}`,
          label: theme.label || theme.path,
          extensionId: ext.id,
          path: theme.path,
        });
      }
    }
    return results;
  }

  readTheme(extensionId: string, themePath: string): any {
    const ext = this.extensions.get(extensionId);
    if (!ext) throw new Error("Unknown extension");
    const cleanPath = themePath.replace(/^\.\//, "");
    const raw = ext.files[cleanPath] || ext.files[themePath];
    if (!raw) throw new Error(`Theme file not found: ${themePath}`);
    return JSON.parse(raw);
  }

  listIconThemes(): { id: string; label: string; extensionId: string; path: string }[] {
    const results: { id: string; label: string; extensionId: string; path: string }[] = [];
    for (const ext of this.extensions.values()) {
      if (ext.disabled) continue;
      for (const theme of ext.manifest?.contributes?.iconThemes || []) {
        if (!theme?.path) continue;
        results.push({
          id: `client:${ext.id}:${theme.path}`,
          label: theme.label || theme.path,
          extensionId: ext.id,
          path: theme.path,
        });
      }
    }
    return results;
  }

  readIconTheme(extensionId: string, themePath: string): any {
    const ext = this.extensions.get(extensionId);
    if (!ext) throw new Error("Unknown extension");
    const cleanPath = themePath.replace(/^\.\//, "");
    const raw = ext.files[cleanPath] || ext.files[themePath];
    if (!raw) throw new Error(`Icon theme file not found: ${themePath}`);
    const theme = JSON.parse(raw);
    const definitions = theme.iconDefinitions || {};

    const resolveIcon = (iconId?: string): string | null => {
      if (!iconId || !definitions[iconId]) return null;
      const iconPath = definitions[iconId].iconPath;
      if (!iconPath) return null;
      const normalized = iconPath.replace(/^\.\//, "");
      const baseDir = cleanPath.slice(0, cleanPath.lastIndexOf("/"));
      const candidate = baseDir ? `${baseDir}/${normalized}` : normalized;
      const svg = ext.files[candidate] || ext.files[normalized];
      if (svg) return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
      return null;
    };

    return {
      folder: resolveIcon(theme.folder),
      folderExpanded: resolveIcon(theme.folderExpanded),
      file: resolveIcon(theme.file),
      fileExtensions: Object.fromEntries(
        Object.entries(theme.fileExtensions || {})
          .map(([extName, id]) => [extName, resolveIcon(id as string)])
          .filter(([, url]) => Boolean(url))
      ),
      fileNames: Object.fromEntries(
        Object.entries(theme.fileNames || {})
          .map(([name, id]) => [name, resolveIcon(id as string)])
          .filter(([, url]) => Boolean(url))
      ),
    };
  }
}

export const clientExtensions = new ClientExtensionService();

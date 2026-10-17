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
  iconDataUrl?: string;
  manifest: any;
  files: Record<string, string>; // relative path -> text content (e.g. JSON themes)
  disabled?: boolean;
}

const STORAGE_KEY = "kode.client_installed_extensions";

class ClientExtensionService {
  private extensions = new Map<string, StoredExtension>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed: StoredExtension[] = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const ext of parsed) {
          if (ext && ext.id) this.extensions.set(ext.id, ext);
        }
      }
    } catch {
      /* ignore */
    }
  }

  private save(): void {
    try {
      const list = [...this.extensions.values()];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // If localStorage is full, remove large readmes from stored manifests and retry
      try {
        const compact = [...this.extensions.values()].map((e) => ({
          ...e,
          files: Object.fromEntries(
            Object.entries(e.files).filter(([k]) => k.endsWith(".json") || k.endsWith(".svg"))
          ),
        }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
      } catch {
        /* storage full */
      }
    }
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
        offset: String(offset),
      });
      if (sortBy) params.set("sortBy", sortBy);
      if (sortOrder) params.set("sortOrder", sortOrder);

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
    onProgress?: (received: number, total: number, done: boolean) => void
  ): Promise<ExtensionInfo> {
    onProgress?.(0, 100, false);
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`Download failed with HTTP ${res.status}`);

    const buffer = await res.arrayBuffer();
    onProgress?.(50, 100, false);

    const unzipped = unzipSync(new Uint8Array(buffer));
    onProgress?.(80, 100, false);

    // Look for extension/package.json
    const manifestKey = Object.keys(unzipped).find((k) => k === "extension/package.json" || k.endsWith("/package.json"));
    if (!manifestKey) throw new Error("Invalid VSIX: package.json missing");

    const manifest = JSON.parse(strFromU8(unzipped[manifestKey]));
    const publisher = manifest.publisher || "local";
    const name = manifest.name;
    const id = `${publisher}.${name}`;

    // Extract files (themes, icons, configs)
    const files: Record<string, string> = {};
    let iconDataUrl: string | undefined;

    for (const [key, rawBytes] of Object.entries(unzipped)) {
      const rel = key.replace(/^extension\//, "");
      if (rel.endsWith(".json") || rel.endsWith(".svg") || rel.endsWith(".md") || rel.endsWith(".txt")) {
        try {
          files[rel] = strFromU8(rawBytes);
        } catch {
          /* ignore non-utf8 */
        }
      }
      // Check for icon
      if (manifest.icon && (rel === manifest.icon || key.endsWith(manifest.icon))) {
        const mime = rel.endsWith(".svg") ? "image/svg+xml" : rel.endsWith(".png") ? "image/png" : "image/jpeg";
        let binary = "";
        for (let i = 0; i < rawBytes.length; i++) binary += String.fromCharCode(rawBytes[i]);
        iconDataUrl = `data:${mime};base64,${btoa(binary)}`;
      }
    }

    const stored: StoredExtension = {
      id,
      name,
      displayName: manifest.displayName || name,
      publisher,
      version: manifest.version || "0.0.0",
      icon: manifest.icon,
      iconDataUrl,
      manifest,
      files,
      disabled: false,
    };

    this.extensions.set(id, stored);
    this.save();
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
      icon: iconDataUrl || manifest.icon,
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
      icon: ext.iconDataUrl,
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
      iconUrl: ext.iconDataUrl,
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
      this.save();
    }
  }

  disable(id: string): void {
    const ext = this.extensions.get(id);
    if (ext) {
      ext.disabled = true;
      this.save();
    }
  }

  uninstall(id: string): boolean {
    const deleted = this.extensions.delete(id);
    this.save();
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

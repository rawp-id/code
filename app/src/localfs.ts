import type { DirEntry } from "./bridge";

/**
 * Client-side folder access via the File System Access API.
 *
 * When no backend server is connected the editor can still open a real folder
 * from the device (`window.showDirectoryPicker`) and read/write the actual
 * files. The directory handle is persisted in IndexedDB so the workspace can be
 * restored after a reload (subject to the browser permission prompt).
 */

const DB_NAME = "kode-local-fs";
const STORE = "handles";
const ROOT_KEY = "root";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  ".gradle",
  ".dart_tool",
  "Pods",
  ".next",
  "coverage",
]);

const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".jar",
  ".apk",
  ".so",
  ".dll",
  ".exe",
  ".wasm",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp3",
  ".mp4",
  ".mov",
  ".class",
]);

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: any): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* persistence is best-effort */
  }
}

async function idbGet(key: string): Promise<any> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

function splitPath(path: string): string[] {
  return path
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function ensurePermission(handle: any, mode: "read" | "readwrite"): Promise<boolean> {
  if (!handle?.queryPermission) return true;
  const options = { mode };
  try {
    if ((await handle.queryPermission(options)) === "granted") return true;
    return (await handle.requestPermission(options)) === "granted";
  } catch {
    return false;
  }
}

export interface LocalSearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
  wholeWord?: boolean;
  maxResults?: number;
}

export interface LocalSearchMatch {
  line: number;
  column: number;
  endColumn: number;
  text: string;
}

export interface LocalSearchFileResult {
  path: string;
  matches: LocalSearchMatch[];
}

export interface LocalSearchResult {
  files: LocalSearchFileResult[];
  matchCount: number;
  truncated: boolean;
}

export class LocalFolder {
  private handle: any = null;

  get mounted(): boolean {
    return Boolean(this.handle);
  }

  get name(): string {
    return this.handle?.name || "";
  }

  supported(): boolean {
    return typeof (window as any).showDirectoryPicker === "function";
  }

  /** Ask the user for a folder and mount it. Must run from a user gesture. */
  async pick(): Promise<string | null> {
    if (!this.supported()) return null;
    const handle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
    if (!(await ensurePermission(handle, "readwrite"))) return null;
    this.handle = handle;
    await idbPut(ROOT_KEY, handle);
    return handle.name;
  }

  /** Restore the last mounted folder when permission is still granted. */
  async restore(): Promise<string | null> {
    if (this.handle) return this.name;
    const handle = await idbGet(ROOT_KEY);
    if (!handle) return null;
    // Never trigger a permission prompt without a user gesture.
    try {
      if (handle.queryPermission && (await handle.queryPermission({ mode: "read" })) !== "granted") {
        return null;
      }
    } catch {
      return null;
    }
    this.handle = handle;
    return handle.name;
  }

  async forget(): Promise<void> {
    this.handle = null;
    await idbPut(ROOT_KEY, null);
  }

  private async dirHandle(path: string, create = false): Promise<any> {
    if (!this.handle) throw new Error("No local folder is open");
    let dir = this.handle;
    for (const part of splitPath(path)) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir;
  }

  private async fileHandle(path: string, create = false): Promise<any> {
    const parts = splitPath(path);
    const name = parts.pop();
    if (!name) throw new Error("Invalid file path");
    const dir = await this.dirHandle(parts.join("/"), create);
    return dir.getFileHandle(name, { create });
  }

  async readDir(path: string): Promise<DirEntry[]> {
    const dir = await this.dirHandle(path);
    const entries: DirEntry[] = [];
    for await (const [name, handle] of (dir as any).entries()) {
      const full = path ? `${path}/${name}` : name;
      entries.push({ name, path: full, type: handle.kind === "directory" ? "dir" : "file" });
    }
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  }

  async readFile(path: string): Promise<string> {
    const handle = await this.fileHandle(path);
    const file = await handle.getFile();
    return file.text();
  }

  async writeFile(path: string, content: string): Promise<boolean> {
    const handle = await this.fileHandle(path, true);
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return true;
  }

  async createFile(path: string): Promise<boolean> {
    return this.writeFile(path, "");
  }

  async makeDirectory(path: string): Promise<boolean> {
    await this.dirHandle(path, true);
    return true;
  }

  async remove(path: string): Promise<boolean> {
    const parts = splitPath(path);
    const name = parts.pop();
    if (!name) return false;
    const dir = await this.dirHandle(parts.join("/"));
    await dir.removeEntry(name, { recursive: true });
    return true;
  }

  async rename(from: string, to: string): Promise<boolean> {
    const handle = await this.fileHandle(from);
    const parts = splitPath(to);
    const name = parts.pop();
    if (!name) return false;
    const parent = await this.dirHandle(parts.join("/"), true);
    if (typeof handle.move === "function") {
      await handle.move(parent, name);
      return true;
    }
    const content = await this.readFile(from);
    await this.writeFile(to, content);
    await this.remove(from);
    return true;
  }

  private async walk(
    path: string,
    visit: (filePath: string) => Promise<void> | void,
    depth = 0
  ): Promise<void> {
    if (depth > 12) return;
    let dir: any;
    try {
      dir = await this.dirHandle(path);
    } catch {
      return;
    }
    for await (const [name, handle] of dir.entries()) {
      if (name.startsWith(".") && name !== ".env") continue;
      if (handle.kind === "directory") {
        if (SKIP_DIRS.has(name)) continue;
        await this.walk(path ? `${path}/${name}` : name, visit, depth + 1);
      } else {
        const dot = name.lastIndexOf(".");
        if (dot >= 0 && BINARY_EXT.has(name.slice(dot).toLowerCase())) continue;
        await visit(path ? `${path}/${name}` : name);
      }
    }
  }

  async search(query: string, options: LocalSearchOptions = {}): Promise<LocalSearchResult> {
    const result: LocalSearchResult = { files: [], matchCount: 0, truncated: false };
    if (!query) return result;
    const maxResults = options.maxResults && options.maxResults > 0 ? options.maxResults : 1000;
    let pattern: RegExp;
    try {
      const escaped = options.regex
        ? query
        : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const source = options.wholeWord ? `\\b${escaped}\\b` : escaped;
      pattern = new RegExp(source, options.caseSensitive ? "g" : "gi");
    } catch {
      return result;
    }

    await this.walk("", async (file) => {
      if (result.truncated) return;
      let text: string;
      try {
        text = await this.readFile(file);
      } catch {
        return;
      }
      if (text.length > 2_000_000) return;
      const lines = text.split("\n");
      const matches: LocalSearchMatch[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
          matches.push({
            line: i + 1,
            column: match.index,
            endColumn: match.index + match[0].length,
            text: line,
          });
          result.matchCount += 1;
          if (match[0].length === 0) pattern.lastIndex += 1;
          if (result.matchCount >= maxResults) {
            result.truncated = true;
            break;
          }
        }
        if (result.truncated) break;
      }
      if (matches.length > 0) result.files.push({ path: file, matches });
    });
    return result;
  }
}

export const localFolder = new LocalFolder();

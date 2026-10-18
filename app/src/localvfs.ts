import type { DirEntry, ServerInfo } from "./bridge";
import { clientExtensions } from "./client-extensions";
import { localFolder } from "./localfs";
import { DEFAULT_SETTINGS } from "./settings";

const STORAGE_KEY = "kode.local_vfs";
const SETTINGS_KEY = "kode.local_settings";

const DEFAULT_FILES: Record<string, string> = {
  "README.md": `# Kode (Standalone Mode)

Welcome to **Kode** running 100% client-side in your browser / WebView!

### Features active right now:
- **CodeMirror 6** editor with VS Code Dark+ theme
- **Shiki TextMate** syntax highlighting
- **Client-Side Web Worker LSP**:
  - Bracket matching & syntax validation
  - Smart autocomplete for JS, TS, HTML, CSS, Python, Rust, Go, SQL
  - Hover tooltips for standard language constructs
- **Local VFS**: Changes are saved locally in your browser storage

To use terminal or connect to a local Node/Termux backend, start the server and use **Ctrl+Shift+P** → *Connection: Set Server URL…*
`,
  "src/index.js": `// Standalone JavaScript file
function greet(name) {
  const greeting = \`Hello, \${name}!\`;
  console.log(greeting);
  return greeting;
}

greet("Developer");
`,
  "src/styles.css": `/* Standalone CSS */
body {
  font-family: system-ui, -apple-system, sans-serif;
  margin: 0;
  padding: 16px;
  background-color: #1e1e1e;
  color: #d4d4d4;
}

.card {
  border-radius: 8px;
  padding: 16px;
  background: #252526;
  border: 1px solid #333333;
}
`,
};

export class LocalVfs {
  private files = new Map<string, string>();
  private directories = new Set<string>(["", "src"]);

  constructor() {
    this.load();
    if (this.files.size === 0) {
      for (const [path, content] of Object.entries(DEFAULT_FILES)) {
        this.files.set(path, content);
      }
      this.save();
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data === "object" && data !== null) {
        for (const [path, content] of Object.entries(data)) {
          if (typeof content === "string") {
            this.files.set(path, content);
            this.ensureParents(path);
          }
        }
      }
    } catch {
      /* ignore storage load errors */
    }
  }

  private save(): void {
    try {
      const obj: Record<string, string> = {};
      for (const [path, content] of this.files) {
        obj[path] = content;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      /* quota exceeded or unavailable */
    }
  }

  private ensureParents(filePath: string): void {
    const parts = filePath.split("/");
    let current = "";
    for (let i = 0; i < parts.length - 1; i++) {
      current = current ? `${current}/${parts[i]}` : parts[i];
      this.directories.add(current);
    }
  }

  canHandle(method: string): boolean {
    if (method.startsWith("fs.")) return true;
    if (method.startsWith("ws.")) return true;
    if (method.startsWith("settings.")) return true;
    if (method.startsWith("ext.")) return true;
    if (method.startsWith("lsp.")) return true;
    if (method.startsWith("doc.")) return true;
    if (method.startsWith("pty.")) return true;
    if (method === "server.info") return true;
    return false;
  }

  handle(method: string, params: any = {}): any {
    // A real device folder (File System Access API) takes over all fs access.
    if (method.startsWith("fs.") && localFolder.mounted) {
      return this.localFs(method, params);
    }

    switch (method) {
      case "server.info":
        return {
          workspace: {
            root: localFolder.mounted ? localFolder.name : "Local Workspace",
            name: localFolder.mounted ? localFolder.name : "standalone",
          },
          pty: false,
          ptyMode: undefined,
          node: "Client (WASM / Web Worker)",
          platform: "browser",
        } satisfies ServerInfo;

      case "ws.info":
        return {
          root: localFolder.mounted ? localFolder.name : "Local Workspace",
          name: localFolder.mounted ? localFolder.name : "standalone",
        };

      case "ws.setRoot":
        return {
          root: String(params?.root || (localFolder.mounted ? localFolder.name : "Local Workspace")),
          name: localFolder.mounted ? localFolder.name : "standalone",
        };

      // Terminal and the extension host need a Node backend; fail fast rather
      // than waiting for a WebSocket that will never answer.
      case "pty.spawn":
        throw new Error(
          "Terminal needs a connected Kode server (Standalone Mode has no shell)."
        );
      case "pty.write":
      case "pty.resize":
      case "pty.kill":
        return null;

      case "doc.open":
      case "doc.change":
      case "doc.save":
      case "doc.active":
      case "doc.close":
      case "doc.selection":
        return null;

      case "ext.activate":
        return null;

      case "fs.readDir": {
        const dir = (params?.path || "").replace(/^\/+|\/+$/g, "");
        const results: DirEntry[] = [];
        const seen = new Set<string>();

        // Find directories directly under `dir`
        for (const d of this.directories) {
          if (!d) continue;
          if (!dir) {
            const first = d.split("/")[0];
            if (!seen.has(first)) {
              seen.add(first);
              results.push({ name: first, path: first, type: "dir" });
            }
          } else if (d.startsWith(dir + "/") && d !== dir) {
            const rest = d.slice(dir.length + 1);
            const first = rest.split("/")[0];
            const full = `${dir}/${first}`;
            if (!seen.has(first)) {
              seen.add(first);
              results.push({ name: first, path: full, type: "dir" });
            }
          }
        }

        // Find files directly under `dir`
        for (const f of this.files.keys()) {
          if (!dir) {
            if (!f.includes("/")) {
              results.push({ name: f, path: f, type: "file" });
            }
          } else if (f.startsWith(dir + "/") && !f.slice(dir.length + 1).includes("/")) {
            const name = f.slice(dir.length + 1);
            results.push({ name, path: f, type: "file" });
          }
        }

        results.sort((a, b) => {
          if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        return results;
      }

      case "fs.readFile": {
        const path = (params?.path || "").replace(/^\/+/, "");
        if (this.files.has(path)) return this.files.get(path)!;
        throw new Error(`File not found: ${path}`);
      }

      case "fs.writeFile": {
        const path = (params?.path || "").replace(/^\/+/, "");
        this.files.set(path, String(params?.content ?? ""));
        this.ensureParents(path);
        this.save();
        return true;
      }

      case "fs.createFile": {
        const path = (params?.path || "").replace(/^\/+/, "");
        if (!this.files.has(path)) {
          this.files.set(path, "");
          this.ensureParents(path);
          this.save();
        }
        return true;
      }

      case "fs.mkdir": {
        const path = (params?.path || "").replace(/^\/+|\/+$/g, "");
        this.directories.add(path);
        this.ensureParents(path);
        return true;
      }

      case "fs.delete": {
        const path = (params?.path || "").replace(/^\/+/, "");
        this.files.delete(path);
        this.directories.delete(path);
        // Also remove children if directory
        for (const f of [...this.files.keys()]) {
          if (f.startsWith(path + "/")) this.files.delete(f);
        }
        for (const d of [...this.directories]) {
          if (d.startsWith(path + "/")) this.directories.delete(d);
        }
        this.save();
        return true;
      }

      case "fs.rename": {
        const from = (params?.from || "").replace(/^\/+/, "");
        const to = (params?.to || "").replace(/^\/+/, "");
        if (this.files.has(from)) {
          const content = this.files.get(from)!;
          this.files.delete(from);
          this.files.set(to, content);
          this.ensureParents(to);
          this.save();
        }
        return true;
      }

      case "fs.listDirs":
        return this.listDirs(params);

      case "ws.search": {
        if (localFolder.mounted) {
          return localFolder.search(String(params?.query || ""), {
            caseSensitive: Boolean(params?.caseSensitive),
            regex: Boolean(params?.regex),
            wholeWord: Boolean(params?.wholeWord),
            maxResults: Number(params?.maxResults) || 1000,
          });
        }
        return this.searchFiles(params);
      }

      case "settings.get": {
        try {
          const raw = localStorage.getItem(SETTINGS_KEY);
          if (raw) return JSON.parse(raw);
        } catch {
          /* fallback */
        }
        return structuredClone(DEFAULT_SETTINGS);
      }

      case "settings.update": {
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(params?.settings || {}));
        } catch {
          /* ignore */
        }
        return params?.settings;
      }

      case "ext.list":
        return clientExtensions.list();

      case "ext.marketplace.search":
        return clientExtensions.searchMarketplace(
          params?.query || "",
          params?.size,
          params?.offset,
          params?.sortBy,
          params?.sortOrder
        );

      case "ext.marketplace.detail":
        return clientExtensions.getMarketplaceDetail(params?.id);

      case "ext.detail":
        return clientExtensions.detail(params?.id);

      case "ext.marketplace.install":
        return clientExtensions.installVsix(params?.downloadUrl, params?.iconUrl);

      case "ext.installVsix": {
        const url = params?.url || (typeof params?.path === "string" && /^https?:/i.test(params.path) ? params.path : "");
        if (!url) {
          throw new Error(
            "Installing from a local .vsix path needs a server; paste an https:// VSIX URL instead."
          );
        }
        return clientExtensions.installVsix(url);
      }

      case "ext.execCommand": {
        const owner = clientExtensions
          .list()
          .find((ext) => ext.commands.some((command) => command.command === params?.command));
        if (owner?.runtime) {
          throw new Error(
            "Running extension code requires the Kode server (Standalone Mode is declarative only)."
          );
        }
        return null;
      }

      case "ext.restart":
        return true;

      case "ext.enable":
        clientExtensions.enable(params?.id);
        return true;

      case "ext.disable":
        clientExtensions.disable(params?.id);
        return true;

      case "ext.uninstall":
        return clientExtensions.uninstall(params?.id);

      case "ext.themes":
        return clientExtensions.listThemes();

      case "ext.themeData":
        return clientExtensions.readTheme(params?.extensionId, params?.path);

      case "ext.iconThemes":
        return clientExtensions.listIconThemes();

      case "ext.iconThemeData":
        return clientExtensions.readIconTheme(params?.extensionId, params?.path);

      case "ext.commands":
        return [];

      default:
        return null;
    }
  }

  /** Virtual-FS directory browser used by the folder picker when offline. */
  private listDirs(params: any): {
    path: string;
    parent: string | null;
    home: string;
    dirs: { name: string; path: string }[];
    truncated: boolean;
  } {
    const target = String(params?.path || "").replace(/^\/+|\/+$/g, "");
    const dirs: { name: string; path: string }[] = [];
    const prefix = target ? `${target}/` : "";
    const seen = new Set<string>();
    for (const dir of this.directories) {
      if (!dir || !dir.startsWith(prefix) || dir === target) continue;
      const rest = dir.slice(prefix.length);
      const name = rest.split("/")[0];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      dirs.push({ name, path: prefix + name });
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    const slash = target.lastIndexOf("/");
    return {
      path: target,
      parent: target ? (slash > 0 ? target.slice(0, slash) : "") : null,
      home: "",
      dirs,
      truncated: false,
    };
  }

  /** Regex/case/whole-word search over the in-browser virtual file system. */
  private searchFiles(params: any): {
    files: {
      path: string;
      matches: { line: number; column: number; endColumn: number; text: string }[];
    }[];
    matchCount: number;
    truncated: boolean;
  } {
    const query = String(params?.query || "");
    const result = { files: [] as any[], matchCount: 0, truncated: false };
    if (!query) return result;
    const maxResults = Number(params?.maxResults) || 1000;
    let pattern: RegExp;
    try {
      const escaped = params?.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const source = params?.wholeWord ? `\\b${escaped}\\b` : escaped;
      pattern = new RegExp(source, params?.caseSensitive ? "g" : "gi");
    } catch {
      return result;
    }
    for (const [file, content] of this.files) {
      const lines = content.split("\n");
      const matches: { line: number; column: number; endColumn: number; text: string }[] = [];
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
      if (result.truncated) break;
    }
    return result;
  }

  /** Read/write through the mounted File System Access API directory. */
  private localFs(method: string, params: any): any {
    switch (method) {
      case "fs.readDir":
        return localFolder.readDir(String(params?.path || ""));
      case "fs.readFile":
        return localFolder.readFile(String(params?.path || ""));
      case "fs.writeFile":
        return localFolder.writeFile(String(params?.path || ""), String(params?.content ?? ""));
      case "fs.createFile":
        return localFolder.createFile(String(params?.path || ""));
      case "fs.mkdir":
        return localFolder.makeDirectory(String(params?.path || ""));
      case "fs.delete":
        return localFolder.remove(String(params?.path || ""));
      case "fs.rename":
        return localFolder.rename(String(params?.from || ""), String(params?.to || ""));
      case "fs.listDirs":
        return this.listDirs(params);
      default:
        return null;
    }
  }
}

export const localVfs = new LocalVfs();

import type { DirEntry, ServerInfo } from "./bridge";

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
    if (method === "server.info") return true;
    return false;
  }

  handle(method: string, params: any = {}): any {
    switch (method) {
      case "server.info":
        return {
          workspace: { root: "Local Workspace", name: "standalone" },
          pty: false,
          ptyMode: undefined,
          node: "Client (WASM / Web Worker)",
          platform: "browser",
        } satisfies ServerInfo;

      case "ws.info":
        return { root: "Local Workspace", name: "standalone" };

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

      case "ws.search": {
        const query = String(params?.query || "").toLowerCase();
        const results: { file: string; line: number; text: string }[] = [];
        if (!query) return { results };
        for (const [file, content] of this.files) {
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(query)) {
              results.push({ file, line: i + 1, text: lines[i] });
              if (results.length > 100) break;
            }
          }
        }
        return { results };
      }

      case "settings.get": {
        try {
          const raw = localStorage.getItem(SETTINGS_KEY);
          if (raw) return JSON.parse(raw);
        } catch {
          /* fallback */
        }
        return {
          editor: {
            fontSize: 14,
            tabSize: 2,
            wordWrap: "off",
            lineNumbers: true,
            highlightActiveLine: true,
            colorTheme: "dark-plus",
            autoSave: "off",
            autoSaveDelay: 1000,
          },
          files: { exclude: [] },
          search: { exclude: [] },
          terminal: { fontSize: 13 },
          workbench: { sidebarWidth: 240, iconTheme: "default" },
        };
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
      case "ext.themes":
      case "ext.iconThemes":
      case "ext.commands":
        return [];

      default:
        return null;
    }
  }
}

export const localVfs = new LocalVfs();

import { promises as fs } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

export interface ExtensionCommand {
  command: string;
  title: string;
}

export interface ExtensionInfo {
  id: string;
  name: string;
  displayName: string;
  publisher: string;
  version: string;
  dir: string;
  main?: string;
  active: boolean;
  commands: ExtensionCommand[];
}

/** Everything an extension can reach back to in the UI. */
export interface UiBridge {
  showMessage(
    kind: "info" | "warning" | "error",
    message: string,
    items: string[]
  ): Promise<string | undefined>;
  showQuickPick(items: any[], options?: any): Promise<any>;
  showInputBox(options?: any): Promise<string | undefined>;
  output(channel: string, line: string): void;
  executeCommand(command: string, ...args: any[]): Promise<any>;
}

class Memento {
  private data = new Map<string, any>();
  get<T>(key: string, fallback?: T): T | undefined {
    return this.data.has(key) ? this.data.get(key) : fallback;
  }
  update(key: string, value: any): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
  keys(): string[] {
    return [...this.data.keys()];
  }
}

/**
 * Minimal VS Code extension host.
 *
 * Extensions are CommonJS bundles (what `vsce package` produces). We load them
 * inside a `vm` wrapper that injects a `vscode` shim, so `require('vscode')`
 * resolves to our host implementation instead of Node's resolver.
 */
export class ExtensionHost {
  readonly commands = new Map<
    string,
    { title: string; extension: string; handler: (...args: any[]) => any }
  >();

  private extensions = new Map<string, ExtensionInfo & { manifest: any; dir: string }>();
  private activated = new Set<string>();
  private activatedExports = new Map<string, any>();

  constructor(private dir: string, private ui: UiBridge) {}

  async scan(): Promise<ExtensionInfo[]> {
    this.extensions.clear();
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    for (const name of entries) {
      const extDir = path.join(this.dir, name);
      const manifestPath = path.join(extDir, "package.json");
      try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        if (!manifest.name) continue;
        const publisher = manifest.publisher || "local";
        const commands: ExtensionCommand[] = (manifest.contributes?.commands || []).map(
          (c: any) => ({ command: c.command, title: c.title || c.command })
        );
        this.extensions.set(`${publisher}.${manifest.name}`, {
          id: `${publisher}.${manifest.name}`,
          name: manifest.name,
          displayName: manifest.displayName || manifest.name,
          publisher,
          version: manifest.version || "0.0.0",
          dir: extDir,
          main: manifest.main,
          active: false,
          commands,
          manifest,
        });
      } catch {
        /* not an extension folder */
      }
    }
    return this.list();
  }

  list(): ExtensionInfo[] {
    return [...this.extensions.values()].map(({ manifest, ...info }) => ({
      ...info,
      active: this.activated.has(info.id),
    }));
  }

  async activate(id: string): Promise<ExtensionInfo | null> {
    const ext = this.extensions.get(id);
    if (!ext) return null;
    if (this.activated.has(id)) {
      return this.list().find((e) => e.id === id) || null;
    }

    const mainRel = ext.main || "./extension.js";
    const mainPath = path.join(ext.dir, mainRel);
    const context = this.createContext(ext);
    const vscode = this.createShim(ext, context);

    try {
      const code = await fs.readFile(mainPath, "utf8");
      const extRequire = createRequire(mainPath);
      const requireFn = (name: string) =>
        name === "vscode" ? vscode : extRequire(name);
      const wrapper = `(function (exports, require, module, __filename, __dirname) {${code}\n})`;
      const fn = vm.runInThisContext(wrapper, { filename: mainPath });
      const moduleObj = { exports: {} as any };
      fn(moduleObj.exports, requireFn, moduleObj, mainPath, path.dirname(mainPath));
      const exportsObj = moduleObj.exports;
      if (typeof exportsObj.activate === "function") {
        await exportsObj.activate(context);
      }
      this.activated.add(id);
      this.activatedExports.set(id, exportsObj);
    } catch (err: any) {
      this.ui.output("Extension Host", `Failed to activate ${id}: ${err?.stack || err}`);
      throw err;
    }
    return this.list().find((e) => e.id === id) || null;
  }

  async deactivate(id: string): Promise<void> {
    const exportsObj = this.activatedExports.get(id);
    if (typeof exportsObj?.deactivate === "function") {
      await exportsObj.deactivate();
    }
    this.activated.delete(id);
    this.activatedExports.delete(id);
  }

  async executeCommand(command: string, args: any[] = []): Promise<any> {
    const entry = this.commands.get(command);
    if (!entry) throw new Error(`Unknown command: ${command}`);
    return entry.handler(...args);
  }

  private createContext(ext: ExtensionInfo & { dir: string }) {
    const subscriptions: { dispose(): void }[] = [];
    return {
      subscriptions,
      extensionPath: ext.dir,
      extensionUri: uriFromPath(ext.dir),
      asAbsolutePath: (p: string) => path.join(ext.dir, p),
      globalState: new Memento(),
      workspaceState: new Memento(),
      secrets: {
        get: async () => undefined,
        store: async () => undefined,
        delete: async () => undefined,
      },
      environmentVariableCollection: {
        replace: () => {},
        append: () => {},
        prepend: () => {},
        get: () => undefined,
        forEach: () => {},
        delete: () => {},
        clear: () => {},
      },
      extensionMode: 2,
    };
  }

  private createShim(ext: ExtensionInfo, context: any): any {
    const host = this;
    const ui = this.ui;
    return {
      version: "1.90.0",
      commands: {
        registerCommand(command: string, handler: (...args: any[]) => any) {
          const disposable = {
            dispose: () => host.commands.delete(command),
          };
          host.commands.set(command, { title: command, extension: ext.id, handler });
          context.subscriptions.push(disposable);
          return disposable;
        },
        registerTextEditorCommand(command: string, handler: (...args: any[]) => any) {
          return this.registerCommand(command, handler);
        },
        executeCommand(command: string, ...args: any[]) {
          return ui.executeCommand(command, ...args);
        },
        async getCommands() {
          return [...host.commands.keys()];
        },
      },
      window: {
        showInformationMessage: (message: string, ...rest: any[]) =>
          ui.showMessage("info", message, stringItems(rest)),
        showWarningMessage: (message: string, ...rest: any[]) =>
          ui.showMessage("warning", message, stringItems(rest)),
        showErrorMessage: (message: string, ...rest: any[]) =>
          ui.showMessage("error", message, stringItems(rest)),
        showQuickPick: (items: any[], options?: any) => ui.showQuickPick(items, options),
        showInputBox: (options?: any) => ui.showInputBox(options),
        createOutputChannel(name: string) {
          return {
            name,
            append: (line: string) => ui.output(name, String(line)),
            appendLine: (line: string) => ui.output(name, String(line)),
            replace: (line: string) => ui.output(name, String(line)),
            show() {},
            hide() {},
            clear() {},
            dispose() {},
          };
        },
        createStatusBarItem() {
          return {
            text: "",
            tooltip: "",
            command: undefined,
            show() {},
            hide() {},
            dispose() {},
          };
        },
        activeTextEditor: undefined,
        visibleTextEditors: [] as any[],
        onDidChangeActiveTextEditor: () => ({ dispose() {} }),
        onDidChangeTextEditorSelection: () => ({ dispose() {} }),
        showTextDocument: async () => undefined as any,
        withProgress: async (_opts: any, task: any) => task({ report: () => {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }),
      },
      workspace: {
        name: ext.name,
        workspaceFolders: undefined,
        rootPath: ext.dir,
        getConfiguration(section?: string) {
          return {
            get: (_key: string, fallback?: any) => fallback,
            has: () => false,
            update: async () => undefined,
            inspect: () => undefined,
          };
        },
        fs: {
          readFile: async (_uri: any) => new Uint8Array(),
          writeFile: async (_uri: any, _content: any) => undefined,
          stat: async (_uri: any) => ({}) as any,
          readDirectory: async (_uri: any) => [],
          createDirectory: async (_uri: any) => undefined,
        },
        onDidChangeTextDocument: () => ({ dispose() {} }),
        onDidSaveTextDocument: () => ({ dispose() {} }),
        onDidOpenTextDocument: () => ({ dispose() {} }),
        openTextDocument: async () => ({}) as any,
        findFiles: async () => [],
        asRelativePath: (p: string) => p,
      },
      languages: {
        registerCompletionItemProvider: () => ({ dispose() {} }),
        registerHoverProvider: () => ({ dispose() {} }),
        registerCodeActionsProvider: () => ({ dispose() {} }),
        registerDocumentFormattingEditProvider: () => ({ dispose() {} }),
        createDiagnosticCollection: () => ({
          set() {},
          delete() {},
          clear() {},
          dispose() {},
        }),
        match: () => 0,
      },
      env: {
        appName: "Kode",
        appHost: "kode",
        language: "en",
        machineId: "kode-local",
        sessionId: "kode-session",
        openExternal: async () => true,
        clipboard: { readText: async () => "", writeText: async () => undefined },
      },
      Uri: {
        file: (p: string) => uriFromPath(p),
        parse: (value: string) => ({ toString: () => value, fsPath: value, path: value }),
        joinPath: (base: any, ...parts: string[]) => uriFromPath(path.join(base.fsPath, ...parts)),
      },
      ThemeColor: class ThemeColor {
        constructor(public id: string) {}
      },
      StatusBarAlignment: { Left: 1, Right: 2 },
      ViewColumn: { Active: -1, One: 1, Two: 2 },
      CompletionItemKind: {
        Text: 0,
        Method: 1,
        Function: 2,
        Constructor: 3,
        Field: 4,
        Variable: 5,
        Class: 6,
        Interface: 7,
        Module: 8,
        Property: 9,
        Keyword: 13,
        Snippet: 14,
        Color: 15,
        File: 16,
        Folder: 18,
      },
      DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
      Diagnostic: class Diagnostic {
        constructor(public range: any, public message: string, public severity?: number) {}
      },
      Position: class Position {
        constructor(public line: number, public character: number) {}
      },
      Range: class Range {
        constructor(public start: any, public end: any) {}
      },
      Location: class Location {
        constructor(public uri: any, public range: any) {}
      },
      CompletionItem: class CompletionItem {
        constructor(public label: string, public kind?: number) {}
      },
      Hover: class Hover {
        constructor(public contents: any, public range?: any) {}
      },
      MarkdownString: class MarkdownString {
        constructor(public value = "") {}
        appendText(v: string) {
          this.value += v;
          return this;
        }
        appendMarkdown(v: string) {
          this.value += v;
          return this;
        }
      },
      EventEmitter: class EventEmitter {
        private listeners = new Set<(e: any) => void>();
        event = (listener: (e: any) => void) => {
          this.listeners.add(listener);
          return { dispose: () => this.listeners.delete(listener) };
        };
        fire(value?: any) {
          for (const listener of this.listeners) listener(value);
        }
        dispose() {
          this.listeners.clear();
        }
      },
      Disposable: class Disposable {
        constructor(private callOnDispose: () => void) {}
        dispose() {
          this.callOnDispose();
        }
        static from(...items: { dispose(): void }[]) {
          return new (class {
            dispose() {
              for (const item of items) item.dispose();
            }
          })();
        }
      },
    };
  }
}

function uriFromPath(p: string) {
  return {
    scheme: "file",
    fsPath: p,
    path: p,
    toString: () => "file://" + p,
  };
}

function stringItems(rest: any[]): string[] {
  return rest.filter((r) => typeof r === "string");
}

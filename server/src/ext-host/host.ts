import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import {
  TextDocumentImpl,
  TextEditorImpl,
  pathToUri,
  toPosition,
  toRange,
  uriToPath,
  type DocEntry,
  type Range,
  type Selection,
  type TextEdit,
} from "./documents.js";

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
  runtime: boolean;
  commands: ExtensionCommand[];
}

interface ProviderEntry {
  selector: any;
  provider: any;
}

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
  applyEdits(uri: string, edits: TextEdit[]): Promise<boolean>;
  saveDocument(uri: string): Promise<boolean>;
  showDocument(uri: string): Promise<boolean>;
  setDiagnostics(uri: string, diagnostics: any[]): void;
}

class Emitter {
  private listeners = new Set<(event: any) => void>();

  event = (listener: (event: any) => void) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(value?: any): void {
    for (const listener of [...this.listeners]) listener(value);
  }

  clear(): void {
    this.listeners.clear();
  }
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

class WorkspaceEdit {
  private map = new Map<string, TextEdit[]>();

  replace(uri: any, range: Range, newText: string): void {
    this.push(uri, { range: toRange(range), newText });
  }
  insert(uri: any, position: any, newText: string): void {
    const point = toPosition(position);
    this.push(uri, { range: { start: point, end: { ...point } }, newText });
  }
  delete(uri: any, range: Range): void {
    this.push(uri, { range: toRange(range), newText: "" });
  }
  get(uri: any): TextEdit[] {
    return this.map.get(uriKey(uri)) ?? [];
  }
  entries(): [string, TextEdit[]][] {
    return [...this.map.entries()];
  }
  get size(): number {
    return this.map.size;
  }

  private push(uri: any, edit: TextEdit): void {
    const key = uriKey(uri);
    const list = this.map.get(key) ?? [];
    list.push(edit);
    this.map.set(key, list);
  }
}

function uriKey(uri: any): string {
  if (!uri) return "";
  if (typeof uri === "string") return uri;
  if (typeof uri.toString === "function") return uri.toString();
  return String(uri);
}

/**
 * Minimal VS Code extension host.
 *
 * Extensions are CommonJS bundles loaded inside a `vm` wrapper that injects a
 * `vscode` shim, so `require('vscode')` resolves to this host. Builtin modules
 * (fs, path, ...) still resolve through Node's normal loader.
 */
export class ExtensionHost {
  readonly commands = new Map<
    string,
    { title: string; extension: string; handler: (...args: any[]) => any }
  >();

  private extensions = new Map<string, ExtensionInfo & { manifest: any; dir: string }>();
  private activated = new Set<string>();
  private activatedExports = new Map<string, any>();
  private contexts = new Map<string, { subscriptions: { dispose(): void }[] }>();
  private scanned = false;
  private startupActivated = false;

  private documents = new Map<string, DocEntry>();
  private activeUri: string | null = null;
  private selection: Selection = emptySelection();
  private completionProviders: ProviderEntry[] = [];
  private hoverProviders: ProviderEntry[] = [];
  private extensionDiagnostics = new Map<string, any[]>();

  private emitters = {
    open: new Emitter(),
    change: new Emitter(),
    save: new Emitter(),
    close: new Emitter(),
    active: new Emitter(),
    selection: new Emitter(),
  };

  constructor(
    private dir: string,
    public workspaceRoot: string,
    private ui: UiBridge
  ) {}

  // ---- extension lifecycle ------------------------------------------------

  async scan(): Promise<ExtensionInfo[]> {
    this.extensions.clear();
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.dir);
    } catch {
      this.scanned = true;
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
          runtime: Boolean(manifest.main),
          commands,
          manifest,
        });
      } catch {
        /* not an extension folder */
      }
    }
    this.scanned = true;
    return this.list();
  }

  list(): ExtensionInfo[] {
    return [...this.extensions.values()].map(({ manifest, ...info }) => ({
      ...info,
      active: this.activated.has(info.id),
    }));
  }

  /** Force the next scan/startup pass to run again (after install/uninstall). */
  markUnscanned(): void {
    this.scanned = false;
    this.startupActivated = false;
  }

  async activate(id: string): Promise<ExtensionInfo | null> {
    if (!this.scanned) await this.scan();
    const ext = this.extensions.get(id);
    if (!ext) return null;
    if (this.activated.has(id)) return this.list().find((e) => e.id === id) || null;

    const mainRel = ext.main || "./extension.js";
    const mainPath = path.join(ext.dir, mainRel);
    const context = this.createContext(ext);
    const vscode = this.createShim(ext, context);
    this.contexts.set(id, context);

    try {
      const code = await fs.readFile(mainPath, "utf8");
      const extRequire = createRequire(mainPath);
      const requireFn = (name: string) => (name === "vscode" ? vscode : extRequire(name));
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
    const context = this.contexts.get(id);
    if (context) {
      for (const subscription of context.subscriptions) {
        try {
          subscription.dispose();
        } catch {
          /* ignore */
        }
      }
    }
    this.contexts.delete(id);
    this.activated.delete(id);
    this.activatedExports.delete(id);
  }

  async executeCommand(command: string, args: any[] = []): Promise<any> {
    if (!this.scanned) await this.scan();
    let entry = this.commands.get(command);
    if (!entry) {
      // VS Code activates the owning extension on demand; do the same.
      const owner = [...this.extensions.values()].find((ext) =>
        ext.commands.some((c) => c.command === command)
      );
      if (owner) {
        await this.activate(owner.id);
        entry = this.commands.get(command);
      }
    }
    if (!entry) throw new Error(`Unknown command: ${command}`);
    return entry.handler(...args);
  }

  /** Activate extensions that ask to run on startup (`"*"` / `onStartupFinished`). */
  async activateStartup(): Promise<void> {
    if (this.startupActivated) return;
    this.startupActivated = true;
    if (!this.scanned) await this.scan();
    for (const ext of this.extensions.values()) {
      const events: string[] = ext.manifest?.activationEvents || [];
      if (!events.includes("*") && !events.includes("onStartupFinished")) continue;
      try {
        await this.activate(ext.id);
      } catch (error: any) {
        this.ui.output("Extension Host", `startup activation failed for ${ext.id}: ${error?.message}`);
      }
    }
  }

  // ---- document model -----------------------------------------------------

  openDocument(uri: string, languageId: string, text: string): void {
    let entry = this.documents.get(uri);
    if (entry) {
      entry.text = text;
      entry.languageId = languageId;
      entry.version += 1;
    } else {
      entry = { uri, languageId, version: 1, text, dirty: false };
      this.documents.set(uri, entry);
    }
    this.emitters.open.fire(this.makeDocument(entry));
  }

  changeDocument(uri: string, text: string): void {
    let entry = this.documents.get(uri);
    if (!entry) {
      this.openDocument(uri, languageForPath(uriToPath(uri)), text);
      entry = this.documents.get(uri)!;
    }
    entry.text = text;
    entry.version += 1;
    entry.dirty = true;
    this.emitters.change.fire({
      document: this.makeDocument(entry),
      contentChanges: [{ text }],
      reason: undefined,
    });
  }

  saveDocument(uri: string): void {
    const entry = this.documents.get(uri);
    if (!entry) return;
    entry.dirty = false;
    this.emitters.save.fire(this.makeDocument(entry));
  }

  closeDocument(uri: string): void {
    const entry = this.documents.get(uri);
    if (!entry) return;
    this.emitters.close.fire(this.makeDocument(entry));
    this.documents.delete(uri);
    if (this.activeUri === uri) this.setActiveDocument(null);
  }

  setActiveDocument(uri: string | null): void {
    if (this.activeUri === uri) return;
    this.activeUri = uri;
    this.emitters.active.fire(this.activeTextEditor());
  }

  setSelection(uri: string, selection: Selection): void {
    if (this.activeUri !== uri) this.setActiveDocument(uri);
    this.selection = selection;
    this.emitters.selection.fire({
      textEditor: this.activeTextEditor(),
      selections: [selection],
      kind: 1,
    });
  }

  activeTextEditor(): TextEditorImpl | undefined {
    if (!this.activeUri) return undefined;
    const entry = this.documents.get(this.activeUri);
    if (!entry) return undefined;
    return this.makeEditor(entry);
  }

  listDocuments(): TextDocumentImpl[] {
    return [...this.documents.values()].map((entry) => this.makeDocument(entry));
  }

  async openTextDocument(uriOrPath: string): Promise<TextDocumentImpl> {
    const uri = uriOrPath.startsWith("file://") ? uriOrPath : pathToUri(uriOrPath);
    let entry = this.documents.get(uri);
    if (!entry) {
      const text = await fs.readFile(uriToPath(uri), "utf8");
      entry = { uri, languageId: languageForPath(uriToPath(uri)), version: 1, text, dirty: false };
      this.documents.set(uri, entry);
      this.emitters.open.fire(this.makeDocument(entry));
    }
    return this.makeDocument(entry);
  }

  async applyWorkspaceEdit(edit: WorkspaceEdit): Promise<boolean> {
    for (const [uri, edits] of edit.entries()) {
      await this.ui.applyEdits(uri, edits);
    }
    return true;
  }

  async showDocument(value: any): Promise<TextEditorImpl | undefined> {
    const uri = typeof value === "string" ? pathToUri(value) : uriKey(value?.uri ?? value);
    if (!uri) return undefined;
    await this.ui.showDocument(uri);
    this.setActiveDocument(uri);
    return this.activeTextEditor();
  }

  readSettings(): Record<string, any> {
    try {
      return JSON.parse(readFileSync(path.join(this.workspaceRoot, "settings.json"), "utf8"));
    } catch {
      return {};
    }
  }

  // ---- language providers -------------------------------------------------

  async provideCompletionItems(
    uri: string,
    position: { line: number; character: number }
  ): Promise<any[]> {
    const entry = this.documents.get(uri);
    if (!entry) return [];
    const document = this.makeDocument(entry);
    const results: any[] = [];
    for (const { selector, provider } of this.completionProviders) {
      if (!matchesSelector(selector, document.languageId) || !provider?.provideCompletionItems) continue;
      try {
        const list = await provider.provideCompletionItems(
          document,
          position,
          cancellationToken(),
          { triggerKind: 1, triggerCharacter: undefined }
        );
        const items = Array.isArray(list) ? list : list?.items || [];
        for (const item of items) results.push(normalizeCompletionItem(item));
      } catch (error: any) {
        this.ui.output("Extension Host", `completion provider failed: ${error?.message}`);
      }
    }
    return results;
  }

  async provideHover(
    uri: string,
    position: { line: number; character: number }
  ): Promise<{ contents: string; range?: Range } | null> {
    const entry = this.documents.get(uri);
    if (!entry) return null;
    const document = this.makeDocument(entry);
    for (const { selector, provider } of this.hoverProviders) {
      if (!matchesSelector(selector, document.languageId) || !provider?.provideHover) continue;
      try {
        const hover = await provider.provideHover(document, position, cancellationToken());
        if (hover) {
          return {
            contents: hoverText(hover),
            range: hover.range ? toRange(hover.range) : undefined,
          };
        }
      } catch (error: any) {
        this.ui.output("Extension Host", `hover provider failed: ${error?.message}`);
      }
    }
    return null;
  }

  setExtensionDiagnostics(uri: string, diagnostics: any[]): void {
    this.extensionDiagnostics.set(uri, diagnostics);
    this.ui.setDiagnostics(
      uri,
      diagnostics.map((diagnostic) => ({
        range: toRange(diagnostic.range),
        message: String(diagnostic.message ?? ""),
        severity: (diagnostic.severity ?? 0) + 1,
        source: diagnostic.source,
        code: diagnostic.code,
      }))
    );
  }

  private registerProvider(
    bucket: ProviderEntry[],
    context: any,
    selector: any,
    provider: any
  ): { dispose(): void } {
    const entry: ProviderEntry = { selector, provider };
    bucket.push(entry);
    const disposable = {
      dispose: () => {
        const index = bucket.indexOf(entry);
        if (index >= 0) bucket.splice(index, 1);
      },
    };
    context.subscriptions.push(disposable);
    return disposable;
  }

  // ---- vscode shim --------------------------------------------------------

  private makeDocument(entry: DocEntry): TextDocumentImpl {
    return new TextDocumentImpl(entry, async (uri) => {
      const ok = await this.ui.saveDocument(uri);
      this.saveDocument(uri);
      return ok;
    });
  }

  private makeEditor(entry: DocEntry): TextEditorImpl {
    return new TextEditorImpl(
      this.makeDocument(entry),
      () => this.selection,
      async (uri, edits) => this.ui.applyEdits(uri, edits)
    );
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

    const TextEditFactory = class {
      static replace(range: Range, newText: string): TextEdit {
        return { range: toRange(range), newText };
      }
      static insert(position: any, newText: string): TextEdit {
        const point = toPosition(position);
        return { range: { start: point, end: { ...point } }, newText };
      }
      static delete(range: Range): TextEdit {
        return { range: toRange(range), newText: "" };
      }
    };

    return {
      version: "1.90.0",
      commands: {
        registerCommand(command: string, handler: (...args: any[]) => any) {
          const disposable = { dispose: () => host.commands.delete(command) };
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
        get activeTextEditor() {
          return host.activeTextEditor();
        },
        get visibleTextEditors() {
          const editor = host.activeTextEditor();
          return editor ? [editor] : [];
        },
        onDidChangeActiveTextEditor: host.emitters.active.event,
        onDidChangeTextEditorSelection: host.emitters.selection.event,
        showInformationMessage: (message: string, ...rest: any[]) =>
          ui.showMessage("info", message, stringItems(rest)),
        showWarningMessage: (message: string, ...rest: any[]) =>
          ui.showMessage("warning", message, stringItems(rest)),
        showErrorMessage: (message: string, ...rest: any[]) =>
          ui.showMessage("error", message, stringItems(rest)),
        showQuickPick: (items: any[], options?: any) => ui.showQuickPick(items, options),
        showInputBox: (options?: any) => ui.showInputBox(options),
        showTextDocument: (value: any) => host.showDocument(value),
        createOutputChannel(name: string) {
          return outputChannel(name);
        },
        createStatusBarItem() {
          return { text: "", tooltip: "", command: undefined, show() {}, hide() {}, dispose() {} };
        },
        withProgress: async (_options: any, task: any) =>
          task({ report: () => {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }),
      },
      workspace: {
        get name() {
          return ext.name;
        },
        get rootPath() {
          return host.workspaceRoot;
        },
        get workspaceFolders() {
          return [
            {
              uri: uriFromPath(host.workspaceRoot),
              name: path.basename(host.workspaceRoot),
              index: 0,
            },
          ];
        },
        get textDocuments() {
          return host.listDocuments();
        },
        onDidOpenTextDocument: host.emitters.open.event,
        onDidChangeTextDocument: host.emitters.change.event,
        onDidSaveTextDocument: host.emitters.save.event,
        onDidCloseTextDocument: host.emitters.close.event,
        onDidChangeConfiguration: () => ({ dispose() {} }),
        onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
        getConfiguration(section?: string) {
          const settings = host.readSettings();
          const scoped = section ? getPath(settings, section, {}) : settings;
          return {
            get: (key: string, fallback?: any) => {
              const value = getPath(scoped, key, undefined);
              return value === undefined ? fallback : value;
            },
            has: (key: string) => getPath(scoped, key, undefined) !== undefined,
            update: async () => undefined,
            inspect: () => undefined,
          };
        },
        fs: {
          readFile: async (uri: any) => {
            const buffer = await fs.readFile(uriToPath(uriKey(uri)));
            return new Uint8Array(buffer);
          },
          writeFile: async (uri: any, content: Uint8Array) => {
            await fs.writeFile(uriToPath(uriKey(uri)), content);
          },
          stat: async (uri: any) => {
            const info = await fs.stat(uriToPath(uriKey(uri)));
            return { type: info.isDirectory() ? 2 : 1, ctime: info.ctimeMs, mtime: info.mtimeMs, size: info.size };
          },
          readDirectory: async (uri: any) => {
            const entries = await fs.readdir(uriToPath(uriKey(uri)), { withFileTypes: true });
            return entries.map((item) => [item.name, item.isDirectory() ? 2 : 1]);
          },
          createDirectory: async (uri: any) => {
            await fs.mkdir(uriToPath(uriKey(uri)), { recursive: true });
          },
        },
        applyEdit: (edit: WorkspaceEdit) => host.applyWorkspaceEdit(edit),
        openTextDocument: (uriOrPath: string) => host.openTextDocument(uriOrPath),
        findFiles: async () => [],
        asRelativePath: (value: any) => {
          const filePath = typeof value === "string" ? value : uriToPath(uriKey(value));
          return path.relative(host.workspaceRoot, filePath);
        },
      },
      languages: {
        registerCompletionItemProvider(
          selector: any,
          provider: any,
          ..._triggerCharacters: string[]
        ) {
          return host.registerProvider(host.completionProviders, context, selector, provider);
        },
        registerHoverProvider(selector: any, provider: any) {
          return host.registerProvider(host.hoverProviders, context, selector, provider);
        },
        registerCodeActionsProvider: () => ({ dispose() {} }),
        registerDocumentFormattingEditProvider: () => ({ dispose() {} }),
        createDiagnosticCollection(name?: string) {
          const tracked = new Set<string>();
          return {
            name: name || "diagnostics",
            set(uriOrEntries: any, diagnostics?: any[]) {
              if (Array.isArray(uriOrEntries)) {
                for (const [uri, items] of uriOrEntries) {
                  tracked.add(uriKey(uri));
                  host.setExtensionDiagnostics(uriKey(uri), items || []);
                }
                return;
              }
              const uri = uriKey(uriOrEntries);
              tracked.add(uri);
              host.setExtensionDiagnostics(uri, diagnostics || []);
            },
            delete(uri: any) {
              tracked.delete(uriKey(uri));
              host.setExtensionDiagnostics(uriKey(uri), []);
            },
            clear() {
              for (const uri of tracked) host.setExtensionDiagnostics(uri, []);
              tracked.clear();
            },
            dispose() {
              this.clear();
            },
          };
        },
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
      TextEditorRevealType: { Default: 0, InCenter: 1, AtTop: 2 },
      EndOfLine: { LF: 1, CRLF: 2 },
      ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
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
      Selection: class Selection {
        constructor(
          public anchor: any,
          public active: any
        ) {}
        get start() {
          return comparePositions(this.anchor, this.active) <= 0 ? this.anchor : this.active;
        }
        get end() {
          return comparePositions(this.anchor, this.active) <= 0 ? this.active : this.anchor;
        }
        get isEmpty() {
          return this.anchor.line === this.active.line && this.anchor.character === this.active.character;
        }
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
      WorkspaceEdit,
      TextEdit: TextEditFactory,
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
          return { dispose: () => items.forEach((item) => item.dispose()) };
        }
      },
    };

    function outputChannel(name: string) {
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
    }
  }
}

function uriFromPath(filePath: string) {
  return {
    scheme: "file",
    fsPath: filePath,
    path: filePath,
    toString: () => pathToUri(filePath),
  };
}

function stringItems(rest: any[]): string[] {
  return rest.filter((r) => typeof r === "string");
}

function comparePositions(a: { line: number; character: number }, b: { line: number; character: number }): number {
  return a.line - b.line || a.character - b.character;
}

function getPath(object: any, dotted: string, fallback: any): any {
  if (!dotted) return object ?? fallback;
  let current = object;
  for (const key of dotted.split(".")) {
    if (current == null || typeof current !== "object") return fallback;
    current = current[key];
    if (current === undefined) return fallback;
  }
  return current;
}

function emptySelection(): Selection {
  const point = { line: 0, character: 0 };
  return { start: point, end: { ...point }, anchor: { ...point }, active: { ...point }, isEmpty: true };
}

function matchesSelector(selector: any, languageId: string): boolean {
  if (typeof selector === "string") return selector === "*" || selector === languageId;
  if (Array.isArray(selector)) return selector.some((entry) => matchesSelector(entry, languageId));
  if (selector && typeof selector === "object") {
    return !selector.language || selector.language === "*" || selector.language === languageId;
  }
  return false;
}

function cancellationToken() {
  return {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  };
}

/** VS Code completion kinds are LSP kinds minus one. */
function normalizeCompletionItem(item: any): any {
  return {
    label: typeof item.label === "string" ? item.label : item.label?.label ?? "",
    kind: (item.kind ?? 0) + 1,
    detail: item.detail,
    documentation:
      typeof item.documentation === "string" ? item.documentation : item.documentation?.value,
    insertText: item.insertText,
    range: item.range ? toRange(item.range) : undefined,
  };
}

function hoverText(hover: any): string {
  const contents = hover?.contents;
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents
      .map((part) => (typeof part === "string" ? part : part?.value ?? ""))
      .filter(Boolean)
      .join("\n\n");
  }
  if (contents?.value) return String(contents.value);
  return "";
}

function languageForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".js": "javascript",
    ".jsx": "javascriptreact",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".json": "json",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "scss",
    ".md": "markdown",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".sh": "shellscript",
    ".yml": "yaml",
    ".yaml": "yaml",
  };
  return map[ext] || "plaintext";
}

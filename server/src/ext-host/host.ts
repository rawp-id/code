import { existsSync, promises as fs, readFileSync, statSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

function resolveMain(dir: string, main?: string): string {
  const p = path.resolve(dir, main || "./extension.js");
  const candidates = [p, p + ".js", p + ".cjs", p + ".mjs", path.join(p, "index.js")];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return p;
}
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
  disabled: boolean;
  icon?: string;
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
  private listeners = new Set<{ fn: (event: any) => void; thisArgs?: any }>();

  event = (listener: (event: any) => void, thisArgs?: any, disposables?: any[]) => {
    const entry = { fn: listener, thisArgs };
    this.listeners.add(entry);
    const disposable = {
      dispose: () => {
        this.listeners.delete(entry);
      },
    };
    if (Array.isArray(disposables)) {
      disposables.push(disposable);
    }
    return disposable;
  };

  fire(value?: any): void {
    for (const { fn, thisArgs } of [...this.listeners]) {
      try {
        fn.call(thisArgs, value);
      } catch (err: any) {
        // Prevent extension listeners from crashing the host
      }
    }
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
  setKeysForSync(_keys: readonly string[]): void {}
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
  private disabled = new Set<string>();

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
    await this.loadDisabled();
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
          disabled: false,
          icon: manifest.icon,
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
      disabled: this.disabled.has(info.id),
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
    if (!ext || this.disabled.has(id)) return this.list().find((e) => e.id === id) || null;
    if (this.activated.has(id)) return this.list().find((e) => e.id === id) || null;

    const mainPath = resolveMain(ext.dir, ext.main);
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

  async disable(id: string): Promise<void> {
    if (!this.scanned) await this.scan();
    await this.deactivate(id).catch(() => undefined);
    this.disabled.add(id);
    await this.saveDisabled();
  }

  async enable(id: string): Promise<void> {
    if (!this.scanned) await this.scan();
    this.disabled.delete(id);
    await this.saveDisabled();
  }

  /** Deactivate everything and re-scan (Extensions: Restart). */
  async restart(): Promise<void> {
    for (const id of [...this.activated]) {
      await this.deactivate(id).catch(() => undefined);
    }
    this.markUnscanned();
    await this.scan();
  }

  private async loadDisabled(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(this.dir, ".disabled.json"), "utf8"));
      this.disabled = new Set(Array.isArray(raw) ? raw : []);
    } catch {
      this.disabled = new Set();
    }
  }

  private async saveDisabled(): Promise<void> {
    try {
      await fs.writeFile(
        path.join(this.dir, ".disabled.json"),
        JSON.stringify([...this.disabled].sort(), null, 2) + "\n",
        "utf8"
      );
    } catch {
      /* ignore */
    }
  }

  async executeCommand(command: string, args: any[] = []): Promise<any> {
    if (!this.scanned) await this.scan();
    let entry = this.commands.get(command);
    if (!entry) {
      // VS Code activates the owning extension on demand; do the same.
      const owner = [...this.extensions.values()].find((ext) =>
        ext.commands.some((c) => c.command === command)
      );
      if (owner && !this.disabled.has(owner.id)) {
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
      if (this.disabled.has(ext.id)) continue;
      const events: string[] = ext.manifest?.activationEvents || [];
      if (!events.includes("*") && !events.includes("onStartupFinished")) continue;
      try {
        await this.activate(ext.id);
      } catch (error: any) {
        this.ui.output("Extension Host", `startup activation failed for ${ext.id}: ${error?.message}`);
      }
    }
  }

  /** Activate extensions registered for a language. */
  async activateForLanguage(languageId: string): Promise<void> {
    if (!languageId || languageId === "plaintext") return;
    if (!this.scanned) await this.scan();
    for (const ext of this.extensions.values()) {
      if (this.disabled.has(ext.id) || this.activated.has(ext.id)) continue;
      const events: string[] = ext.manifest?.activationEvents || [];
      const contributesLangs = (ext.manifest?.contributes?.languages || []).some(
        (l: any) => l.id === languageId
      );
      if (
        events.includes("*") ||
        events.includes("onStartupFinished") ||
        events.includes(`onLanguage:${languageId}`) ||
        events.includes("onLanguage:*") ||
        contributesLangs
      ) {
        try {
          await this.activate(ext.id);
        } catch (error: any) {
          this.ui.output(
            "Extension Host",
            `failed to activate ${ext.id} for ${languageId}: ${error?.message}`
          );
        }
      }
    }
  }

  // ---- document model -----------------------------------------------------

  openDocument(uri: string, languageId: string, text: string): void {
    void this.activateForLanguage(languageId);
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

  /** Theme and icon-theme contributions from installed extensions. */
  async listThemes(): Promise<{ id: string; label: string; extensionId: string; path: string }[]> {
    if (!this.scanned) await this.scan();
    const out: { id: string; label: string; extensionId: string; path: string }[] = [];
    for (const ext of this.extensions.values()) {
      if (this.disabled.has(ext.id)) continue;
      for (const theme of ext.manifest?.contributes?.themes || []) {
        if (!theme?.path) continue;
        out.push({
          id: `ext:${ext.id}:${theme.path}`,
          label: theme.label || theme.path,
          extensionId: ext.id,
          path: theme.path,
        });
      }
    }
    return out;
  }

  async listIconThemes(): Promise<
    { id: string; label: string; extensionId: string; path: string }[]
  > {
    if (!this.scanned) await this.scan();
    const out: { id: string; label: string; extensionId: string; path: string }[] = [];
    for (const ext of this.extensions.values()) {
      if (this.disabled.has(ext.id)) continue;
      for (const theme of ext.manifest?.contributes?.iconThemes || []) {
        if (!theme?.path) continue;
        out.push({
          id: `ext:${ext.id}:${theme.path}`,
          label: theme.label || theme.path,
          extensionId: ext.id,
          path: theme.path,
        });
      }
    }
    return out;
  }

  async readTheme(extensionId: string, themePath: string): Promise<any> {
    if (!this.scanned) await this.scan();
    const ext = this.extensions.get(extensionId);
    if (!ext) throw new Error("Unknown extension");
    const file = path.resolve(ext.dir, themePath);
    if (!file.startsWith(ext.dir)) throw new Error("Invalid theme path");
    return JSON.parse(await fs.readFile(file, "utf8"));
  }

  async readIconTheme(extensionId: string, themePath: string): Promise<any> {
    if (!this.scanned) await this.scan();
    const ext = this.extensions.get(extensionId);
    if (!ext) throw new Error("Unknown extension");
    const file = path.resolve(ext.dir, themePath);
    if (!file.startsWith(ext.dir)) throw new Error("Invalid icon theme path");
    const theme = JSON.parse(await fs.readFile(file, "utf8"));
    const baseDir = path.dirname(file);
    const definitions = theme.iconDefinitions || {};
    const toUrl = (defId: string | undefined): string | undefined => {
      const iconPath = defId ? definitions[defId]?.iconPath : undefined;
      if (!iconPath) return undefined;
      const absolute = path.resolve(baseDir, iconPath);
      if (!absolute.startsWith(ext.dir)) return undefined;
      const relative = path.relative(ext.dir, absolute).split(path.sep).join("/");
      return `/ext-asset?ext=${encodeURIComponent(ext.id)}&path=${encodeURIComponent(relative)}`;
    };
    const mapDefs = (source: Record<string, string>, lower = false) => {
      const out: Record<string, string> = {};
      for (const [key, defId] of Object.entries(source || {})) {
        const url = toUrl(defId);
        if (url) out[lower ? key.toLowerCase() : key] = url;
      }
      return out;
    };
    return {
      file: toUrl(theme.file),
      folder: toUrl(theme.folder),
      folderExpanded: toUrl(theme.folderExpanded),
      fileNames: mapDefs(theme.fileNames || {}),
      fileExtensions: mapDefs(theme.fileExtensions || {}, true),
      folderNames: mapDefs(theme.folderNames || {}),
      folderNamesExpanded: mapDefs(theme.folderNamesExpanded || {}),
      languageIds: mapDefs(theme.languageIds || {}),
    };
  }

  readSettings(): Record<string, any> {
    try {
      return JSON.parse(readFileSync(path.join(this.workspaceRoot, "settings.json"), "utf8"));
    } catch {
      return {};
    }
  }

  /** Metadata + README/changelog for an installed extension. */
  async detail(id: string): Promise<any | null> {
    if (!this.scanned) await this.scan();
    const ext = this.extensions.get(id);
    if (!ext) return null;
    const manifest = ext.manifest || {};
    const readme = await readFirst(ext.dir, [
      "README.md",
      "readme.md",
      "Readme.md",
      "README.markdown",
      "README.txt",
    ]);
    const changelog = await readFirst(ext.dir, [
      "CHANGELOG.md",
      "changelog.md",
      "Changelog.md",
      "CHANGES.md",
    ]);
    return {
      ...this.list().find((item) => item.id === id),
      description: manifest.description || "",
      readme,
      changelog,
      readmeIsHtml: false,
      repository:
        typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url,
      license: manifest.license,
      categories: manifest.categories,
    };
  }

  // ---- language providers -------------------------------------------------

  async provideCompletionItems(
    uri: string,
    position: { line: number; character: number }
  ): Promise<any[]> {
    let entry = this.documents.get(uri);
    if (!entry) {
      try {
        const text = await fs.readFile(uriToPath(uri), "utf8");
        this.openDocument(uri, languageForPath(uriToPath(uri)), text);
        entry = this.documents.get(uri);
      } catch {
        return [];
      }
    }
    if (!entry) return [];
    await this.activateForLanguage(entry.languageId);
    const document = this.makeDocument(entry);
    const results: any[] = [];
    for (const { selector, provider } of this.completionProviders) {
      if (!matchesSelector(selector, document.languageId) || !provider?.provideCompletionItems) continue;
      try {
        const list = await provider.provideCompletionItems(
          document,
          position,
          cancellationToken(),
          { triggerKind: 0, triggerCharacter: undefined }
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
    let entry = this.documents.get(uri);
    if (!entry) {
      try {
        const text = await fs.readFile(uriToPath(uri), "utf8");
        this.openDocument(uri, languageForPath(uriToPath(uri)), text);
        entry = this.documents.get(uri);
      } catch {
        return null;
      }
    }
    if (!entry) return null;
    await this.activateForLanguage(entry.languageId);
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

  private createContext(ext: ExtensionInfo & { dir: string; manifest?: any }) {
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
      extension: {
        id: ext.id,
        extensionPath: ext.dir,
        extensionUri: uriFromPath(ext.dir),
        packageJSON: ext.manifest,
        isActive: true,
        exports: undefined,
      },
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

    class CodeActionKind {
      static readonly Empty = new CodeActionKind("");
      static readonly QuickFix = new CodeActionKind("quickfix");
      static readonly Refactor = new CodeActionKind("refactor");
      static readonly RefactorExtract = new CodeActionKind("refactor.extract");
      static readonly RefactorInline = new CodeActionKind("refactor.inline");
      static readonly RefactorRewrite = new CodeActionKind("refactor.rewrite");
      static readonly Source = new CodeActionKind("source");
      static readonly SourceOrganizeImports = new CodeActionKind("source.organizeImports");
      static readonly SourceFixAll = new CodeActionKind("source.fixAll");
      constructor(public readonly value: string) {}
      append(parts: string): CodeActionKind {
        return new CodeActionKind(this.value ? `${this.value}.${parts}` : parts);
      }
      intersects(other: CodeActionKind): boolean {
        return this.value.includes(other.value) || other.value.includes(this.value);
      }
      contains(other: CodeActionKind): boolean {
        return this.value === other.value || this.value.startsWith(`${other.value}.`);
      }
    }

    class CancellationTokenSource {
      private _isCancelled = false;
      private _emitter = new Emitter();
      get token() {
        return {
          isCancellationRequested: this._isCancelled,
          onCancellationRequested: this._emitter.event,
        };
      }
      cancel() {
        if (!this._isCancelled) {
          this._isCancelled = true;
          this._emitter.fire(undefined);
        }
      }
      dispose() {
        this._emitter.clear();
      }
    }

    class EventEmitter {
      private _emitter = new Emitter();
      get event() {
        return this._emitter.event;
      }
      fire(value?: any) {
        this._emitter.fire(value);
      }
      dispose() {
        this._emitter.clear();
      }
    }

    const languagesTarget = {
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
      match(selector: any, document: any): number {
        if (!document) return 0;
        return matchesSelector(selector, document.languageId) ? 10 : 0;
      },
      setLanguageConfiguration: () => ({ dispose() {} }),
      getLanguages: async () => [
        "plaintext",
        "javascript",
        "typescript",
        "php",
        "python",
        "html",
        "css",
        "json",
        "markdown",
        "shellscript",
        "yaml",
      ],
    };

    const languages = new Proxy(languagesTarget, {
      get(target: any, prop: string | symbol) {
        if (prop in target) return target[prop];
        if (
          typeof prop === "string" &&
          (prop.startsWith("register") || prop.startsWith("set"))
        ) {
          return () => ({ dispose() {} });
        }
        return undefined;
      },
    });

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
          return {
            text: "",
            tooltip: "",
            command: undefined,
            show() {},
            hide() {},
            dispose() {},
          };
        },
        setStatusBarMessage: () => ({ dispose() {} }),
        withProgress: async (_options: any, task: any) =>
          task(
            { report: () => {} },
            {
              isCancellationRequested: false,
              onCancellationRequested: () => ({ dispose() {} }),
            }
          ),
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
        get workspaceFile() {
          return undefined;
        },
        getWorkspaceFolder(_uri: any) {
          return {
            uri: uriFromPath(host.workspaceRoot),
            name: path.basename(host.workspaceRoot),
            index: 0,
          };
        },
        createFileSystemWatcher(
          _pattern: any,
          ignoreCreateEvents?: boolean,
          ignoreChangeEvents?: boolean,
          ignoreDeleteEvents?: boolean
        ) {
          const onDidCreate = new Emitter();
          const onDidChange = new Emitter();
          const onDidDelete = new Emitter();
          return {
            ignoreCreateEvents: Boolean(ignoreCreateEvents),
            ignoreChangeEvents: Boolean(ignoreChangeEvents),
            ignoreDeleteEvents: Boolean(ignoreDeleteEvents),
            onDidCreate: onDidCreate.event,
            onDidChange: onDidChange.event,
            onDidDelete: onDidDelete.event,
            dispose() {
              onDidCreate.clear();
              onDidChange.clear();
              onDidDelete.clear();
            },
          };
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
            return {
              type: info.isDirectory() ? 2 : 1,
              ctime: info.ctimeMs,
              mtime: info.mtimeMs,
              size: info.size,
            };
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
        saveAll: async () => true,
        asRelativePath: (value: any) => {
          const filePath = typeof value === "string" ? value : uriToPath(uriKey(value));
          return path.relative(host.workspaceRoot, filePath);
        },
      },
      languages,
      extensions: {
        getExtension: (id: string) => {
          const lower = (id || "").toLowerCase();
          const extension =
            host.extensions.get(id) ||
            [...host.extensions.values()].find(
              (e) => e.id.toLowerCase() === lower || e.name.toLowerCase() === lower
            );
          if (!extension) return undefined;
          return {
            id: extension.id,
            extensionPath: extension.dir,
            extensionUri: uriFromPath(extension.dir),
            packageJSON: extension.manifest,
            isActive: host.activated.has(extension.id),
            exports: host.activatedExports.get(extension.id),
            extensionKind: 1,
            activate: () => host.activate(extension.id),
          };
        },
        get all() {
          return [...host.extensions.values()].map((extension) => ({
            id: extension.id,
            extensionPath: extension.dir,
            extensionUri: uriFromPath(extension.dir),
            packageJSON: extension.manifest,
            isActive: host.activated.has(extension.id),
          }));
        },
        onDidChange: () => ({ dispose() {} }),
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
        parse: (value: string) => {
          const s = String(value);
          const isFile = s.startsWith("file://");
          const filePath = isFile ? uriToPath(s) : s;
          return {
            scheme: isFile ? "file" : s.includes(":") ? s.split(":")[0] : "file",
            fsPath: filePath,
            path: filePath,
            authority: "",
            query: "",
            fragment: "",
            toString: () => s,
          };
        },
        joinPath: (base: any, ...parts: string[]) =>
          uriFromPath(path.join(base.fsPath || base.path, ...parts)),
      },
      ThemeColor: class ThemeColor {
        constructor(public id: string) {}
      },
      ThemeIcon: class ThemeIcon {
        constructor(public id: string, public color?: any) {}
        static readonly File = new ThemeIcon("file");
        static readonly Folder = new ThemeIcon("folder");
      },
      StatusBarAlignment: { Left: 1, Right: 2 },
      ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
      TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
      EndOfLine: { LF: 1, CRLF: 2 },
      ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
      IndentAction: { None: 0, Block: 1, Indent: 2, IndentOutdent: 3 },
      ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
      CodeActionTriggerKind: { Invoke: 1, Automatic: 2 },
      CodeActionKind,
      CodeAction: class CodeAction {
        constructor(public title: string, public kind?: CodeActionKind) {}
      },
      CodeLens: class CodeLens {
        constructor(public range: any, public command?: any) {}
      },
      CompletionTriggerKind: {
        Invoke: 0,
        TriggerCharacter: 1,
        TriggerForIncompleteCompletions: 2,
      },
      CompletionItemTag: { Deprecated: 1 },
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
        Unit: 10,
        Value: 11,
        Enum: 12,
        Keyword: 13,
        Snippet: 14,
        Color: 15,
        File: 16,
        Reference: 17,
        Folder: 18,
        EnumMember: 19,
        Constant: 20,
        Struct: 21,
        Event: 22,
        Operator: 23,
        TypeParameter: 24,
      },
      CompletionList: class CompletionList {
        constructor(public items: any[] = [], public isIncomplete: boolean = false) {}
      },
      DocumentLink: class DocumentLink {
        constructor(public range: any, public target?: any) {}
      },
      InlayHint: class InlayHint {
        constructor(public position: any, public label: string | any[], public kind?: any) {}
      },
      InlayHintKind: { Type: 1, Parameter: 2 },
      CallHierarchyItem: class CallHierarchyItem {
        constructor(
          public kind: any,
          public name: string,
          public detail: string,
          public uri: any,
          public range: any,
          public selectionRange: any
        ) {}
      },
      TypeHierarchyItem: class TypeHierarchyItem {
        constructor(
          public kind: any,
          public name: string,
          public detail: string,
          public uri: any,
          public range: any,
          public selectionRange: any
        ) {}
      },
      SymbolKind: {
        File: 0,
        Module: 1,
        Namespace: 2,
        Package: 3,
        Class: 4,
        Method: 5,
        Property: 6,
        Field: 7,
        Constructor: 8,
        Enum: 9,
        Interface: 10,
        Function: 11,
        Variable: 12,
        Constant: 13,
        String: 14,
        Number: 15,
        Boolean: 16,
        Array: 17,
        Object: 18,
        Key: 19,
        Null: 20,
        EnumMember: 21,
        Struct: 22,
        Event: 23,
        Operator: 24,
        TypeParameter: 25,
      },
      SymbolInformation: class SymbolInformation {
        constructor(
          public name: string,
          public kind: number,
          public containerName: string | undefined,
          public location: any
        ) {}
      },
      DocumentSymbol: class DocumentSymbol {
        children: DocumentSymbol[] = [];
        constructor(
          public name: string,
          public detail: string,
          public kind: number,
          public range: any,
          public selectionRange: any
        ) {}
      },
      CancellationError: class CancellationError extends Error {
        constructor() {
          super("Canceled");
          this.name = "CancellationError";
        }
      },
      CancellationTokenSource,
      DocumentHighlight: class DocumentHighlight {
        constructor(public range: any, public kind?: number) {}
      },
      DocumentHighlightKind: { Text: 0, Read: 1, Write: 2 },
      FoldingRange: class FoldingRange {
        constructor(public start: number, public end: number, public kind?: number) {}
      },
      FoldingRangeKind: { Comment: 1, Imports: 2, Region: 3 },
      SnippetString: class SnippetString {
        constructor(public value: string = "") {}
        appendText(v: string) {
          this.value += v;
          return this;
        }
        appendTabstop(_num?: number) {
          return this;
        }
        appendPlaceholder(_value: string | ((snippet: SnippetString) => any), _num?: number) {
          return this;
        }
        appendChoice(_values: readonly string[], _num?: number) {
          return this;
        }
        appendVariable(_name: string, _defaultValue?: string | ((snippet: SnippetString) => any)) {
          return this;
        }
      },
      SignatureHelp: class SignatureHelp {
        signatures: any[] = [];
        activeSignature = 0;
        activeParameter = 0;
      },
      SignatureInformation: class SignatureInformation {
        parameters: any[] = [];
        constructor(public label: string, public documentation?: any) {}
      },
      ParameterInformation: class ParameterInformation {
        constructor(public label: string | [number, number], public documentation?: any) {}
      },
      DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
      DiagnosticTag: { Unnecessary: 1, Deprecated: 2 },
      Diagnostic: class Diagnostic {
        constructor(public range: any, public message: string, public severity?: number) {}
      },
      Position: class Position {
        constructor(public line: number, public character: number) {}
      },
      Range: class Range {
        readonly start: any;
        readonly end: any;
        constructor(a: any, b: any, c?: number, d?: number) {
          if (
            typeof a === "number" &&
            typeof b === "number" &&
            typeof c === "number" &&
            typeof d === "number"
          ) {
            this.start = { line: a, character: b };
            this.end = { line: c, character: d };
          } else {
            this.start = a;
            this.end = b;
          }
        }
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
          return (
            this.anchor.line === this.active.line &&
            this.anchor.character === this.active.character
          );
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
      EventEmitter,
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
    authority: "",
    query: "",
    fragment: "",
    toString: () => pathToUri(filePath),
  };
}

function stringItems(rest: any[]): string[] {
  return rest.filter((r) => typeof r === "string");
}

async function readFirst(dir: string, names: string[]): Promise<string | undefined> {
  for (const name of names) {
    try {
      return await fs.readFile(path.join(dir, name), "utf8");
    } catch {
      /* try next */
    }
  }
  return undefined;
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
  const label = typeof item.label === "string" ? item.label : item.label?.label ?? "";
  let insertText = item.insertText;
  if (insertText && typeof insertText === "object" && "value" in insertText) {
    insertText = insertText.value;
  }
  if (!insertText && item.textEdit?.newText) {
    insertText = item.textEdit.newText;
  }
  const range = item.textEdit?.range || item.range;
  return {
    label,
    kind: typeof item.kind === "number" ? item.kind + 1 : undefined,
    detail: item.detail || item.label?.detail,
    documentation:
      typeof item.documentation === "string" ? item.documentation : item.documentation?.value,
    insertText: insertText || label,
    insertTextFormat: item.insertTextFormat,
    range: range ? toRange(range) : undefined,
    sortText: item.sortText,
    filterText: item.filterText,
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
    ".jsonc": "jsonc",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "scss",
    ".sass": "sass",
    ".less": "less",
    ".md": "markdown",
    ".markdown": "markdown",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".php": "php",
    ".rb": "ruby",
    ".sh": "shellscript",
    ".bash": "shellscript",
    ".zsh": "shellscript",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".sql": "sql",
    ".xml": "xml",
  };
  return map[ext] || "plaintext";
}


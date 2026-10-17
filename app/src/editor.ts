import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  hoverTooltip,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  selectAll,
  undo,
} from "@codemirror/commands";
import {
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  snippet,
  startCompletion,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { setDiagnostics, lintGutter, lintKeymap, type Diagnostic } from "@codemirror/lint";
import { bridge } from "./bridge";
import { bus } from "./bus";
import { languageFor } from "./lang";
import { editorBaseTheme, refreshHighlighting, setShikiTheme, shikiHighlighting } from "./highlight";
import { clientLsp } from "./worker/client-lsp";

export interface OpenDoc {
  path: string;
  languageId: string;
  dirty: boolean;
  savedContent: string;
  state: EditorState;
}

const LSP_KIND: Record<number, string> = {
  1: "text",
  2: "method",
  3: "function",
  4: "function",
  5: "property",
  6: "variable",
  7: "class",
  8: "interface",
  9: "namespace",
  10: "property",
  11: "text",
  12: "constant",
  13: "enum",
  14: "keyword",
  15: "snippet",
  16: "color",
  17: "file",
  18: "reference",
  19: "folder",
  20: "enum",
  21: "constant",
  22: "class",
  23: "event",
  24: "operator",
  25: "type",
};

const fontCompartment = new Compartment();
const tabCompartment = new Compartment();
const wrapCompartment = new Compartment();
const lineNumbersCompartment = new Compartment();
const activeLineCompartment = new Compartment();
const themeCompartment = new Compartment();

type EditorPrefs = {
  fontSize: number;
  tabSize: number;
  wordWrap: "off" | "on";
  lineNumbers: boolean;
  highlightActiveLine: boolean;
  theme: string;
};

const DEFAULT_PREFS: EditorPrefs = {
  fontSize: 14,
  tabSize: 2,
  wordWrap: "off",
  lineNumbers: true,
  highlightActiveLine: true,
  theme: "dark-plus",
};

const fontSizeTheme = (size: number): Extension =>
  EditorView.theme({
    ".cm-content": { fontSize: `${size}px` },
    ".cm-gutters": { fontSize: `${Math.max(size - 1, 9)}px` },
  });

export class EditorManager {
  readonly view: EditorView;
  private prefs: EditorPrefs = { ...DEFAULT_PREFS };
  private docs = new Map<string, OpenDoc>();
  private listeners = new Set<() => void>();
  private diagnostics: {
    lsp: Map<string, any[]>;
    ext: Map<string, any[]>;
    client: Map<string, any[]>;
  } = {
    lsp: new Map(),
    ext: new Map(),
    client: new Map(),
  };
  active: string | null = null;

  constructor(parent: HTMLElement) {
    this.view = new EditorView({ parent, state: this.emptyState() });
    bridge.on("lsp.diagnostics", (params) =>
      this.applyDiagnostics(params.uri, params.diagnostics, "lsp")
    );
    bridge.on("ext.diagnostics", (params) =>
      this.applyDiagnostics(params.uri, params.diagnostics, "ext")
    );
    clientLsp.onDiagnostics((uri, diagnostics) =>
      this.applyDiagnostics(uri, diagnostics, "client")
    );
  }

  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get openDocs(): OpenDoc[] {
    return [...this.docs.values()];
  }

  get(path: string): OpenDoc | undefined {
    return this.docs.get(path);
  }

  private fire(): void {
    this.listeners.forEach((listener) => listener());
  }

  private emptyState(): EditorState {
    return EditorState.create({
      doc: "",
      extensions: [EditorView.editable.of(false), editorBaseTheme(this.prefs.theme)],
    });
  }

  private createState(path: string, content: string): EditorState {
    const spec = languageFor(path);
    const extensions: Extension[] = [
      highlightSpecialChars(),
      lineNumbersCompartment.of(
        this.prefs.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []
      ),
      activeLineCompartment.of(this.prefs.highlightActiveLine ? highlightActiveLine() : []),
      fontCompartment.of(fontSizeTheme(this.prefs.fontSize)),
      tabCompartment.of(EditorState.tabSize.of(this.prefs.tabSize)),
      wrapCompartment.of(this.prefs.wordWrap === "on" ? EditorView.lineWrapping : []),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ override: [(context) => this.complete(path, context)] }),
      rectangularSelection(),
      crosshairCursor(),
      highlightSelectionMatches(),
      lintGutter(),
      this.hoverTooltip(),
      themeCompartment.of(editorBaseTheme(this.prefs.theme)),
      shikiHighlighting(spec.shiki),
      ...spec.extensions,
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => this.handleUpdate(path, update)),
    ];
    return EditorState.create({ doc: content, extensions });
  }

  private handleUpdate(path: string, update: any): void {
    const doc = this.docs.get(path);
    if (!doc) return;
    doc.state = update.state;
    if (update.docChanged) {
      const text = update.state.doc.toString();
      const dirty = text !== doc.savedContent;
      const changed = dirty !== doc.dirty;
      doc.dirty = dirty;
      bus.emit("editor.change", { path, text });
      if (changed) this.fire();
    }
    if (update.selectionSet || update.docChanged) {
      bus.emit("editor.selection", { path, selection: selectionOf(update.state) });
    }
  }

  undo(): void {
    undo(this.view);
  }

  redo(): void {
    redo(this.view);
  }

  selectAll(): void {
    selectAll(this.view);
  }

  copySelection(): void {
    const { from, to } = this.view.state.selection.main;
    const text = this.view.state.sliceDoc(from, to);
    if (text && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => undefined);
    }
  }

  cutSelection(): void {
    const { from, to } = this.view.state.selection.main;
    const text = this.view.state.sliceDoc(from, to);
    if (text && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => undefined);
    }
    if (!this.view.state.selection.main.empty) {
      this.view.dispatch(this.view.state.replaceSelection(""));
    }
  }

  async paste(): Promise<void> {
    try {
      if (!navigator.clipboard) return;
      const text = await navigator.clipboard.readText();
      if (text) this.view.dispatch(this.view.state.replaceSelection(text));
    } catch {
      /* clipboard unavailable */
    }
  }

  async open(path: string, draft?: string, options: { activate?: boolean } = {}): Promise<void> {
    const activate = options.activate !== false;
    if (this.docs.has(path)) {
      if (activate) this.activate(path);
      return;
    }
    const savedContent = await bridge.request<string>("fs.readFile", { path });
    const spec = languageFor(path);
    const hasDraft = typeof draft === "string" && draft !== savedContent;
    const doc: OpenDoc = {
      path,
      languageId: spec.languageId,
      dirty: hasDraft,
      savedContent,
      state: this.createState(path, hasDraft ? draft! : savedContent),
    };
    this.docs.set(path, doc);
    if (activate) this.activate(path);
    bus.emit("editor.open", {
      path,
      languageId: spec.languageId,
      text: doc.state.doc.toString(),
    });
  }

  activate(path: string): void {
    const doc = this.docs.get(path);
    if (!doc) return;
    this.active = path;
    this.view.setState(doc.state);
    this.view.focus();
    this.fire();
    bus.emit("editor.active", { path, languageId: doc.languageId });
  }

  close(path: string): void {
    if (!this.docs.has(path)) return;
    this.docs.delete(path);
    bus.emit("editor.close", { path });
    if (this.active === path) {
      const next = [...this.docs.keys()].pop();
      if (next) {
        this.activate(next);
      } else {
        this.active = null;
        this.view.setState(this.emptyState());
      }
    }
    this.fire();
  }

  closeAll(): void {
    for (const path of [...this.docs.keys()]) this.close(path);
  }

  /** Apply editor-related settings live to every open document. */
  applySettings(settings: any): void {
    this.prefs = {
      fontSize: settings?.editor?.fontSize ?? DEFAULT_PREFS.fontSize,
      tabSize: settings?.editor?.tabSize ?? DEFAULT_PREFS.tabSize,
      wordWrap: settings?.editor?.wordWrap === "on" ? "on" : "off",
      lineNumbers: settings?.editor?.lineNumbers !== false,
      highlightActiveLine: settings?.editor?.highlightActiveLine !== false,
      theme: setShikiTheme(settings?.editor?.colorTheme ?? DEFAULT_PREFS.theme),
    };
    const effects = [
      fontCompartment.reconfigure(fontSizeTheme(this.prefs.fontSize)),
      tabCompartment.reconfigure(EditorState.tabSize.of(this.prefs.tabSize)),
      wrapCompartment.reconfigure(
        this.prefs.wordWrap === "on" ? EditorView.lineWrapping : []
      ),
      lineNumbersCompartment.reconfigure(
        this.prefs.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []
      ),
      activeLineCompartment.reconfigure(
        this.prefs.highlightActiveLine ? [highlightActiveLine()] : []
      ),
      themeCompartment.reconfigure(editorBaseTheme(this.prefs.theme)),
    ];
    for (const doc of this.docs.values()) {
      if (doc.path === this.active) continue;
      doc.state = doc.state.update({ effects }).state;
    }
    if (this.active) {
      this.view.dispatch({ effects: [...effects, refreshHighlighting.of(null)] });
    }
    this.fire();
  }

  async save(path?: string): Promise<void> {
    const target = path ?? this.active;
    if (!target) return;
    const doc = this.docs.get(target);
    if (!doc) return;
    const text = doc.state.doc.toString();
    await bridge.request("fs.writeFile", { path: target, content: text });
    doc.savedContent = text;
    doc.dirty = false;
    this.fire();
    bus.emit("editor.saved", { path: target });
  }

  async saveDocument(path: string): Promise<boolean> {
    await this.save(path);
    return true;
  }

  /** Open the completion popup at the cursor (Ctrl+Space). */
  triggerSuggest(): void {
    if (!this.active) return;
    this.view.focus();
    startCompletion(this.view);
  }

  showDocument(path: string): boolean {    if (this.docs.has(path)) {
      this.activate(path);
      return true;
    }
    this.open(path).catch(() => undefined);
    return true;
  }

  /** Re-render the tab strip (e.g. after an icon theme change). */
  refreshTabs(): void {
    this.fire();
  }

  /** Re-key an open document after the file was renamed on disk. */
  renamePath(from: string, to: string): void {
    const doc = this.docs.get(from);
    if (!doc) return;
    this.docs.delete(from);
    doc.path = to;
    doc.languageId = languageFor(to).languageId;
    this.docs.set(to, doc);
    if (this.active === from) this.active = to;
    bus.emit("editor.close", { path: from });
    bus.emit("editor.open", {
      path: to,
      languageId: doc.languageId,
      text: doc.state.doc.toString(),
    });
    bus.emit("editor.active", { path: to, languageId: doc.languageId });
    this.fire();
  }

  /** Open a file and put the cursor at a 1-based line / 0-based column. */  cursorOffset(path: string): number | undefined {
    return this.docs.get(path)?.state.selection.main.head;
  }

  setCursorOffset(path: string, offset: number): void {
    const doc = this.docs.get(path);
    if (!doc) return;
    if (this.active !== path) this.activate(path);
    const state = this.view.state;
    const position = Math.min(Math.max(offset, 0), state.doc.length);
    this.view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
  }

  async openAt(path: string, line = 1, column = 0): Promise<void> {
    await this.open(path);
    if (!this.docs.has(path)) return;
    const state = this.view.state;
    const lineNumber = Math.min(Math.max(line, 1), state.doc.lines);
    const info = state.doc.line(lineNumber);
    const position = Math.min(info.from + Math.max(column, 0), info.to);
    this.view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
    this.view.focus();
  }

  applyEdits(uri: string, edits: any[]): boolean {
    const path = uri.replace(/^file:\/\//, "");
    const docPath = [...this.docs.keys()].find((p) => p === path || path.endsWith("/" + p));
    if (!docPath) return false;
    if (this.active !== docPath) this.activate(docPath);
    const doc = this.docs.get(docPath);
    if (!doc) return false;
    const state = doc.state;
    const changes = (edits || [])
      .map((edit) => ({
        from: offsetOf(state, edit.range.start),
        to: offsetOf(state, edit.range.end),
        insert: edit.newText,
      }))
      .sort((a, b) => b.from - a.from);
    if (changes.length === 0) return true;
    this.view.dispatch({ changes });
    return true;
  }

  private async complete(path: string, context: CompletionContext): Promise<any> {
    const word = context.matchBefore(/[\w$#-]*/);
    if (!word) return null;
    if (word.from === word.to && !context.explicit) return null;
    const prefix = context.state.sliceDoc(word.from, context.pos);
    const line = context.state.doc.lineAt(context.pos);
    const position = { line: line.number - 1, character: context.pos - line.from };
    const uri = "file://" + path;

    const [lspItems, extItems, clientItems] = await Promise.all([
      bridge.request<any[]>("lsp.completion", { uri, position }).catch(() => []),
      bridge.request<any[]>("ext.completion", { uri, position }).catch(() => []),
      clientLsp.completion(uri, position).catch(() => []),
    ]);

    const seen = new Set<string>();
    const options: Completion[] = [];

    const addOption = (
      rawLabel: unknown,
      kind: number | undefined,
      rawDetail: unknown,
      rawDoc: unknown,
      rawInsert: unknown,
      insertTextFormat: number | undefined,
      boost: number
    ) => {
      const label =
        typeof rawLabel === "string"
          ? rawLabel
          : rawLabel && typeof rawLabel === "object" && "label" in rawLabel
            ? String((rawLabel as any).label)
            : "";
      if (!label || seen.has(label)) return;
      seen.add(label);

      let detail: string | undefined;
      if (typeof rawDetail === "string") {
        detail = rawDetail;
      } else if (rawLabel && typeof rawLabel === "object" && "detail" in rawLabel) {
        detail = String((rawLabel as any).detail);
      }

      let info: string | undefined;
      if (typeof rawDoc === "string") {
        info = rawDoc;
      } else if (rawDoc && typeof rawDoc === "object" && "value" in rawDoc) {
        info = String((rawDoc as any).value);
      }

      let apply: any = undefined;
      if (typeof rawInsert === "string" && rawInsert.length > 0) {
        if (insertTextFormat === 2 || /\$\{\d+:?[^}]*\}|\$\d/.test(rawInsert)) {
          try {
            apply = snippet(rawInsert);
          } catch {
            apply = rawInsert;
          }
        } else {
          apply = rawInsert;
        }
      }

      const type = kind !== undefined && LSP_KIND[kind] ? LSP_KIND[kind] : "text";

      options.push({
        label,
        type,
        detail,
        info,
        apply,
        boost,
      });
    };

    for (const item of [
      ...(lspItems || []),
      ...(extItems || []),
      ...(clientItems || []),
    ]) {
      addOption(
        item?.label,
        item?.kind,
        item?.detail,
        item?.documentation,
        item?.insertText,
        item?.insertTextFormat,
        99
      );
    }
    // VS Code-style word based suggestions, so Ctrl+Space is useful in every
    // language (these come from the open documents, never faked keywords).
    for (const candidate of this.wordsMatching(path, prefix, context.explicit)) {
      addOption(candidate, undefined, undefined, undefined, undefined, undefined, 0);
    }

    if (options.length === 0) return null;
    return { from: word.from, options, validFor: /^[\w$#-]*$/ };
  }

  private wordsMatching(activePath: string, prefix: string, explicit: boolean): string[] {
    const lower = prefix.toLowerCase();
    if (!lower && !explicit) return [];
    const limit = lower ? 200 : 40;
    const found = new Set<string>();
    const texts: string[] = [];
    const active = this.docs.get(activePath);
    if (active) texts.push(active.state.doc.toString());
    for (const doc of this.docs.values()) {
      if (doc.path !== activePath) texts.push(doc.state.doc.toString());
    }
    for (const text of texts) {
      const matches = text.match(/[A-Za-z_$][A-Za-z0-9_$]{1,}/g);
      if (!matches) continue;
      for (const match of matches) {
        if (lower && !match.toLowerCase().startsWith(lower)) continue;
        if (match === prefix) continue;
        found.add(match);
        if (found.size >= limit) break;
      }
      if (found.size >= limit) break;
    }
    return [...found].sort();
  }

  private hoverTooltip(): Extension {
    return hoverTooltip(async (view, pos) => {
      const path = this.active;
      if (!path) return null;
      const line = view.state.doc.lineAt(pos);
      const position = { line: line.number - 1, character: pos - line.from };
      const uri = "file://" + path;
      const [ext, lsp, client] = await Promise.all([
        bridge.request<any>("ext.hover", { uri, position }).catch(() => null),
        bridge.request<any>("lsp.hover", { uri, position }).catch(() => null),
        clientLsp.hover(uri, position).catch(() => null),
      ]);
      const parts = [
        hoverContents(lsp?.contents),
        hoverContents(client?.contents),
        ext?.contents,
      ].filter(Boolean) as string[];
      const text = parts.join("\n\n");
      if (!text) return null;
      return {
        pos,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "cm-hover";
          dom.textContent = text;
          return { dom };
        },
      };
    });
  }

  private applyDiagnostics(uri: string, diagnostics: any[], source: "lsp" | "ext" | "client"): void {
    const path = uri.replace(/^file:\/\//, "");
    this.diagnostics[source].set(path, diagnostics || []);
    const docPath = [...this.docs.keys()].find((p) => p === path || path.endsWith("/" + p));
    if (!docPath || this.active !== docPath) return;
    const doc = this.docs.get(docPath);
    if (!doc) return;
    const state = doc.state;
    const combined = [
      ...(this.diagnostics.lsp.get(path) || []),
      ...(this.diagnostics.ext.get(path) || []),
      ...(this.diagnostics.client.get(path) || []),
    ];
    const converted: Diagnostic[] = combined.map((item: any) => {
      const from = offsetOf(state, item.range.start);
      const to = Math.max(from, offsetOf(state, item.range.end));
      const severity: Diagnostic["severity"] =
        item.severity === 1 ? "error" : item.severity === 2 ? "warning" : "info";
      return { from, to, severity, message: item.message, source: item.source };
    });
    this.view.dispatch(setDiagnostics(state, converted));
  }
}

function hoverContents(contents: any): string {
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

function offsetOf(state: EditorState, position: { line: number; character: number }): number {
  const lineNumber = Math.min(Math.max(position.line + 1, 1), state.doc.lines);
  const line = state.doc.line(lineNumber);
  return Math.min(line.from + position.character, line.to);
}

function selectionOf(state: EditorState) {
  const main = state.selection.main;
  const positionAt = (offset: number) => {
    const line = state.doc.lineAt(offset);
    return { line: line.number - 1, character: offset - line.from };
  };
  const anchor = positionAt(main.anchor);
  const active = positionAt(main.head);
  return {
    anchor,
    active,
    start: positionAt(main.from),
    end: positionAt(main.to),
    isEmpty: main.empty,
  };
}

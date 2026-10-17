import { EditorState, type Extension } from "@codemirror/state";
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
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
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
  startCompletion,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { setDiagnostics, lintGutter, lintKeymap, type Diagnostic } from "@codemirror/lint";
import { bridge } from "./bridge";
import { bus } from "./bus";
import { languageFor } from "./lang";
import { shikiHighlighting, shikiEditorTheme } from "./highlight";

export interface OpenDoc {
  path: string;
  languageId: string;
  dirty: boolean;
  savedContent: string;
  state: EditorState;
}

const LSP_KIND: Record<number, string> = {
  2: "function",
  3: "function",
  5: "variable",
  6: "class",
  7: "interface",
  8: "namespace",
  9: "property",
  14: "keyword",
  15: "constant",
  16: "text",
  21: "constant",
};

export class EditorManager {
  readonly view: EditorView;
  private docs = new Map<string, OpenDoc>();
  private listeners = new Set<() => void>();
  private diagnostics: { lsp: Map<string, any[]>; ext: Map<string, any[]> } = {
    lsp: new Map(),
    ext: new Map(),
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
      extensions: [EditorView.editable.of(false), shikiEditorTheme],
    });
  }

  private createState(path: string, content: string): EditorState {
    const spec = languageFor(path);
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
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
      highlightActiveLine(),
      highlightSelectionMatches(),
      lintGutter(),
      this.hoverTooltip(),
      shikiEditorTheme,
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

  async open(path: string): Promise<void> {
    if (this.docs.has(path)) {
      this.activate(path);
      return;
    }
    const content = await bridge.request<string>("fs.readFile", { path });
    const spec = languageFor(path);
    const doc: OpenDoc = {
      path,
      languageId: spec.languageId,
      dirty: false,
      savedContent: content,
      state: this.createState(path, content),
    };
    this.docs.set(path, doc);
    this.activate(path);
    bus.emit("editor.open", { path, languageId: spec.languageId, text: content });
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

  showDocument(path: string): boolean {
    if (this.docs.has(path)) {
      this.activate(path);
      return true;
    }
    this.open(path).catch(() => undefined);
    return true;
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

  /** Open a file and put the cursor at a 1-based line / 0-based column. */
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
    if (!this.docs.has(path)) return false;
    if (this.active !== path) this.activate(path);
    const state = this.view.state;
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

    const [lspItems, extItems] = await Promise.all([
      bridge.request<any[]>("lsp.completion", { uri, position }).catch(() => []),
      bridge.request<any[]>("ext.completion", { uri, position }).catch(() => []),
    ]);

    const seen = new Set<string>();
    const options: Completion[] = [];
    const add = (label: unknown, type: string, detail?: unknown) => {
      if (typeof label !== "string" || !label || seen.has(label)) return;
      seen.add(label);
      options.push({ label, type, detail: typeof detail === "string" ? detail : undefined });
    };

    for (const item of [...(lspItems || []), ...(extItems || [])]) {
      add(item?.label, LSP_KIND[item?.kind] || "text", item?.detail);
    }
    // VS Code-style word based suggestions, so Ctrl+Space is useful in every
    // language (these come from the open documents, never faked keywords).
    for (const candidate of this.wordsMatching(path, prefix, context.explicit)) {
      add(candidate, "text");
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
      const [ext, lsp] = await Promise.all([
        bridge.request<any>("ext.hover", { uri, position }).catch(() => null),
        bridge.request<any>("lsp.hover", { uri, position }).catch(() => null),
      ]);
      const parts = [hoverContents(lsp?.contents), ext?.contents].filter(Boolean) as string[];
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

  private applyDiagnostics(uri: string, diagnostics: any[], source: "lsp" | "ext"): void {
    const path = uri.replace(/^file:\/\//, "");
    this.diagnostics[source].set(path, diagnostics || []);
    if (this.active !== path || !this.docs.has(path)) return;
    const state = this.view.state;
    const combined = [
      ...(this.diagnostics.lsp.get(path) || []),
      ...(this.diagnostics.ext.get(path) || []),
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

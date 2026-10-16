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
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { setDiagnostics, lintGutter, lintKeymap, type Diagnostic } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";
import { bridge } from "./bridge";
import { bus } from "./bus";
import { languageFor } from "./lang";

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
  active: string | null = null;

  constructor(parent: HTMLElement) {
    this.view = new EditorView({ parent, state: this.emptyState() });
    bridge.on("lsp.diagnostics", (params) =>
      this.applyDiagnostics(params.uri, params.diagnostics)
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
      extensions: [EditorView.editable.of(false), oneDark],
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
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ override: [(context) => this.complete(path, context)] }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      lintGutter(),
      oneDark,
      ...spec.extensions,
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            bus.emit("file.save");
            return true;
          },
        },
        {
          key: "Mod-Shift-p",
          preventDefault: true,
          run: () => {
            bus.emit("palette.open");
            return true;
          },
        },
        {
          key: "Ctrl-`",
          preventDefault: true,
          run: () => {
            bus.emit("panel.toggle");
            return true;
          },
        },
        {
          key: "Mod-b",
          preventDefault: true,
          run: () => {
            bus.emit("sidebar.toggle");
            return true;
          },
        },
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

  showDocument(path: string): boolean {
    if (this.docs.has(path)) {
      this.activate(path);
      return true;
    }
    this.open(path).catch(() => undefined);
    return true;
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
    const line = context.state.doc.lineAt(context.pos);
    try {
      const items = await bridge.request<any[]>("lsp.completion", {
        uri: "file://" + path,
        position: { line: line.number - 1, character: context.pos - line.from },
      });
      if (!items || items.length === 0) return null;
      const options: Completion[] = items.map((item: any) => ({
        label: item.label,
        type: LSP_KIND[item.kind] || "text",
        detail: item.detail,
      }));
      return { from: word.from, options, validFor: /^[\w$#-]*$/ };
    } catch {
      return null;
    }
  }

  private applyDiagnostics(uri: string, diagnostics: any[]): void {
    const path = uri.replace(/^file:\/\//, "");
    if (this.active !== path || !this.docs.has(path)) return;
    const state = this.view.state;
    const converted: Diagnostic[] = (diagnostics || []).map((item: any) => {
      const from = offsetOf(state, item.range.start);
      const to = Math.max(from, offsetOf(state, item.range.end));
      const severity: Diagnostic["severity"] =
        item.severity === 1 ? "error" : item.severity === 2 ? "warning" : "info";
      return { from, to, severity, message: item.message, source: item.source };
    });
    this.view.dispatch(setDiagnostics(state, converted));
  }
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

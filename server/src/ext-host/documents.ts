export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Selection extends Range {
  anchor: Position;
  active: Position;
  isEmpty: boolean;
}

export interface TextEdit {
  range: Range;
  newText: string;
}

/** Mutable state for one open document. */
export interface DocEntry {
  uri: string;
  languageId: string;
  version: number;
  text: string;
  dirty: boolean;
}

export function uriToPath(uri: string): string {
  return uri.replace(/^file:\/\//, "");
}

export function pathToUri(filePath: string): string {
  return filePath.startsWith("file://") ? filePath : `file://${filePath}`;
}

export function isEmptyRange(range: Range): boolean {
  return range.start.line === range.end.line && range.start.character === range.end.character;
}

function splitLines(text: string): string[] {
  return text.split("\n");
}

export interface TextLine {
  lineNumber: number;
  text: string;
  range: Range;
  rangeIncludingLineBreak: Range;
  firstNonWhitespaceCharacterIndex: number;
  isEmptyOrWhitespace: boolean;
}

export class TextDocumentImpl {
  constructor(
    readonly entry: DocEntry,
    private readonly saveHandler: (uri: string) => Promise<boolean>
  ) {}

  get uri(): any {
    const u = this.entry.uri;
    const fsPath = uriToPath(u);
    return {
      scheme: u.startsWith("file:") ? "file" : "untitled",
      fsPath,
      path: fsPath,
      authority: "",
      query: "",
      fragment: "",
      toString: () => u,
    };
  }
  get fileName(): string {
    return uriToPath(this.entry.uri);
  }
  get languageId(): string {
    return this.entry.languageId;
  }
  get version(): number {
    return this.entry.version;
  }
  get isDirty(): boolean {
    return this.entry.dirty;
  }
  get isClosed(): boolean {
    return false;
  }
  get isUntitled(): boolean {
    return false;
  }
  get eol(): number {
    return 1; // EndOfLine.LF
  }
  get lineCount(): number {
    return splitLines(this.entry.text).length;
  }

  getText(range?: Range): string {
    if (!range) return this.entry.text;
    return this.entry.text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
  }

  lineAt(lineOrPosition: number | Position): TextLine {
    const all = splitLines(this.entry.text);
    const requested = typeof lineOrPosition === "number" ? lineOrPosition : lineOrPosition.line;
    const line = Math.min(Math.max(requested, 0), all.length - 1);
    const text = all[line] ?? "";
    const firstNonWs = text.search(/\S/);
    return {
      lineNumber: line,
      text,
      range: { start: { line, character: 0 }, end: { line, character: text.length } },
      rangeIncludingLineBreak:
        line < all.length - 1
          ? { start: { line, character: 0 }, end: { line: line + 1, character: 0 } }
          : { start: { line, character: 0 }, end: { line, character: text.length } },
      firstNonWhitespaceCharacterIndex: firstNonWs === -1 ? text.length : firstNonWs,
      isEmptyOrWhitespace: firstNonWs === -1,
    };
  }

  positionAt(offset: number): Position {
    const text = this.entry.text;
    const clamped = Math.min(Math.max(offset, 0), text.length);
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < clamped; i++) {
      if (text.charCodeAt(i) === 10) {
        line += 1;
        lineStart = i + 1;
      }
    }
    return { line, character: clamped - lineStart };
  }

  offsetAt(position: Position): number {
    const all = splitLines(this.entry.text);
    const line = Math.min(Math.max(position.line, 0), all.length - 1);
    let offset = 0;
    for (let i = 0; i < line; i++) offset += all[i].length + 1;
    return offset + Math.min(Math.max(position.character, 0), all[line].length);
  }

  getWordRangeAtPosition(position: Position): Range | undefined {
    const offset = this.offsetAt(position);
    const text = this.entry.text;
    const isWord = (char: string | undefined) => Boolean(char && /[\w$]/.test(char));
    if (!isWord(text[offset]) && !isWord(text[offset - 1])) return undefined;
    let start = offset;
    let end = offset;
    while (start > 0 && isWord(text[start - 1])) start -= 1;
    while (end < text.length && isWord(text[end])) end += 1;
    return { start: this.positionAt(start), end: this.positionAt(end) };
  }

  save(): Promise<boolean> {
    return this.saveHandler(this.entry.uri);
  }
}

class EditBuilder {
  constructor(private readonly edits: TextEdit[]) {}

  replace(location: Range | Position, value: string): void {
    this.edits.push({ range: toRange(location), newText: value });
  }

  insert(position: Position, value: string): void {
    this.edits.push({ range: { start: toPosition(position), end: toPosition(position) }, newText: value });
  }

  delete(location: Range | Position): void {
    this.edits.push({ range: toRange(location), newText: "" });
  }

  setEndOfLine(): void {
    /* not supported */
  }
}

export class TextEditorImpl {
  constructor(
    readonly document: TextDocumentImpl,
    private readonly getSelection: () => Selection,
    private readonly applyEdits: (uri: string, edits: TextEdit[]) => Promise<boolean>
  ) {}

  get selection(): Selection {
    return this.getSelection();
  }
  get selections(): Selection[] {
    return [this.getSelection()];
  }
  get visibleRanges(): Range[] {
    return [
      {
        start: { line: 0, character: 0 },
        end: { line: Math.max(this.document.lineCount - 1, 0), character: 0 },
      },
    ];
  }
  get viewColumn(): number {
    return 1;
  }
  get options(): Record<string, unknown> {
    return { tabSize: 2, insertSpaces: true };
  }

  edit(callback: (builder: EditBuilder) => void): Promise<boolean> {
    const edits: TextEdit[] = [];
    callback(new EditBuilder(edits));
    if (edits.length === 0) return Promise.resolve(true);
    return this.applyEdits(this.document.uri, edits);
  }

  revealRange(): void {
    /* no-op */
  }
  setDecorations(): void {
    /* no-op */
  }
  insertSnippet(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

export function toPosition(value: any): Position {
  return { line: Number(value?.line ?? 0), character: Number(value?.character ?? 0) };
}

export function toRange(location: any): Range {
  if (!location) return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  const target = location.inserting || location.replacing || location;
  if (isRange(target)) return { start: toPosition(target.start), end: toPosition(target.end) };
  const position = toPosition(target);
  return { start: position, end: { ...position } };
}

export function isRange(value: unknown): value is Range {
  return Boolean(
    value &&
      typeof value === "object" &&
      "start" in (value as any) &&
      "end" in (value as any) &&
      typeof (value as any).start === "object"
  );
}

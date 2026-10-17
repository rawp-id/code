/**
 * Client-Side Language Service Web Worker.
 *
 * Runs 100% inside the browser / WebView without needing a native server or Node.js runtime.
 * Provides:
 * - Syntax parsing, linting, and error diagnostics with exact source ranges
 * - Intelligent autocompletions (keywords, built-in APIs, document symbols)
 * - Hover tooltips for standard language constructs
 */

interface DocumentEntry {
  uri: string;
  languageId: string;
  text: string;
  version: number;
}

interface DiagnosticItem {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  message: string;
  severity: 1 | 2 | 3 | 4; // 1: Error, 2: Warning, 3: Info, 4: Hint
  source: string;
}

interface CompletionItem {
  label: string;
  kind?: number; // 1: Text, 2: Method, 3: Function, 6: Variable, 7: Class, 14: Keyword, 15: Snippet
  detail?: string;
  documentation?: string;
  insertText?: string;
  insertTextFormat?: number;
}

const documents = new Map<string, DocumentEntry>();

// ---- Syntax Diagnostics ----------------------------------------------------

function parseJsonDiagnostics(text: string): DiagnosticItem[] {
  if (!text.trim()) return [];
  const diagnostics: DiagnosticItem[] = [];
  try {
    JSON.parse(text);
  } catch (err: any) {
    const msg = String(err?.message || err);
    let line = 0;
    let character = 0;

    const posMatch = msg.match(/position\s+(\d+)/i);
    const lineColMatch = msg.match(/line\s+(\d+)\s+column\s+(\d+)/i);

    if (lineColMatch) {
      line = Math.max(0, parseInt(lineColMatch[1], 10) - 1);
      character = Math.max(0, parseInt(lineColMatch[2], 10) - 1);
    } else if (posMatch) {
      const pos = Math.min(parseInt(posMatch[1], 10), text.length);
      const lines = text.slice(0, pos).split("\n");
      line = lines.length - 1;
      character = lines[lines.length - 1].length;
    } else {
      // General parse error fallback at EOF
      const lines = text.split("\n");
      line = lines.length - 1;
      character = lines[lines.length - 1].length;
    }

    diagnostics.push({
      range: {
        start: { line, character: Math.max(0, character - 1) },
        end: { line, character: character + 1 },
      },
      message: msg,
      severity: 1,
      source: "client-json",
    });
  }
  return diagnostics;
}

function parseBracketDiagnostics(text: string, lang: string): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];
  const stack: { char: string; line: number; col: number }[] = [];
  const lines = text.split("\n");

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let l = 0; l < lines.length; l++) {
    const line = lines[l];
    inLineComment = false;

    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      const next = line[c + 1];
      const prev = line[c - 1];

      // Escape check
      if (prev === "\\") continue;

      // Comment handling
      if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
        if (!inBlockComment && ch === "/" && next === "/") {
          inLineComment = true;
          break;
        }
        if (!inBlockComment && ch === "/" && next === "*") {
          inBlockComment = true;
          c++;
          continue;
        }
        if (inBlockComment && ch === "*" && next === "/") {
          inBlockComment = false;
          c++;
          continue;
        }
        if (lang === "python" && ch === "#") {
          inLineComment = true;
          break;
        }
      }

      if (inLineComment || inBlockComment) continue;

      // Quotes handling
      if (ch === "'" && !inDoubleQuote && !inBacktick) {
        inSingleQuote = !inSingleQuote;
        continue;
      }
      if (ch === '"' && !inSingleQuote && !inBacktick) {
        inDoubleQuote = !inDoubleQuote;
        continue;
      }
      if (ch === "`" && !inSingleQuote && !inDoubleQuote && (lang === "javascript" || lang === "typescript")) {
        inBacktick = !inBacktick;
        continue;
      }

      if (inSingleQuote || inDoubleQuote || inBacktick) continue;

      // Brackets check
      if (ch === "(" || ch === "{" || ch === "[") {
        stack.push({ char: ch, line: l, col: c });
      } else if (ch === ")" || ch === "}" || ch === "]") {
        const matching = ch === ")" ? "(" : ch === "}" ? "{" : "[";
        if (stack.length === 0) {
          diagnostics.push({
            range: { start: { line: l, character: c }, end: { line: l, character: c + 1 } },
            message: `Unmatched closing bracket '${ch}'`,
            severity: 1,
            source: "client-syntax",
          });
        } else {
          const top = stack.pop()!;
          if (top.char !== matching) {
            diagnostics.push({
              range: { start: { line: l, character: c }, end: { line: l, character: c + 1 } },
              message: `Mismatched bracket: expected '${top.char === "(" ? ")" : top.char === "{" ? "}" : "]"}' but found '${ch}'`,
              severity: 1,
              source: "client-syntax",
            });
          }
        }
      }
    }
  }

  // Check remaining unclosed brackets (report up to 5)
  for (const unclosed of stack.slice(-5)) {
    diagnostics.push({
      range: {
        start: { line: unclosed.line, character: unclosed.col },
        end: { line: unclosed.line, character: unclosed.col + 1 },
      },
      message: `Unclosed bracket '${unclosed.char}'`,
      severity: 1,
      source: "client-syntax",
    });
  }

  return diagnostics;
}

function parseDiagnostics(doc: DocumentEntry): DiagnosticItem[] {
  const lang = doc.languageId;
  if (lang === "json" || lang === "jsonc") {
    return parseJsonDiagnostics(doc.text);
  }
  if (["javascript", "typescript", "javascriptreact", "typescriptreact", "python", "rust", "go", "cpp", "c", "java", "css", "scss", "less"].includes(lang)) {
    return parseBracketDiagnostics(doc.text, lang);
  }
  return [];
}

// ---- Completions & Keywords ------------------------------------------------

const KEYWORDS: Record<string, string[]> = {
  javascript: [
    "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger",
    "default", "delete", "do", "else", "export", "extends", "finally", "for", "function",
    "if", "import", "in", "instanceof", "let", "new", "return", "super", "switch", "this",
    "throw", "try", "typeof", "var", "void", "while", "with", "yield", "true", "false", "null", "undefined"
  ],
  typescript: [
    "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger",
    "default", "delete", "do", "else", "export", "extends", "finally", "for", "function",
    "if", "import", "in", "instanceof", "let", "new", "return", "super", "switch", "this",
    "throw", "try", "typeof", "var", "void", "while", "with", "yield", "true", "false", "null", "undefined",
    "interface", "type", "enum", "namespace", "declare", "abstract", "as", "is", "implements", "readonly",
    "keyof", "unique", "unknown", "never", "any", "string", "number", "boolean"
  ],
  python: [
    "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del",
    "elif", "else", "except", "False", "finally", "for", "from", "global", "if", "import",
    "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "return",
    "True", "try", "while", "with", "yield"
  ],
  rust: [
    "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum",
    "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod",
    "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super",
    "trait", "true", "type", "unsafe", "use", "where", "while"
  ],
  go: [
    "break", "default", "func", "interface", "select", "case", "defer", "go", "map", "struct",
    "chan", "else", "goto", "package", "switch", "const", "fallthrough", "if", "range", "type",
    "continue", "for", "import", "return", "var", "nil", "true", "false"
  ],
  html: [
    "div", "span", "p", "a", "button", "input", "form", "label", "ul", "ol", "li",
    "table", "tr", "td", "th", "thead", "tbody", "section", "article", "header", "footer",
    "nav", "aside", "main", "h1", "h2", "h3", "h4", "h5", "h6", "img", "script", "style", "link", "meta"
  ],
  css: [
    "display", "position", "flex", "grid", "margin", "padding", "width", "height",
    "color", "background", "border", "font-family", "font-size", "font-weight",
    "align-items", "justify-content", "gap", "box-sizing", "z-index", "overflow",
    "cursor", "transition", "transform", "opacity", "border-radius"
  ],
  sql: [
    "SELECT", "FROM", "WHERE", "INSERT INTO", "UPDATE", "DELETE", "JOIN", "INNER JOIN",
    "LEFT JOIN", "RIGHT JOIN", "ON", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET",
    "CREATE TABLE", "DROP TABLE", "ALTER TABLE", "PRIMARY KEY", "FOREIGN KEY", "AND", "OR", "NOT"
  ]
};

const COMMON_APIS: Record<string, { label: string; detail: string; doc: string; kind: number }[]> = {
  javascript: [
    { label: "console.log()", detail: "console.log(data)", doc: "Outputs a message to the console", kind: 2 },
    { label: "console.error()", detail: "console.error(error)", doc: "Outputs an error message to the console", kind: 2 },
    { label: "console.warn()", detail: "console.warn(warning)", doc: "Outputs a warning message to the console", kind: 2 },
    { label: "Promise.all()", detail: "Promise.all(iterable)", doc: "Wait for all promises to resolve", kind: 2 },
    { label: "Promise.resolve()", detail: "Promise.resolve(value)", doc: "Returns a resolved Promise", kind: 2 },
    { label: "JSON.stringify()", detail: "JSON.stringify(value)", doc: "Converts a JS value to a JSON string", kind: 2 },
    { label: "JSON.parse()", detail: "JSON.parse(text)", doc: "Parses a JSON string into an object", kind: 2 },
    { label: "setTimeout()", detail: "setTimeout(handler, delay)", doc: "Schedules a function to run after delay ms", kind: 3 },
    { label: "fetch()", detail: "fetch(input, init)", doc: "Starts the process of fetching a resource from network", kind: 3 },
    { label: "document.querySelector()", detail: "document.querySelector(selectors)", doc: "Returns the first element matching selector", kind: 2 },
    { label: "document.getElementById()", detail: "document.getElementById(elementId)", doc: "Returns an element by its ID", kind: 2 },
  ],
  python: [
    { label: "print()", detail: "print(*objects, sep=' ', end='\\n')", doc: "Prints values to a stream or sys.stdout", kind: 3 },
    { label: "len()", detail: "len(s)", doc: "Return the number of items in a container", kind: 3 },
    { label: "range()", detail: "range(stop) or range(start, stop[, step])", doc: "Return an object that produces a sequence of integers", kind: 3 },
    { label: "enumerate()", detail: "enumerate(iterable, start=0)", doc: "Return an enumerate object yielding (index, value)", kind: 3 },
    { label: "isinstance()", detail: "isinstance(object, classinfo)", doc: "Return whether an object is an instance of a class", kind: 3 },
    { label: "open()", detail: "open(file, mode='r')", doc: "Open file and return a stream", kind: 3 },
  ]
};

function extractDocumentSymbols(text: string, lang: string): CompletionItem[] {
  const symbols: CompletionItem[] = [];
  const seen = new Set<string>();

  const add = (label: string, kind: number, detail: string) => {
    if (!label || seen.has(label) || label.length < 2) return;
    seen.add(label);
    symbols.push({ label, kind, detail });
  };

  if (lang === "javascript" || lang === "typescript" || lang === "javascriptreact" || lang === "typescriptreact") {
    // Functions
    const fnRegex = /(?:function\s+([a-zA-Z_$][\w$]*)|const\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)/g;
    let match: RegExpExecArray | null;
    while ((match = fnRegex.exec(text)) !== null) {
      const name = match[1] || match[2];
      if (name) add(name, 3, "function (in file)");
    }
    // Classes & Interfaces
    const clsRegex = /(?:class|interface|type)\s+([a-zA-Z_$][\w$]*)/g;
    while ((match = clsRegex.exec(text)) !== null) {
      if (match[1]) add(match[1], 7, "type/class (in file)");
    }
  } else if (lang === "python") {
    const pyRegex = /(?:def\s+([a-zA-Z_]\w*)|class\s+([a-zA-Z_]\w*))/g;
    let match: RegExpExecArray | null;
    while ((match = pyRegex.exec(text)) !== null) {
      if (match[1]) add(match[1], 3, "def (in file)");
      if (match[2]) add(match[2], 7, "class (in file)");
    }
  }

  return symbols;
}

function getCompletions(doc: DocumentEntry): CompletionItem[] {
  const lang = doc.languageId;
  const items: CompletionItem[] = [];

  // 1. Language Keywords
  const kwList = KEYWORDS[lang] || [];
  for (const kw of kwList) {
    items.push({
      label: kw,
      kind: 14,
      detail: `${kw} (keyword)`,
    });
  }

  // 2. Built-in APIs
  const apiList = COMMON_APIS[lang] || (lang.includes("javascript") || lang.includes("typescript") ? COMMON_APIS.javascript : []);
  for (const api of apiList) {
    items.push({
      label: api.label,
      kind: api.kind,
      detail: api.detail,
      documentation: api.doc,
      insertText: api.label.includes("()") ? api.label.replace("()", "($1)") : api.label,
      insertTextFormat: 2,
    });
  }

  // 3. Document Symbols
  const symbols = extractDocumentSymbols(doc.text, lang);
  items.push(...symbols);

  return items;
}

// ---- Hover Information -----------------------------------------------------

function getHover(doc: DocumentEntry, line: number, character: number): { contents: string } | null {
  const lines = doc.text.split("\n");
  if (line < 0 || line >= lines.length) return null;
  const lineText = lines[line];

  // Extract word under position
  let start = character;
  let end = character;
  while (start > 0 && /[\w$]/.test(lineText[start - 1])) start--;
  while (end < lineText.length && /[\w$]/.test(lineText[end])) end++;
  const word = lineText.slice(start, end);
  if (!word) return null;

  const lang = doc.languageId;
  const apis = COMMON_APIS[lang] || (lang.includes("javascript") || lang.includes("typescript") ? COMMON_APIS.javascript : []);
  const foundApi = apis.find((item) => item.label.startsWith(word + "(") || item.label.endsWith("." + word + "()"));
  if (foundApi) {
    return { contents: `\`\`\`${lang}\n${foundApi.detail}\n\`\`\`\n\n${foundApi.doc}` };
  }

  if (KEYWORDS[lang]?.includes(word)) {
    return { contents: `*(keyword)* \`${word}\`` };
  }

  return null;
}

// ---- Message Handling ------------------------------------------------------

self.onmessage = (event: MessageEvent) => {
  const { id, method, params } = event.data || {};
  if (!method) return;

  if (method === "textDocument/didOpen") {
    const entry: DocumentEntry = {
      uri: params.uri,
      languageId: params.languageId || "plaintext",
      text: params.text || "",
      version: 1,
    };
    documents.set(params.uri, entry);
    const diagnostics = parseDiagnostics(entry);
    self.postMessage({
      event: "textDocument/publishDiagnostics",
      data: { uri: params.uri, diagnostics },
    });
    if (id) self.postMessage({ id, result: true });
    return;
  }

  if (method === "textDocument/didChange") {
    const entry = documents.get(params.uri);
    if (entry) {
      entry.text = params.text;
      entry.version += 1;
      const diagnostics = parseDiagnostics(entry);
      self.postMessage({
        event: "textDocument/publishDiagnostics",
        data: { uri: params.uri, diagnostics },
      });
    }
    if (id) self.postMessage({ id, result: true });
    return;
  }

  if (method === "textDocument/didClose") {
    documents.delete(params.uri);
    self.postMessage({
      event: "textDocument/publishDiagnostics",
      data: { uri: params.uri, diagnostics: [] },
    });
    if (id) self.postMessage({ id, result: true });
    return;
  }

  if (method === "textDocument/completion") {
    const entry = documents.get(params.uri);
    const items = entry ? getCompletions(entry) : [];
    self.postMessage({ id, result: items });
    return;
  }

  if (method === "textDocument/hover") {
    const entry = documents.get(params.uri);
    const hover = entry ? getHover(entry, params.position?.line ?? 0, params.position?.character ?? 0) : null;
    self.postMessage({ id, result: hover });
    return;
  }
};

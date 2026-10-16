#!/usr/bin/env node
/**
 * Tiny generic language server used to prove the LSP pipeline end to end.
 *
 * It publishes diagnostics (long lines, TODO/FIXME comments, leftover
 * console.log) and offers keyword + document-word completions for any
 * language. Swap it for a real server (typescript-language-server, pyright,
 * ...) by editing `LspManager.serverFor`.
 */

let buffer = Buffer.alloc(0);
const documents = new Map();

const KEYWORDS = [
  "function", "const", "let", "var", "return", "if", "else", "for", "while",
  "class", "extends", "import", "export", "default", "async", "await", "try",
  "catch", "finally", "throw", "new", "this", "typeof", "instanceof", "switch",
  "case", "break", "continue", "interface", "type", "enum", "public", "private",
  "protected", "static", "readonly", "def", "lambda", "self", "None", "True",
  "False", "elif", "from", "as", "with", "yield", "pass", "in", "is", "not",
];

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function publishDiagnostics(uri, text) {
  const diagnostics = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 100) {
      diagnostics.push({
        range: { start: { line: i, character: 100 }, end: { line: i, character: line.length } },
        severity: 1,
        source: "demo",
        message: `Line is ${line.length} characters (limit 100)`,
      });
    }
    const todo = line.indexOf("TODO");
    if (todo !== -1) {
      diagnostics.push({
        range: { start: { line: i, character: todo }, end: { line: i, character: todo + 4 } },
        severity: 2,
        source: "demo",
        message: "Pending TODO",
      });
    }
    const fixme = line.indexOf("FIXME");
    if (fixme !== -1) {
      diagnostics.push({
        range: { start: { line: i, character: fixme }, end: { line: i, character: fixme + 5 } },
        severity: 1,
        source: "demo",
        message: "FIXME needs attention",
      });
    }
    const consoleLog = line.indexOf("console.log");
    if (consoleLog !== -1) {
      diagnostics.push({
        range: {
          start: { line: i, character: consoleLog },
          end: { line: i, character: consoleLog + "console.log".length },
        },
        severity: 3,
        source: "demo",
        message: "Consider removing console.log",
      });
    }
  }
  send({
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: { uri, diagnostics },
  });
}

function completionsFor(text) {
  const seen = new Set();
  const items = [];
  for (const keyword of KEYWORDS) {
    seen.add(keyword);
    items.push({ label: keyword, kind: 14, detail: "keyword" });
  }
  for (const word of text.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []) {
    if (word.length < 3 || seen.has(word)) continue;
    seen.add(word);
    items.push({ label: word, kind: 6, detail: "word" });
  }
  return items;
}

function handle(message) {
  const { id, method, params } = message;
  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          capabilities: {
            textDocumentSync: 1,
            completionProvider: { triggerCharacters: [".", ":"] },
          },
          serverInfo: { name: "demo-lsp", version: "0.1.0" },
        },
      });
      return;
    case "initialized":
    case "textDocument/didSave":
      return;
    case "textDocument/didOpen": {
      const { uri, text } = params.textDocument;
      documents.set(uri, text);
      publishDiagnostics(uri, text);
      return;
    }
    case "textDocument/didChange": {
      const uri = params.textDocument.uri;
      const change = params.contentChanges[params.contentChanges.length - 1];
      documents.set(uri, change.text);
      publishDiagnostics(uri, change.text);
      return;
    }
    case "textDocument/didClose":
      documents.delete(params.textDocument.uri);
      return;
    case "textDocument/completion": {
      const text = documents.get(params.textDocument.uri) || "";
      send({ jsonrpc: "2.0", id, result: completionsFor(text) });
      return;
    }
    case "shutdown":
      send({ jsonrpc: "2.0", id, result: null });
      return;
    case "exit":
      process.exit(0);
      return;
    default:
      if (id !== undefined) {
        send({ jsonrpc: "2.0", id, result: null });
      }
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString("ascii");
    const match = /Content-Length: (\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const body = buffer.subarray(start, start + length).toString("utf8");
    buffer = buffer.subarray(start + length);
    try {
      handle(JSON.parse(body));
    } catch (err) {
      process.stderr.write(`[demo-lsp] ${err}\n`);
    }
  }
});

process.stdin.on("end", () => process.exit(0));

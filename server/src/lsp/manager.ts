import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

interface ServerSpec {
  command: string;
  args?: string[];
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(HERE, "..", "..");
const DEMO_SERVER = path.resolve(SERVER_ROOT, "lsp-servers", "demo-lsp.mjs");

function uri(filePath: string): string {
  return pathToFileURL(filePath).toString();
}

function positionAt(text: string, offset: number): { line: number; character: number } {
  let line = 0;
  let lineStart = 0;
  const limit = Math.min(offset, text.length);
  for (let i = 0; i < limit; i++) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, character: limit - lineStart };
}

/** Find a `node_modules/.bin` executable by walking up from the server root. */
function resolveCommand(command: string): string {
  if (command.includes("/") || command.includes("\\")) return command;
  let dir = SERVER_ROOT;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "node_modules", ".bin", command);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return command; // fall back to PATH
}

/** A single language server process speaking LSP over stdio. */
class LspConnection {
  private proc: ChildProcess;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private disposed = false;
  private workspaceFolders: { uri: string; name: string }[];

  onNotification: (method: string, params: any) => void = () => {};
  onExit: (code: number | null) => void = () => {};

  constructor(
    command: string,
    args: string[],
    private workspaceRoot: string
  ) {
    this.workspaceFolders = [{ uri: uri(workspaceRoot), name: path.basename(workspaceRoot) }];
    this.proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr?.on("data", (chunk: Buffer) =>
      process.stderr.write(`[lsp] ${chunk.toString()}`)
    );
    this.proc.on("exit", (code) => {
      if (this.disposed) return;
      this.disposed = true;
      for (const pending of this.pending.values()) pending.reject(new Error("Language server exited"));
      this.pending.clear();
      this.onExit(code);
    });
    this.proc.on("error", (error) => {
      if (this.disposed) return;
      this.disposed = true;
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.onExit(null);
    });
  }

  get alive(): boolean {
    return !this.disposed && !this.proc.killed;
  }

  request(method: string, params: any): Promise<any> {
    if (!this.alive) return Promise.reject(new Error("Language server is not running"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`LSP timeout: ${method}`));
      }, 60000);
    });
  }

  notify(method: string, params: any): void {
    if (!this.alive) return;
    this.write(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  dispose(): void {
    this.disposed = true;
    try {
      this.notify("shutdown", null);
      this.notify("exit", null);
      this.proc.kill();
    } catch {
      /* ignore */
    }
  }

  private write(json: string): void {
    const body = Buffer.from(json, "utf8");
    this.proc.stdin?.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.proc.stdin?.write(body);
  }

  private sendResult(id: number, result: any): void {
    this.write(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  private sendError(id: number, code: number, message: string): void {
    this.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
  }

  private handleServerRequest(id: number, method: string, params: any): void {
    switch (method) {
      case "client/registerCapability":
      case "client/unregisterCapability":
      case "window/workDoneProgress/create":
      case "window/showMessageRequest":
      case "window/showDocument":
        this.sendResult(id, null);
        return;
      case "workspace/configuration": {
        const items = params?.items || [];
        this.sendResult(
          id,
          items.map((item: any) => configurationFor(item?.section))
        );
        return;
      }
      case "workspace/workspaceFolders":
        this.sendResult(id, this.workspaceFolders);
        return;
      case "workspace/applyEdit":
        this.sendResult(id, { applied: false });
        return;
      default:
        this.sendError(id, -32601, `Method not supported: ${method}`);
    }
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /Content-Length: (\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.subarray(start, start + length).toString("utf8");
      this.buffer = this.buffer.subarray(start + length);
      this.handleMessage(body);
    }
  }

  private handleMessage(body: string): void {
    let message: any;
    try {
      message = JSON.parse(body);
    } catch {
      return;
    }
    // Response to one of our requests.
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "LSP error"));
      else pending.resolve(message.result);
      return;
    }
    // Request from the server (needs a reply, otherwise it blocks).
    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message.id, message.method, message.params);
      return;
    }
    // Notification.
    if (message.method) {
      this.onNotification(message.method, message.params);
    }
  }
}

/**
 * Starts language servers lazily and routes documents to the connection that
 * owns each language. Real servers are resolved from `lsp.config.json`; the
 * bundled demo server is the fallback.
 */
export class LspManager {
  private connections = new Map<string, LspConnection>();
  private syncKinds = new Map<string, number>(); // connection key -> 1 full / 2 incremental
  private docLanguage = new Map<string, string>();
  private versions = new Map<string, number>();
  private lastText = new Map<string, string>();
  private connectionKeys = new Map<string, string>(); // languageId -> connection key
  private starting = new Map<string, Promise<LspConnection>>();

  constructor(
    private emit: (method: string, data: any) => void,
    private getWorkspaceRoot: () => string = () => process.cwd()
  ) {}

  /** Merge `lsp.config.json` from the workspace then the server package. */
  loadConfig(): Record<string, ServerSpec> {
    const merged: Record<string, ServerSpec> = {};
    for (const root of [this.getWorkspaceRoot(), SERVER_ROOT]) {
      try {
        Object.assign(merged, JSON.parse(readFileSync(path.join(root, "lsp.config.json"), "utf8")));
      } catch {
        /* no config here */
      }
    }
    return merged;
  }

  private serverFor(languageId: string): { command: string; args: string[] } | null {
    const config = this.loadConfig();
    const spec = config[languageId] || config["*"];
    if (!spec) return null;
    if (spec.command === "demo") return { command: process.execPath, args: [DEMO_SERVER] };
    return { command: resolveCommand(spec.command), args: spec.args ?? [] };
  }

  private async connectionFor(languageId: string): Promise<LspConnection | null> {
    const spec = this.serverFor(languageId);
    if (!spec) return null;
    const key = `${spec.command} ${spec.args.join(" ")}`;
    this.connectionKeys.set(languageId, key);

    const existing = this.connections.get(key);
    if (existing?.alive) return existing;

    const inFlight = this.starting.get(key);
    if (inFlight) return inFlight;

    const task = (async () => {
      const connection = new LspConnection(spec.command, spec.args, this.getWorkspaceRoot());
      connection.onNotification = (method, params) => {
        if (method === "textDocument/publishDiagnostics") {
          this.emit("lsp.diagnostics", params);
        } else if (method === "window/logMessage" || method === "window/showMessage") {
          this.emit("lsp.notification", { method, params });
        } else {
          this.emit("lsp.notification", { method, params });
        }
      };
      connection.onExit = (code) => {
        this.emit("lsp.exit", { languageId, code });
        this.connections.delete(key);
        this.starting.delete(key);
      };

      const root = this.getWorkspaceRoot();
      const result = await connection.request("initialize", {
        processId: process.pid,
        clientInfo: { name: "kode", version: "0.1.0" },
        rootUri: uri(root),
        workspaceFolders: [{ uri: uri(root), name: path.basename(root) }],
        capabilities: {
          textDocument: {
            synchronization: { dynamicRegistration: false, didSave: true },
            completion: {
              dynamicRegistration: false,
              contextSupport: true,
              completionItem: {
                snippetSupport: true,
                documentationFormat: ["markdown", "plaintext"],
                resolveSupport: { properties: ["documentation", "detail", "additionalTextEdits"] },
                insertReplaceSupport: true,
              },
            },
            hover: { dynamicRegistration: false, contentFormat: ["markdown", "plaintext"] },
            publishDiagnostics: { relatedInformation: true, versionSupport: false },
            definition: { linkSupport: true },
          },
          workspace: {
            workspaceFolders: true,
            configuration: true,
            didChangeConfiguration: { dynamicRegistration: false },
          },
          window: { workDoneProgress: true, showMessage: {}, showDocument: { support: true } },
        },
        initializationOptions: {},
      });
      connection.notify("initialized", {});

      this.syncKinds.set(key, syncKindOf(result));
      this.connections.set(key, connection);
      this.emit("lsp.ready", { languageId, server: path.basename(spec.command) });
      return connection;
    })();

    this.starting.set(key, task);
    try {
      return await task;
    } finally {
      this.starting.delete(key);
    }
  }

  async didOpen(documentUri: string, languageId: string, text: string): Promise<void> {
    this.docLanguage.set(documentUri, languageId);
    this.versions.set(documentUri, 1);
    this.lastText.set(documentUri, text);
    const connection = await this.connectionFor(languageId);
    if (!connection) return;
    connection.notify("textDocument/didOpen", {
      textDocument: { uri: documentUri, languageId, version: 1, text },
    });
  }

  async didChange(documentUri: string, text: string): Promise<void> {
    const languageId = this.docLanguage.get(documentUri);
    if (!languageId) return;
    const connection = await this.connectionFor(languageId);
    if (!connection) return;
    const key = this.connectionKeys.get(languageId)!;
    const previous = this.lastText.get(documentUri) ?? "";
    const version = (this.versions.get(documentUri) || 0) + 1;
    this.versions.set(documentUri, version);
    this.lastText.set(documentUri, text);

    const contentChanges =
      this.syncKinds.get(key) === 1
        ? [{ text }]
        : [
            {
              range: { start: { line: 0, character: 0 }, end: positionAt(previous, previous.length) },
              text,
            },
          ];
    connection.notify("textDocument/didChange", {
      textDocument: { uri: documentUri, version },
      contentChanges,
    });
  }

  async didClose(documentUri: string): Promise<void> {
    const languageId = this.docLanguage.get(documentUri);
    if (!languageId) return;
    const connection = this.connections.get(this.connectionKeys.get(languageId) || "");
    connection?.notify("textDocument/didClose", { textDocument: { uri: documentUri } });
    this.docLanguage.delete(documentUri);
    this.versions.delete(documentUri);
    this.lastText.delete(documentUri);
  }

  async completion(documentUri: string, position: { line: number; character: number }): Promise<any> {
    const languageId = this.docLanguage.get(documentUri);
    if (!languageId) return null;
    const connection = await this.connectionFor(languageId);
    if (!connection) return [];
    const result = await connection.request("textDocument/completion", {
      textDocument: { uri: documentUri },
      position,
    });
    if (!result) return [];
    return Array.isArray(result) ? result : result.items || [];
  }

  async request(documentUri: string, method: string, params: any): Promise<any> {
    const languageId = this.docLanguage.get(documentUri);
    if (!languageId) throw new Error(`No language registered for ${documentUri}`);
    const connection = await this.connectionFor(languageId);
    if (!connection) throw new Error(`No language server configured for ${languageId}`);
    return connection.request(method, params);
  }

  dispose(): void {
    for (const connection of this.connections.values()) connection.dispose();
    this.connections.clear();
  }
}

function syncKindOf(initializeResult: any): number {
  const sync = initializeResult?.capabilities?.textDocumentSync;
  if (typeof sync === "number") return sync;
  if (sync && typeof sync === "object" && typeof sync.change === "number") return sync.change;
  return 1;
}

/** Sensible defaults for the language servers we ship, keyed by config section. */
function configurationFor(section: string | undefined): any {
  switch (section) {
    case "json":
    case "jsonc":
      return { validate: { enable: true }, format: { enable: false }, schemas: [] };
    case "css":
    case "scss":
    case "less":
      return { validate: true, lint: { unknownAtRules: "ignore" }, format: {} };
    case "html":
      return { suggest: {}, format: {} };
    case "typescript":
    case "javascript":
      return { suggest: {}, format: {}, validate: { enable: true } };
    case "markdown":
      return { occurrencesHighlight: true };
    default:
      return {};
  }
}

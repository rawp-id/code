import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(HERE, "..", "..");
const DEMO_SERVER = path.resolve(SERVER_ROOT, "lsp-servers", "demo-lsp.mjs");

interface ServerSpec {
  command: string;
  args?: string[];
}

/** A single language server process speaking LSP over stdio. */
class LspConnection {
  private proc: ChildProcess;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private disposed = false;

  onNotification: (method: string, params: any) => void = () => {};
  onExit: (code: number | null) => void = () => {};

  constructor(command: string, args: string[]) {
    this.proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr?.on("data", (chunk: Buffer) =>
      process.stderr.write(`[lsp] ${chunk.toString()}`)
    );
    this.proc.on("exit", (code) => {
      if (this.disposed) return;
      this.disposed = true;
      for (const pending of this.pending.values()) {
        pending.reject(new Error("Language server exited"));
      }
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
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write(payload);
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`LSP timeout: ${method}`));
      }, 30000);
    });
  }

  notify(method: string, params: any): void {
    if (!this.alive) return;
    this.write(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  dispose(): void {
    this.disposed = true;
    try {
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
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "LSP error"));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) this.onNotification(message.method, message.params);
  }
}

/**
 * Starts language servers lazily and routes document events / requests to the
 * connection that owns each language.
 */
export class LspManager {
  private connections = new Map<string, LspConnection>();
  private docLanguage = new Map<string, string>();
  private versions = new Map<string, number>();
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

  private serverFor(languageId: string): { command: string; args: string[] } {
    const spec = this.loadConfig()[languageId] || this.loadConfig()["*"];
    if (!spec || spec.command === "demo") {
      return { command: process.execPath, args: [DEMO_SERVER] };
    }
    return { command: spec.command, args: spec.args ?? [] };
  }

  private async connectionFor(languageId: string): Promise<LspConnection> {
    const existing = this.connections.get(languageId);
    if (existing?.alive) return existing;

    const inFlight = this.starting.get(languageId);
    if (inFlight) return inFlight;

    const task = (async () => {
      const spec = this.serverFor(languageId);
      const connection = new LspConnection(spec.command, spec.args);
      connection.onNotification = (method, params) => {
        if (method === "textDocument/publishDiagnostics") {
          this.emit("lsp.diagnostics", params);
        } else {
          this.emit("lsp.notification", { method, params });
        }
      };
      connection.onExit = (code) => {
        this.emit("lsp.exit", { languageId, code });
        this.connections.delete(languageId);
        this.starting.delete(languageId);
      };
      await connection.request("initialize", {
        processId: process.pid,
        rootUri: null,
        capabilities: {
          textDocument: {
            completion: { completionItem: { snippetSupport: false } },
            publishDiagnostics: {},
          },
        },
      });
      connection.notify("initialized", {});
      this.connections.set(languageId, connection);
      this.emit("lsp.ready", { languageId });
      return connection;
    })();

    this.starting.set(languageId, task);
    try {
      return await task;
    } finally {
      this.starting.delete(languageId);
    }
  }

  async didOpen(uri: string, languageId: string, text: string): Promise<void> {
    this.docLanguage.set(uri, languageId);
    this.versions.set(uri, 1);
    const connection = await this.connectionFor(languageId);
    connection.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
  }

  async didChange(uri: string, text: string): Promise<void> {
    const languageId = this.docLanguage.get(uri);
    if (!languageId) return;
    const connection = await this.connectionFor(languageId);
    const version = (this.versions.get(uri) || 0) + 1;
    this.versions.set(uri, version);
    connection.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  async didClose(uri: string): Promise<void> {
    const languageId = this.docLanguage.get(uri);
    if (!languageId) return;
    const connection = this.connections.get(languageId);
    connection?.notify("textDocument/didClose", { textDocument: { uri } });
    this.docLanguage.delete(uri);
    this.versions.delete(uri);
  }

  async completion(uri: string, position: { line: number; character: number }): Promise<any> {
    const languageId = this.docLanguage.get(uri);
    if (!languageId) return null;
    const connection = await this.connectionFor(languageId);
    const result = await connection.request("textDocument/completion", {
      textDocument: { uri },
      position,
    });
    if (!result) return [];
    return Array.isArray(result) ? result : result.items || [];
  }

  async request(uri: string, method: string, params: any): Promise<any> {
    const languageId = this.docLanguage.get(uri);
    if (!languageId) throw new Error(`No language registered for ${uri}`);
    const connection = await this.connectionFor(languageId);
    return connection.request(method, params);
  }

  dispose(): void {
    for (const connection of this.connections.values()) connection.dispose();
    this.connections.clear();
  }
}

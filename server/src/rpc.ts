import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WebSocket } from "ws";
import { Workspace } from "./workspace.js";
import { PtyManager } from "./pty.js";
import { ExtensionHost, type UiBridge } from "./ext-host/host.js";
import { LspManager } from "./lsp/manager.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(HERE, "..");
const EXTENSIONS_DIR = path.join(SERVER_ROOT, "extensions");
const DEFAULT_WORKSPACE =
  process.env.EDITOR_WORKSPACE || path.join(SERVER_ROOT, "workspace");

type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

export function handleConnection(ws: WebSocket): void {
  const workspace = new Workspace(DEFAULT_WORKSPACE);
  const pty = new PtyManager();
  const clientPending = new Map<number, Pending>();
  let clientSeq = 1;

  const send = (message: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  const event = (name: string, data?: unknown) => send({ event: name, data });

  const callClient = (method: string, params: any): Promise<any> => {
    const id = clientSeq++;
    return new Promise((resolve, reject) => {
      clientPending.set(id, { resolve, reject });
      send({ id, method, params });
      setTimeout(() => {
        if (clientPending.delete(id)) reject(new Error(`Client timeout: ${method}`));
      }, 30000);
    });
  };

  const lsp = new LspManager((method, data) => event(method, data));

  const ui: UiBridge = {
    showMessage: (kind, message, items) =>
      callClient("ui.showMessage", { kind, message, items }).catch(() => undefined),
    showQuickPick: (items, options) =>
      callClient("ui.showQuickPick", { items, options }).catch(() => undefined),
    showInputBox: (options) =>
      callClient("ui.showInputBox", { options }).catch(() => undefined),
    output: (channel, line) => event("output.line", { channel, line }),
    executeCommand: (command, ...args) => host.executeCommand(command, args),
    setDiagnostics: (uri, diagnostics) => event("ext.diagnostics", { uri, diagnostics }),
    applyEdits: (uri, edits) =>
      callClient("editor.applyEdits", { uri, edits })
        .then((result) => result !== false)
        .catch(() => false),
    saveDocument: (uri) =>
      callClient("editor.saveDocument", { uri })
        .then((result) => result !== false)
        .catch(() => false),
    showDocument: (uri) =>
      callClient("editor.showDocument", { uri })
        .then((result) => result !== false)
        .catch(() => false),
  };

  const host = new ExtensionHost(EXTENSIONS_DIR, workspace.root, ui);

  const methods: Record<string, (params: any) => any> = {
    "server.info": async () => ({
      workspace: await workspace.info(),
      pty: pty.ptyAvailable,
      node: process.version,
      platform: process.platform,
    }),

    "ws.info": () => workspace.info(),
    "ws.setRoot": async ({ root }: { root: string }) => {
      workspace.root = path.resolve(root);
      host.workspaceRoot = workspace.root;
      return workspace.info();
    },

    "fs.readDir": ({ path: rel }: { path: string }) => workspace.readDir(rel),
    "fs.readFile": ({ path: rel }: { path: string }) => workspace.readFile(rel),
    "fs.writeFile": ({ path: rel, content }: { path: string; content: string }) =>
      workspace.writeFile(rel, content),
    "fs.createFile": ({ path: rel }: { path: string }) => workspace.createFile(rel),
    "fs.mkdir": ({ path: rel }: { path: string }) => workspace.mkdir(rel),
    "fs.rename": ({ from, to }: { from: string; to: string }) => workspace.rename(from, to),
    "fs.delete": ({ path: rel }: { path: string }) => workspace.delete(rel),

    "doc.open": ({ uri, languageId, text }: { uri: string; languageId: string; text: string }) => {
      host.openDocument(uri, languageId, text);
      return true;
    },
    "doc.change": ({ uri, text }: { uri: string; text: string }) => {
      host.changeDocument(uri, text);
      return true;
    },
    "doc.save": ({ uri }: { uri: string }) => {
      host.saveDocument(uri);
      return true;
    },
    "doc.close": ({ uri }: { uri: string }) => {
      host.closeDocument(uri);
      return true;
    },
    "doc.active": ({ uri }: { uri: string }) => {
      host.setActiveDocument(uri);
      return true;
    },
    "doc.selection": ({ uri, selection }: any) => {
      host.setSelection(uri, selection);
      return true;
    },
    "doc.list": () =>
      host.listDocuments().map((document) => ({
        uri: document.uri,
        languageId: document.languageId,
        version: document.version,
        isDirty: document.isDirty,
      })),

    "pty.spawn": ({ cols, rows, shell }: { cols: number; rows: number; shell?: string }) =>
      pty
        .spawn({ cols, rows, shell, cwd: workspace.root }, (id, data) =>
          event("pty.data", { id, data })
        , (id, code) => event("pty.exit", { id, code }))
        .then((id) => ({ id })),
    "pty.write": ({ id, data }: { id: string; data: string }) => pty.write(id, data),
    "pty.resize": ({ id, cols, rows }: { id: string; cols: number; rows: number }) =>
      pty.resize(id, cols, rows),
    "pty.kill": ({ id }: { id: string }) => pty.kill(id),

    "ext.list": async () => {
      await host.scan();
      await host.activateStartup();
      return host.list();
    },
    "ext.activate": ({ id }: { id: string }) => host.activate(id),
    "ext.deactivate": ({ id }: { id: string }) => host.deactivate(id),
    "ext.commands": () =>
      [...host.commands.entries()].map(([command, entry]) => ({
        command,
        title: entry.title,
        extension: entry.extension,
      })),
    "ext.execCommand": ({ command, args }: { command: string; args?: any[] }) =>
      host.executeCommand(command, args || []),
    "ext.completion": ({ uri, position }: any) => host.provideCompletionItems(uri, position),
    "ext.hover": ({ uri, position }: any) => host.provideHover(uri, position),

    "lsp.didOpen": ({ uri, languageId, text }: any) => lsp.didOpen(uri, languageId, text),
    "lsp.didChange": ({ uri, text }: any) => lsp.didChange(uri, text),
    "lsp.didClose": ({ uri }: any) => lsp.didClose(uri),
    "lsp.completion": ({ uri, position }: any) => lsp.completion(uri, position),
    "lsp.hover": ({ uri, position }: any) =>
      lsp.request(uri, "textDocument/hover", { textDocument: { uri }, position }).catch(() => null),
    "lsp.request": ({ uri, method, params }: any) => lsp.request(uri, method, params),
  };

  ws.on("message", (raw) => {
    let message: any;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.event) return; // no server-bound notifications yet

    if (typeof message.id === "number") {
      if (message.method) {
        const handler = methods[message.method];
        if (!handler) {
          send({ id: message.id, error: { message: `Unknown method: ${message.method}` } });
          return;
        }
        Promise.resolve()
          .then(() => handler(message.params || {}))
          .then(
            (result) => send({ id: message.id, result: result ?? null }),
            (error) =>
              send({
                id: message.id,
                error: { message: error?.message ? String(error.message) : String(error) },
              })
          );
      } else {
        const pending = clientPending.get(message.id);
        if (!pending) return;
        clientPending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      }
    }
  });

  ws.on("close", () => {
    pty.killAll();
    lsp.dispose();
    for (const pending of clientPending.values()) pending.reject(new Error("Disconnected"));
    clientPending.clear();
  });
}

# Kode

A lightweight, VS Code-like editor with a **real Node extension host** and an
**LSP language server**. Web-first (runs in the browser today), designed to be
wrapped by Capacitor for Android later.

```
app/      Vite + TypeScript + CodeMirror 6 UI (the editor shell)
server/   Node process: workspace FS, terminal (pty), extension host, LSP
```

## What works right now

- File explorer, tabs, save (`Ctrl+S`), dirty indicators, status bar.
- Syntax highlighting for JS/TS, JSON, HTML, CSS, Markdown, Python.
- Command palette (`Ctrl+Shift+P`) with built-in and extension commands.
- Integrated terminal (`Ctrl+`` `) backed by a pty (Node `child_process`
  fallback when `node-pty` cannot build).
- **Extension host** that loads CommonJS VS Code extensions and serves a
  `vscode` API shim (commands, window messages, input box, quick pick, output
  channels).
- **Language server** over LSP: diagnostics, completion, and generic requests.
  Ships with `server/lsp-servers/demo-lsp.mjs` so the pipeline works out of the
  box; swap it for a real server in `server/src/lsp/manager.ts`.

## Run it

```bash
npm install
npm run dev
```

- Web UI: http://127.0.0.1:5173
- Server: ws://127.0.0.1:3177/ws

To expose the dev server on your LAN (for phone testing / Capacitor live
reload): `npm run dev:lan` then open `http://<your-ip>:5173`.

### Pointing at your own project

By default the editor opens `server/workspace`. To open another directory:

```bash
EDITOR_WORKSPACE=/path/to/project npm run dev
```

or use **Workspace: Open Folder…** from the command palette.

## Extensions

Drop a folder in `server/extensions/` containing a `package.json` (with
`contributes.commands`) and a CommonJS `main` (e.g. `extension.js`) that calls
`require('vscode')`. See `server/extensions/hello` and
`server/extensions/word-count` for working examples.

The shim currently supports:

| Namespace | Supported |
| --- | --- |
| `commands` | `registerCommand`, `executeCommand`, `getCommands` |
| `window` | info/warning/error messages, `showQuickPick`, `showInputBox`, `createOutputChannel`, `createStatusBarItem` |
| `workspace` | `getConfiguration`, `workspaceFolders`, `fs` (stubs) |
| `languages` | registration stubs, `createDiagnosticCollection` |
| misc | `Uri`, `EventEmitter`, `Diagnostic`, `Position`, `Range`, `CompletionItem`, … |

Extensions run inside a `vm` wrapper with `require('vscode')` replaced by the
shim; `require('fs')`, `require('path')`, and other Node builtins work normally.

## Terminal

`PtyManager` uses `node-pty` when it is available. When it is not (no native
build), it falls back to a plain `child_process` shell: output works, but there
is no echo and no job control. On Android the plan is a native JNI `forkpty`
behind the same interface.

## Next steps

1. Grow the `vscode` shim (text edits, document events, `languages` providers).
2. Configurable LSP servers per language (`lsp.config.json`).
3. Wrap the web app with Capacitor and add native plugins (`PtyPlugin`,
   `FsPlugin`, `ExecPlugin`) behind the same bridge protocol.

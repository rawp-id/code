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
  `vscode` API shim with a real text document model, text edits, workspace
  edits, events, and on-demand activation.
- **Settings** read from `settings.json` at the workspace root via
  `workspace.getConfiguration()`.
- **Language server** over LSP: diagnostics, completion, hover, and generic
  requests. Servers are configured per language in `lsp.config.json`;
  `server/lsp-servers/demo-lsp.mjs` is the default so the pipeline works out of
  the box.

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
`require('vscode')`. Extensions activate **on demand**: running one of their
commands (from the palette or the Extensions sidebar) activates the owning
extension automatically, matching `activationEvents`.

Working examples:

- `hello` — messages, input box, quick pick, output channel.
- `word-count` — reads a file with Node `fs`.
- `text-tools` — document model, `TextEditor.edit`, `WorkspaceEdit`,
  `onDidChangeTextDocument` / `onDidSaveTextDocument` / selection events.

The shim currently supports:

| Namespace | Supported |
| --- | --- |
| `commands` | `registerCommand`, `executeCommand`, `getCommands` |
| `window` | active editor, messages, `showQuickPick`, `showInputBox`, `showTextDocument`, `createOutputChannel`, selection/active-editor events |
| `workspace` | `textDocuments`, `getConfiguration` (from `settings.json`), `workspaceFolders`, `applyEdit`, `openTextDocument`, `onDidOpen/Change/Save/CloseTextDocument`, `fs` |
| `languages` | registration stubs, `createDiagnosticCollection` |
| text model | `TextDocument` (getText, lineAt, offsetAt, positionAt, save), `TextEditor.edit`, `WorkspaceEdit`, `TextEdit` |
| misc | `Uri`, `EventEmitter`, `Selection`, `Diagnostic`, `Position`, `Range`, `CompletionItem`, `WorkspaceEdit`, … |

Extensions run inside a `vm` wrapper with `require('vscode')` replaced by the
shim; `require('fs')`, `require('path')`, and other Node builtins work normally.

### Installing extensions

Use **Extensions: Install from VSIX…** from the command palette and give a local
`.vsix` path or a URL. **Extensions: Uninstall…** removes one. Only CommonJS
extensions that stay inside the implemented API surface will run; extensions
relying on unimplemented APIs load but may throw when those APIs are used.

> Extensions execute with full Node privileges in the server process. Only
> install extensions you trust.

## Terminal

`PtyManager` uses `node-pty` when it is available. When it is not (no native
build), it falls back to a plain `child_process` shell: output works, but there
is no echo and no job control. On Android the plan is a native JNI `forkpty`
behind the same interface.

## Language servers

`lsp.config.json` maps a language id to a server command. It is merged from the
workspace root and the server package root, so a workspace can override the
defaults. `"*"` is the fallback and `"demo"` selects the bundled demo server.

```json
{
  "*": { "command": "demo" },
  "python": { "command": "pyright-langserver", "args": ["--stdio"] },
  "typescript": { "command": "typescript-language-server", "args": ["--stdio"] }
}
```

See `server/lsp.config.example.json` for more. A server is started lazily the
first time a document of that language is opened. If the command cannot be
spawned the failure is reported and the editor keeps working. Use
**LSP: Show Server Config** from the palette to inspect the merged config.

## Android (Capacitor)

The web UI is wrapped with Capacitor; the native project lives in `app/android`.

The editor talks to the Node server over WebSocket at `VITE_SERVER_URL`
(default `ws://<hostname>:3177/ws`). On a phone that means the server has to run
**on the device** (or on your LAN during development).

```bash
# build the web app and copy it into the Android project
npm run android:sync
# open the project in Android Studio
npm run android:open
```

The server address is **not** fixed at build time: use **Connection: Set Server
URL…** from the command palette (or the connect dialog that appears when the
server is unreachable). It is persisted on the device.

For LAN development, start `npm run dev:lan` and point the app at
`ws://<your-ip>:3177/ws`.

### Run the server on the device (Termux / proot)

The quickest way to get the full server running on Android today:

```bash
# on the computer
npm run bundle:server        # -> build/kode-server.zip (~0.1 MB)
```

Copy `kode-server.zip` to the phone, then in Termux:

```bash
pkg install nodejs-lts unzip
unzip kode-server.zip -d kode-server
cd kode-server
chmod +x start.sh
EDITOR_WORKSPACE=/storage/emulated/0/Projects ./start.sh
```

Finally, in the app open **Connection: Set Server URL…** and enter
`ws://127.0.0.1:3177/ws`. Extensions, LSP and the terminal now run on the phone.

Notes:

- The bundled server uses a plain shell fallback because `node-pty` is not
  included. For a real pty, run `npm install node-pty` inside the bundle on the
  device (needs a compiler) or use a `proot` distribution that ships it.
- To build a fully self-contained APK, bundle `node`/`proot` as `lib*.so` in
  `jniLibs` and add a `forkpty` JNI plugin, then start the server from a small
  Capacitor plugin instead of Termux. The server and bridge protocol stay the
  same.

## Next steps

1. Connect `languages.*` providers (completion, hover, diagnostics) to the
   editor, alongside the LSP client.
2. Configurable LSP servers per language (`lsp.config.json`).
3. Wrap the web app with Capacitor and add native plugins (`PtyPlugin`,
   `FsPlugin`, `ExecPlugin`) behind the same bridge protocol.

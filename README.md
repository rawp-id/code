# Kode

A lightweight, VS Code-like editor with a **real Node extension host** and an
**LSP language server**. Web-first (runs in the browser today), designed to be
wrapped by Capacitor for Android later.

```
app/      Vite + TypeScript + CodeMirror 6 UI (the editor shell)
server/   Node process: workspace FS, terminal (pty), extension host, LSP
```

## What works right now

- File explorer with header actions (**New File, New Folder, Refresh, Open
  Folder**) and a right-click menu (**New File/Folder, Rename, Delete**); folder
  rows show `+file` / `+folder` on hover. **Open Folder** opens a browser dialog
  that lists the server's directories (with `~` / parent navigation) and also
  accepts a typed path.
- Tabs, save (`Ctrl+S`), dirty indicators.
- **TextMate syntax highlighting** via **Shiki** (the same engine VS Code uses)
  with ~30 languages loaded on demand: JS/TS/JSX/TSX, JSON, HTML, Vue, Svelte,
  CSS/SCSS/Sass/Less, Markdown, Python, Rust, Go, Java, Kotlin, C/C++, C#, PHP,
  Ruby, Shell, YAML, TOML, SQL, XML, INI, Diff, Dockerfile, Makefile.
- **CodeMirror language support** (bracket matching, indentation, folding) for
  JS/TS, JSON, HTML, CSS/SCSS/Sass/Less, Markdown, Python, Rust, Go, C/C++, Java,
  PHP, XML and SQL — on top of the Shiki colours.
- Command palette (`Ctrl+Shift+P`) with built-in and extension commands.
- **Search in files** — sidebar search view (`Ctrl+Shift+F`) with case, regex and
  whole-word options; results are grouped per file and clicking one opens the
  file at that line.
- **Word-based suggestions** (from open documents) merged into completion, so
  Ctrl+Space works even where no language server is configured.
- Integrated terminal (`Ctrl+`` `) rendered with **xterm.js**, backed by a pty
  (`node-pty`, or a bundled Python pty bridge when it cannot build).
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

The **Extensions** view works like VS Code: the search box filters installed
extensions when empty and searches the marketplace when you type. Pick a
registry with the dropdown — **Open VSX** or the **VS Code Marketplace** — then
press **Install**. Installed entries show a `Run command` button and
`Uninstall`.

Click any extension to open its **detail page**: icon, publisher, version,
installs, rating, tags, license, repository link and the README (markdown from
Open VSX, HTML from the VS Code Marketplace). Installing or uninstalling from
the detail page keeps it in sync.

You can also use **Extensions: Install from VSIX…** from the command palette
with a local `.vsix` path or a URL.

> Extensions execute with full Node privileges in the server process. Only
> install extensions you trust.
>
> A successful install does not guarantee an extension works: most marketplace
extensions are runtime code and only use part of the `vscode` API surface this
> shim implements. Themes and grammars are downloaded but not applied yet.

## Terminal

The panel is **xterm.js** (`@xterm/xterm`); open it with `Ctrl+`` ` or **View:
Toggle Terminal**. `PtyManager` picks a backend automatically:

1. `node-pty` — real pty with resize support.
2. `server/pty-helper.py` — a Python pty bridge (real prompt, echo, colors), used
   when `node-pty` cannot build. Needs `python3` on the server.
3. a plain `child_process` shell — output only, no echo.

The status bar shows the active mode. On Android, run the server inside
Termux/proot (which ships a real pty) or use a future JNI `forkpty` plugin.

### Prompt

The terminal sets `PS1` itself so a broken `PROMPT_COMMAND` / leaked `PS1` from
whatever started the server cannot spam errors. Configure it in
`settings.json`:

```json
{ "terminal": { "prompt": "\\u@\\h \\w \\$ " } }
```

`\\w` is the full path and `\\W` only the folder name. Set `"prompt": false` to
leave the shell's own prompt untouched. `PS2`, `PROMPT_COMMAND`, `BASH_ENV` and
`ENV` are always stripped from the spawned shell.

## Language servers

The server ships real language servers and resolves their binaries from
`node_modules/.bin`:

| Language | Server |
| --- | --- |
| JSON / JSONC | `vscode-json-language-server` |
| HTML | `vscode-html-language-server` |
| CSS / SCSS / Less | `vscode-css-language-server` |
| TypeScript / JavaScript / TSX / JSX | `typescript-language-server` (tsserver) |
| Python | `pyright-langserver` |
| YAML | `yaml-language-server` |
| Shell / Bash | `bash-language-server` |
| Markdown | `vscode-markdown-language-server` |

`lsp.config.json` maps a language id to a server command. It is merged from the
workspace root and the server package root, so a workspace can override the
defaults. A language with **no configured server gets no completion and no
diagnostics** — language keywords are never faked. `"demo"` (the bundled demo
server) is opt-in, and `"*"` can be used as a catch-all fallback if you really
want one. Independently of any server, **word-based suggestions** from the open
documents are always offered (like VS Code), so Ctrl+Space is useful in every
language.

```json
{
  "*": { "command": "demo" },
  "python": { "command": "pyright-langserver", "args": ["--stdio"] },
  "typescript": { "command": "typescript-language-server", "args": ["--stdio"] }
}
```

See `server/lsp.config.example.json` for more (Python, Rust, Go, YAML, Bash).
Servers are started lazily the first time a document of that language is
opened, one process per distinct command (so TS and JS share tsserver). The
client answers server→client requests (`workspace/configuration`,
`client/registerCapability`, …) and matches the server's text sync mode. If a
command cannot be spawned the failure is reported and the editor keeps working.
Use **LSP: Show Server Config** from the palette to inspect the merged config.

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

Once the bundle is in place, **Server: Start in Termux…** from the palette can
launch `./start.sh` for you and points the app at `127.0.0.1:3177`. Termux must
allow external apps: set `allow-external-apps=true` in
`~/.termux/termux.properties`.

Notes:

- The bundled server uses a plain shell fallback because `node-pty` is not
  included. For a real pty, run `npm install node-pty` inside the bundle on the
  device (needs a compiler) or use a `proot` distribution that ships it.
- To build a fully self-contained APK, bundle `node`/`proot` as `lib*.so` in
  `jniLibs` and add a `forkpty` JNI plugin, then start the server from a small
  Capacitor plugin instead of Termux. The server and bridge protocol stay the
  same. `ServerPlugin.java` already shows how a native plugin is registered and
  called from the web UI.

## Next steps

1. Connect `languages.*` providers (completion, hover, diagnostics) to the
   editor, alongside the LSP client.
2. Configurable LSP servers per language (`lsp.config.json`).
3. Wrap the web app with Capacitor and add native plugins (`PtyPlugin`,
   `FsPlugin`, `ExecPlugin`) behind the same bridge protocol.

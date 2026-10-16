# VS Code Marketplace

A third-party marketplace plugin for [Acode](https://acode.app) that browses the
**VS Code Marketplace** and **Open VSX**, downloads extensions, and turns the
declarative ones (color themes, file icon themes, and language support) into
native Acode features.

## Features

- Browse and search the VS Code Marketplace and Open VSX from inside Acode.
- Sort by relevance, installs, rating, or last update.
- See the original extension details and README before installing.
- Automatic compatibility report for every extension:
  - **Themes** are converted to Acode editor themes (CodeMirror) and app themes.
  - **Icon themes** are converted to a native Acode file-icon pack.
  - **Languages** are registered with Acode's LSP registry and mapped to a
    language server (built-in or installable) for autocomplete and diagnostics.
  - Extensions that only ship runtime code (commands, views, debuggers, ...) are
    reported as unsupported instead of producing a broken plugin.
- One-tap install. Converted plugins are written to Acode's plugin directory and
  activated immediately, no restart required.
- Language-server (LSP) bridge: install a supported language extension and the
  marketplace registers a matching Acode language server, giving you VS Code
  style autocomplete, hover, diagnostics, and go-to-definition.
- Manage installed converted plugins (reload / uninstall) from the "Installed" tab.
- Sidebar app and command palette entries.

## Usage

1. Open the **VS Code Market** sidebar app, or search for
   `VS Code Marketplace: Browse extensions` in the command palette.
2. Pick a registry (VS Code Marketplace or Open VSX) and search for an extension.
3. Open an extension to read its README and compatibility report.
4. Tap **Install**. Themes and icon packs are converted and activated on the
   spot; language extensions register their language server.

## How conversion works

VS Code and Acode use different extension APIs. This plugin only converts the
**declarative** parts of a VS Code extension:

| VS Code contribution | Converted to                                             |
| -------------------- | -------------------------------------------------------- |
| `themes`             | Acode editor theme (CodeMirror) + app theme (`ThemeBuilder`) |
| `iconThemes`         | Acode file-icon pack (`fileIcons.register`)              |
| `languages`          | Acode LSP registration + a matching language server      |

Everything else (`main`, `commands`, `views`, `debuggers`, `grammars`,
`configuration`, ...) cannot be run on Acode and is reported as skipped. When an
extension has both a theme and runtime code, the theme is still converted and the
rest is listed as skipped in the extension details.

## Language support (LSP)

A VS Code language extension cannot ship its own language server to Acode, but
Acode itself has a full LSP client and can run servers (in its built-in Alpine
environment, over an external WebSocket, or inside a Web Worker).

When you install a language extension, the marketplace:

1. Reads the languages declared in `contributes.languages`.
2. Reports any language already covered by an Acode built-in server (Python,
   Go, Rust, C/C++, TypeScript/JavaScript, HTML/CSS/JSON, Tailwind, Luau).
3. Registers a matching language server from a curated catalog for languages
   Acode does not bundle (Vue, Svelte, Astro, YAML, PHP/Intelephense,
   TOML/Taplo, Bash, Dockerfile).

You can install, enable, or disable these servers from the marketplace settings.
Installing a server uses Acode's built-in Alpine runtime, so the **Acode
Terminal** plugin is required. Language servers are re-registered automatically
on every Acode start.

## Permissions

- `network` — required to query the registries, read documentation, and download
  `.vsix` packages.

## License

MIT. Converted third-party themes and icon packs keep the license of their
original authors, which is shown in each generated plugin.

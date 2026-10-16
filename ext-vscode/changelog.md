# Changelog

## 1.2.2

- Changed the author/contributor and repository to `rawp-id`.

## 1.2.1

- Added curated language servers for PHP (Intelephense) and TOML (Taplo).
- Existing installed language extensions pick up new server mappings
  automatically on the next start.
- The Installed tab and extension page now also offer the server install for
  extensions that were installed before the mapping existed.

## 1.2.0

- Language extensions are now installable instead of being marked
  "Not supported". Installing one registers its language with Acode's LSP
  registry and offers to set up a matching language server.
- The Install button is enabled for any extension that declares languages.
- Installed language extensions appear in the Installed tab and can be
  uninstalled (which removes the language-server registration).
- Built-in Acode servers (clangd, gopls, rust-analyzer, Python, ...) are also
  offered and enabled when they cover an extension's languages.

## 1.1.0

- Added a language-server (LSP) bridge. Installing a supported VS Code language
  extension now registers a matching Acode language server so you get VS Code
  style autocomplete, hover, diagnostics, and go-to-definition.
- Detects which Acode built-in servers already cover an extension's languages
  and reports it on the extension page.
- Language servers added by this plugin can be installed, enabled, and disabled
  from the marketplace settings.
- Language servers are re-registered automatically on every Acode start.
- Fixed a `ReferenceError: debounce is not defined` crash in the marketplace page.

## 1.0.0

- Initial release.
- Browse and search the VS Code Marketplace and Open VSX.
- Extension details with README rendering and a compatibility report.
- Convert color themes to Acode editor themes and app themes.
- Convert file icon themes to native Acode icon packs.
- Install converted plugins into Acode's plugin directory and activate them
  without restarting.
- Manage installed converted plugins (reload / uninstall).

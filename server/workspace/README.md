# Welcome to Kode

A lightweight, VS Code-like editor with a real Node extension host and LSP.

`src/` contains a small sample for every supported language (JS/TS/JSX/TSX,
JSON, HTML, CSS/SCSS/Less, Markdown, Python, Rust, Go, Java, C/C++, PHP, Ruby,
Shell, YAML, TOML, SQL, XML, INI, Diff, Dockerfile, Makefile, Vue, Svelte,
Kotlin, C#) so you can check highlighting for each of them.

## Try this

1. Open `src/hello.js` and notice the inline diagnostics from the language server.
2. Start typing `fun` and trigger completion (Ctrl+Space).
3. Press `Ctrl+`` ` to open the terminal and run `node src/hello.js`.
4. Open the command palette with `Ctrl+Shift+P` and run `Hello: Say Hello`.
5. Run `Word Count: Count README Words`.

TODO: replace the demo language server with a real one.

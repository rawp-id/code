const vscode = require("vscode");

const SNIPPETS = [
  { label: "kode-header", insertText: "// Kode editor\n", detail: "file header" },
  { label: "todo", insertText: "TODO: ", detail: "todo marker" },
  { label: "isodate", insertText: new Date().toISOString().slice(0, 10), detail: "today's date" },
];

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection("providers-demo");

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: "*" },
      {
        provideCompletionItems() {
          return SNIPPETS.map((snippet) => {
            const item = new vscode.CompletionItem(snippet.label, vscode.CompletionItemKind.Snippet);
            item.detail = snippet.detail;
            item.insertText = snippet.insertText;
            return item;
          });
        },
      },
      "k"
    )
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider("*", {
      provideHover(document, position) {
        const range = document.getWordRangeAtPosition(position);
        if (!range) return undefined;
        const word = document.getText(range);
        const hover = new vscode.Hover(`**${word}**\n\n${word.length} characters (from providers-demo)`);
        hover.range = range;
        return hover;
      },
    })
  );

  const refresh = (document) => {
    if (!document) return;
    const list = [];
    const lines = document.getText().split("\n");
    lines.forEach((text, line) => {
      let index = text.indexOf("XXX");
      while (index !== -1) {
        list.push(
          new vscode.Diagnostic(
            new vscode.Range(new vscode.Position(line, index), new vscode.Position(line, index + 3)),
            "XXX marker found",
            vscode.DiagnosticSeverity.Warning
          )
        );
        index = text.indexOf("XXX", index + 3);
      }
    });
    diagnostics.set(document.uri, list);
  };

  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => refresh(event.document)));
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => refresh(document)));
  context.subscriptions.push({ dispose: () => diagnostics.dispose() });

  // Activate on "*" means documents may already be open.
  for (const document of vscode.workspace.textDocuments) refresh(document);
}

function deactivate() {}

module.exports = { activate, deactivate };

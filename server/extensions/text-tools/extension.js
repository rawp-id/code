const vscode = require("vscode");

function activate(context) {
  const log = vscode.window.createOutputChannel("Text Tools");

  context.subscriptions.push(
    vscode.commands.registerCommand("textTools.stats", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("Open a file first");
        return;
      }
      const text = editor.document.getText();
      const words = text.split(/\s+/).filter(Boolean).length;
      vscode.window.showInformationMessage(
        `${editor.document.fileName}: ${editor.document.lineCount} lines, ${words} words, ${text.length} chars`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("textTools.upperSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("Open a file first");
        return;
      }
      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showWarningMessage("Select some text first");
        return;
      }
      const selected = editor.document.getText(selection);
      const ok = await editor.edit((builder) => builder.replace(selection, selected.toUpperCase()));
      vscode.window.showInformationMessage(ok ? "Uppercased selection" : "Edit failed");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("textTools.insertTimestamp", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("Open a file first");
        return;
      }
      const stamp = new Date().toISOString();
      await editor.edit((builder) => builder.insert(editor.selection.active, stamp));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("textTools.appendLine", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(editor.document.uri, lastLine.range.end, "\n// appended by an extension");
      const ok = await vscode.workspace.applyEdit(edit);
      vscode.window.showInformationMessage(ok ? "Applied workspace edit" : "Workspace edit failed");
    })
  );

  // Event model: record document activity in the output channel.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) =>
      log.appendLine(`saved ${document.fileName} (v${document.version})`)
    )
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) =>
      log.appendLine(`changed ${event.document.fileName} (v${event.document.version})`)
    )
  );
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      const position = event.selections[0].active;
      log.appendLine(`cursor ${position.line + 1}:${position.character + 1}`);
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };

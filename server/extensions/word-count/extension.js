const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("wordcount.readme", () => {
      const readme = path.join(context.extensionPath, "..", "..", "workspace", "README.md");
      try {
        const text = fs.readFileSync(readme, "utf8");
        const words = text.split(/\s+/).filter(Boolean).length;
        vscode.window.showInformationMessage(`README.md has ${words} words`);
      } catch (err) {
        vscode.window.showErrorMessage(`Could not read README: ${err.message}`);
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };

// CommonJS bundle, exactly the shape `vsce package` ships.
// `require('vscode')` is served by the host shim.

const vscode = require("vscode");

function activate(context) {
  const out = vscode.window.createOutputChannel("Hello");

  context.subscriptions.push(
    vscode.commands.registerCommand("hello.sayHello", () => {
      vscode.window.showInformationMessage("Hello from the extension host!");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hello.askName", async () => {
      const name = await vscode.window.showInputBox({ prompt: "What is your name?" });
      if (name) {
        vscode.window.showInformationMessage(`Nice to meet you, ${name}!`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hello.pickColor", async () => {
      const color = await vscode.window.showQuickPick(["Red", "Green", "Blue"], {
        placeHolder: "Pick a color",
      });
      if (color) vscode.window.showInformationMessage(`You picked ${color}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hello.log", () => {
      out.appendLine(`Logged at ${new Date().toISOString()}`);
      vscode.window.showInformationMessage("Wrote a line to the Hello output channel");
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };

# Hello World

Demo extension for **Kode**. Shows the `vscode` API shim working end to end.

## Commands

| Command | What it does |
| --- | --- |
| `Hello: Say Hello` | Shows an information message |
| `Hello: Ask My Name` | `showInputBox` + message |
| `Hello: Pick A Color` | `showQuickPick` + message |
| `Hello: Write To Output Channel` | Writes to the **Hello** output channel |

## Notes

- Runs inside the Node extension host, not the browser.
- Uses only the implemented part of the `vscode` API: `commands`,
  `window.showInformationMessage`, `showInputBox`, `showQuickPick` and
  `createOutputChannel`.

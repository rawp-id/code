import "./style.css";
import { bridge, type ExtensionInfo, type ServerInfo } from "./bridge";
import { bus } from "./bus";
import { createLayout } from "./layout";
import { EditorManager } from "./editor";
import { TabsView } from "./tabs";
import { FileTree, ExtensionsView } from "./sidebar";
import { CommandPalette, showInputBox, showQuickPick, type Command } from "./palette";
import { TerminalPanel } from "./terminal";
import { toast } from "./toast";
import { languageLabel } from "./lang";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

const layout = createLayout(root);
const editor = new EditorManager(layout.editorHost);
new TabsView(layout.tabs, editor);

const filesEl = document.createElement("div");
const extensionsEl = document.createElement("div");
extensionsEl.style.display = "none";
layout.sideBody.append(filesEl, extensionsEl);

const filetree = new FileTree(filesEl, (path) => {
  editor.open(path).catch((error: any) => toast("error", `Could not open ${path}: ${error?.message}`));
});

const extensionsView = new ExtensionsView(extensionsEl, (extensionId, command) =>
  runExtensionCommand(extensionId, command)
);

const palette = new CommandPalette();
const terminal = new TerminalPanel(layout.terminalHost);

let serverInfo: ServerInfo | null = null;
let activeView: "files" | "extensions" = "files";
let panelView: "terminal" | "output" = "terminal";

function setSidebarView(view: "files" | "extensions"): void {
  activeView = view;
  layout.sideTitle.textContent = view === "files" ? "Explorer" : "Extensions";
  filesEl.style.display = view === "files" ? "" : "none";
  extensionsEl.style.display = view === "extensions" ? "" : "none";
  layout.activityBar
    .querySelectorAll<HTMLButtonElement>("button[data-view]")
    .forEach((button) => button.classList.toggle("active", button.dataset.view === view));
}

function setPanelView(view: "terminal" | "output"): void {
  panelView = view;
  layout.panelTabs
    .querySelectorAll<HTMLElement>("[data-panel-tab]")
    .forEach((tab) => tab.classList.toggle("active", tab.dataset.panelTab === view));
  layout.panel
    .querySelectorAll<HTMLElement>("[data-panel-body]")
    .forEach((body) => body.classList.toggle("hidden", body.dataset.panelBody !== view));
}

function togglePanel(show?: boolean): void {
  const hidden = layout.panel.classList.contains("hidden");
  const shouldShow = show ?? hidden;
  layout.panel.classList.toggle("hidden", !shouldShow);
  if (!shouldShow) return;
  setPanelView(panelView);
  if (panelView === "terminal") {
    terminal.ensureStarted();
    setTimeout(() => terminal.fitNow(), 0);
  }
}

function renderStatus(): void {
  layout.statusBar.innerHTML = "";
  const add = (text: string, title?: string) => {
    const span = document.createElement("span");
    span.className = "item";
    span.textContent = text;
    if (title) span.title = title;
    layout.statusBar.append(span);
  };
  const spacer = document.createElement("span");
  spacer.className = "spacer";

  if (serverInfo) {
    add(serverInfo.workspace.name, serverInfo.workspace.root);
    add(serverInfo.pty ? "tty" : "no-tty", serverInfo.pty ? "node-pty active" : "fallback shell (no pty)");
  } else {
    add("connecting…");
  }

  layout.statusBar.append(spacer);

  if (editor.active) {
    const doc = editor.get(editor.active);
    const state = editor.view.state;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    add(`Ln ${line.number}, Col ${head - line.from + 1}`);
    add(languageLabel(doc?.languageId || "plaintext"));
    add(doc?.dirty ? "modified" : "saved");
  }
  add(bridge.connected ? "connected" : "offline");
}

async function refreshExtensions(): Promise<void> {
  await extensionsView.refresh();
  let extensions: ExtensionInfo[] = [];
  try {
    extensions = await bridge.request<ExtensionInfo[]>("ext.list");
  } catch {
    extensions = [];
  }
  const extensionCommands: Command[] = [];
  for (const extension of extensions) {
    for (const command of extension.commands) {
      extensionCommands.push({
        id: command.command,
        title: command.title,
        hint: extension.id,
        run: () => runExtensionCommand(extension.id, command.command),
      });
    }
  }
  palette.setCommands([...builtinCommands, ...extensionCommands]);
}

async function runExtensionCommand(extensionId: string, command: string): Promise<void> {
  try {
    await bridge.request("ext.activate", { id: extensionId });
    await bridge.request("ext.execCommand", { command, args: [] });
    await refreshExtensions();
  } catch (error: any) {
    toast("error", `Command failed: ${error?.message}`);
  }
}

async function openFolder(): Promise<void> {
  const target = await showInputBox({ prompt: "Absolute path of the folder to open" });
  if (!target) return;
  try {
    const info = await bridge.request<{ root: string; name: string }>("ws.setRoot", { root: target });
    if (serverInfo) serverInfo.workspace = info;
    layout.titleName.textContent = `Kode — ${info.name}`;
    await filetree.refresh();
    renderStatus();
    toast("info", `Opened ${info.root}`);
  } catch (error: any) {
    toast("error", `Could not open folder: ${error?.message}`);
  }
}

const builtinCommands: Command[] = [
  { id: "file.save", title: "File: Save", hint: "Ctrl+S", run: () => editor.save().then(() => toast("info", "Saved")) },
  { id: "file.refresh", title: "File: Refresh Explorer", run: () => filetree.refresh() },
  { id: "view.terminal", title: "View: Toggle Terminal", hint: "Ctrl+`", run: () => togglePanel() },
  { id: "view.sidebar", title: "View: Toggle Sidebar", hint: "Ctrl+B", run: () => layout.sidebar.classList.toggle("hidden") },
  { id: "view.explorer", title: "View: Show Explorer", run: () => { layout.sidebar.classList.remove("hidden"); setSidebarView("files"); } },
  { id: "view.extensions", title: "View: Show Extensions", run: () => { layout.sidebar.classList.remove("hidden"); setSidebarView("extensions"); } },
  { id: "ext.refresh", title: "Extensions: Refresh", run: () => refreshExtensions() },
  { id: "ext.all", title: "Extensions: Show All", run: () => { layout.sidebar.classList.remove("hidden"); setSidebarView("extensions"); } },
  { id: "workspace.open", title: "Workspace: Open Folder…", run: () => openFolder() },
  { id: "terminal.clear", title: "Terminal: Clear", run: () => terminal.clear() },
];

palette.setCommands(builtinCommands);

layout.activityBar.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-view]");
  if (!button || !button.dataset.view) return;
  setSidebarView(button.dataset.view as "files" | "extensions");
});

layout.panelTabs.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const close = target.closest("[data-panel-close]");
  if (close) {
    togglePanel(false);
    return;
  }
  const tab = target.closest<HTMLElement>("[data-panel-tab]");
  if (!tab || !tab.dataset.panelTab) return;
  setPanelView(tab.dataset.panelTab as "terminal" | "output");
  if (tab.dataset.panelTab === "terminal") {
    terminal.ensureStarted();
    setTimeout(() => terminal.fitNow(), 0);
  }
});

bus.on("file.save", () =>
  editor.save().then(() => toast("info", "Saved")).catch((error: any) => toast("error", error?.message))
);
bus.on("palette.open", () => palette.open());
bus.on("panel.toggle", () => togglePanel());
bus.on("sidebar.toggle", () => layout.sidebar.classList.toggle("hidden"));
editor.onDidChange(renderStatus);

document.addEventListener("keydown", (event) => {
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.shiftKey && event.key.toLowerCase() === "p") {
    event.preventDefault();
    palette.open();
  } else if (mod && event.key === "`") {
    event.preventDefault();
    togglePanel();
  }
});

bridge.on("status", ({ connected }) => {
  layout.connDot.classList.toggle("ok", connected);
  layout.connText.textContent = connected ? "connected" : "connecting…";
  renderStatus();
});

bridge.on("output.line", ({ channel, line }) => {
  layout.outputHost.textContent += `[${channel}] ${line}\n`;
  layout.outputHost.scrollTop = layout.outputHost.scrollHeight;
});

bridge.on("lsp.ready", ({ languageId }) => toast("info", `Language server ready for ${languageId}`));
bridge.on("lsp.exit", ({ languageId, code }) =>
  toast("warning", `Language server for ${languageId} exited (${code})`)
);

bridge.handleRequest("ui.showMessage", (params) => {
  toast(params.kind, params.message);
  return undefined;
});
bridge.handleRequest("ui.showQuickPick", (params) => showQuickPick(params.items, params.options));
bridge.handleRequest("ui.showInputBox", (params) => showInputBox(params.options));

async function init(): Promise<void> {
  try {
    serverInfo = await bridge.request<ServerInfo>("server.info");
    layout.titleName.textContent = `Kode — ${serverInfo.workspace.name}`;
    layout.titleName.title = serverInfo.workspace.root;
  } catch (error: any) {
    toast("error", `Server unavailable: ${error?.message}`);
  }
  await filetree.refresh();
  await refreshExtensions();
  renderStatus();
  try {
    await editor.open("README.md");
  } catch {
    /* no default file */
  }
}

bridge.connect();
setSidebarView("files");
init();

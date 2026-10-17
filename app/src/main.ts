import "./style.css";
import { bridge, type ExtensionInfo, type ServerInfo } from "./bridge";
import { bus } from "./bus";
import { createLayout } from "./layout";
import { EditorManager } from "./editor";
import { TabsView } from "./tabs";
import { FileTree } from "./sidebar";
import { ExtensionsView } from "./extensionsview";
import { SearchView } from "./searchview";
import { SettingsView } from "./settingsview";
import type { Settings } from "./settings";
import { icons, setIconTheme } from "./icons";
import { CommandPalette, showInputBox, showQuickPick, type Command } from "./palette";
import { initConnectionUi, openConnectionDialog } from "./connect";
import { isNativePlatform, KodeServer } from "./native";
import { TerminalPanel } from "./terminal";
import { toast } from "./toast";
import { disableInputAssistance } from "./inputs";
import { showContextMenu } from "./contextmenu";
import { loadSession, saveSession } from "./session";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

const layout = createLayout(root);
const editor = new EditorManager(layout.editorHost);
new TabsView(layout.tabs, editor);

const filesEl = document.createElement("div");
const searchEl = document.createElement("div");
const extensionsEl = document.createElement("div");
const settingsEl = document.createElement("div");
searchEl.style.display = "none";
extensionsEl.style.display = "none";
settingsEl.style.display = "none";
layout.sideBody.append(filesEl, searchEl, extensionsEl, settingsEl);

const filetree = new FileTree(filesEl, (path) => {
  editor.open(path).catch((error: any) => toast("error", `Could not open ${path}: ${error?.message}`));
});

const extensionsView = new ExtensionsView(
  extensionsEl,
  (extensionId, command) => runExtensionCommand(extensionId, command),
  () => {
    void updateExtensionCommands();
    void settingsView.reloadExtensionThemes();
  }
);

const palette = new CommandPalette();
const terminal = new TerminalPanel(layout.terminalHost);
const search = new SearchView(searchEl, (path, line, column) =>
  editor.openAt(path, line, column).catch((error: any) => toast("error", error?.message))
);
const settingsView = new SettingsView(settingsEl, (settings) => applySettings(settings));

layout.editorHost.addEventListener("contextmenu", (event) => {
  if (!(event.target as HTMLElement).closest(".cm-editor")) return;
  event.preventDefault();
  showContextMenu(event.clientX, event.clientY, [
    { label: "Undo", run: () => editor.undo() },
    { label: "Redo", run: () => editor.redo() },
    { separator: true },
    { label: "Cut", run: () => editor.cutSelection() },
    { label: "Copy", run: () => editor.copySelection() },
    { label: "Paste", run: () => editor.paste() },
    { separator: true },
    { label: "Select All", run: () => editor.selectAll() },
    { label: "Command Palette", run: () => palette.open() },
  ]);
});

let activeView: "files" | "search" | "extensions" | "settings" = "files";
let panelView: "terminal" | "output" = "terminal";
let workspaceRoot: string | null = null;
let persistTimer: number | undefined;
let appSettings: Settings | null = null;
let autoSaveTimer: number | undefined;
let lastFilesExclude = "";
let lastIconTheme = "";

function updateActivityBar(): void {
  const hidden = layout.sidebar.classList.contains("hidden");
  layout.activityBar
    .querySelectorAll<HTMLButtonElement>("button[data-view]")
    .forEach((button) =>
      button.classList.toggle("active", !hidden && button.dataset.view === activeView)
    );
}

function setSidebarView(view: "files" | "search" | "extensions" | "settings"): void {
  activeView = view;
  layout.sideTitle.textContent =
    view === "files"
      ? "Explorer"
      : view === "search"
        ? "Search"
        : view === "settings"
          ? "Settings"
          : "Extensions";
  filesEl.style.display = view === "files" ? "" : "none";
  searchEl.style.display = view === "search" ? "" : "none";
  extensionsEl.style.display = view === "extensions" ? "" : "none";
  settingsEl.style.display = view === "settings" ? "" : "none";
  renderSidebarActions(view);
  updateActivityBar();
  schedulePersist();
}

function renderSidebarActions(view: "files" | "search" | "extensions" | "settings"): void {
  layout.sideActions.innerHTML = "";
  if (view !== "files") return;
  const make = (icon: string, title: string, run: () => void) => {
    const button = document.createElement("button");
    button.className = "sidebar-action";
    button.title = title;
    button.innerHTML = icon;
    button.onclick = run;
    return button;
  };
  layout.sideActions.append(
    make(icons.newFile, "New File", () => filetree.createFile()),
    make(icons.newFolder, "New Folder", () => filetree.createFolder()),
    make(icons.refresh, "Refresh", () => filetree.refresh()),
    make(icons.openFolder, "Open Folder", () => filetree.openFolder())
  );
}

function toggleSidebar(force?: boolean): void {
  const hidden = layout.sidebar.classList.contains("hidden");
  layout.sidebar.classList.toggle("hidden", force ?? !hidden);
  updateActivityBar();
  schedulePersist();
}

function setPanelView(view: "terminal" | "output"): void {
  panelView = view;
  layout.panelTabs
    .querySelectorAll<HTMLElement>("[data-panel-tab]")
    .forEach((tab) => tab.classList.toggle("active", tab.dataset.panelTab === view));
  layout.panel
    .querySelectorAll<HTMLElement>("[data-panel-body]")
    .forEach((body) => body.classList.toggle("hidden", body.dataset.panelBody !== view));
  schedulePersist();
}

function togglePanel(show?: boolean): void {
  const hidden = layout.panel.classList.contains("hidden");
  const shouldShow = show ?? hidden;
  layout.panel.classList.toggle("hidden", !shouldShow);
  schedulePersist();
  if (!shouldShow) return;
  setPanelView(panelView);
  if (panelView === "terminal") {
    terminal.ensureStarted();
    setTimeout(() => terminal.fitNow(), 0);
  }
}

function buildSession() {
  const drafts: Record<string, string> = {};
  for (const doc of editor.openDocs) {
    if (doc.dirty) drafts[doc.path] = doc.state.doc.toString();
  }
  return {
    workspaceRoot: workspaceRoot || undefined,
    openDocs: editor.openDocs.map((doc) => doc.path),
    active: editor.active || undefined,
    activeCursor: editor.active ? editor.cursorOffset(editor.active) : undefined,
    expanded: filetree.expandedPaths(),
    sidebarView: activeView,
    panelVisible: !layout.panel.classList.contains("hidden"),
    panelView,
    drafts,
  };
}

function persistNow(): void {
  saveSession(buildSession());
}

function schedulePersist(): void {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(persistNow, 500);
}

function applySettings(settings: Settings): void {
  appSettings = settings;
  editor.applySettings(settings);
  layout.sidebar.style.width = `${settings.workbench.sidebarWidth}px`;
  terminal.setFontSize(settings.terminal.fontSize);

  const iconTheme = settings.workbench.iconTheme || "default";
  setIconTheme(iconTheme);
  if (lastIconTheme && lastIconTheme !== iconTheme) {
    void filetree.refresh();
  }
  lastIconTheme = iconTheme;

  const excludeKey = JSON.stringify(settings.files.exclude || []);
  if (lastFilesExclude && lastFilesExclude !== excludeKey) {
    void filetree.refresh();
  }
  lastFilesExclude = excludeKey;
}

async function updateExtensionCommands(): Promise<void> {
  let extensions: ExtensionInfo[] = [];
  try {
    extensions = await bridge.request<ExtensionInfo[]>("ext.list");
  } catch {
    extensions = [];
  }
  const extensionCommands: Command[] = [];
  for (const extension of extensions) {
    if (extension.disabled) continue;
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

async function refreshExtensions(): Promise<void> {
  await extensionsView.refresh();
  await updateExtensionCommands();
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

const builtinCommands: Command[] = [
  { id: "file.save", title: "File: Save", hint: "Ctrl+S", run: () => editor.save().then(() => toast("info", "Saved")) },
  { id: "editor.suggest", title: "Editor: Trigger Suggest", hint: "Ctrl+Space", run: () => editor.triggerSuggest() },
  { id: "file.refresh", title: "File: Refresh Explorer", run: () => filetree.refresh() },
  { id: "view.terminal", title: "View: Toggle Terminal", hint: "Ctrl+`", run: () => togglePanel() },
  { id: "view.sidebar", title: "View: Toggle Sidebar", hint: "Ctrl+B", run: () => toggleSidebar() },
  { id: "view.explorer", title: "View: Show Explorer", run: () => { toggleSidebar(false); setSidebarView("files"); } },
  { id: "view.search", title: "View: Show Search", hint: "Ctrl+Shift+F", run: () => { toggleSidebar(false); setSidebarView("search"); } },
  { id: "view.extensions", title: "View: Show Extensions", run: () => { toggleSidebar(false); setSidebarView("extensions"); } },
  { id: "ext.refresh", title: "Extensions: Refresh", run: () => refreshExtensions() },
  {
    id: "ext.install",
    title: "Extensions: Install from VSIX…",
    run: async () => {
      const target = await showInputBox({ prompt: "Path or URL of the .vsix file" });
      if (!target) return;
      try {
        const info = await bridge.request<{ displayName: string; version: string }>(
          "ext.installVsix",
          target.startsWith("http") ? { url: target } : { path: target }
        );
        toast("info", `Installed ${info.displayName} v${info.version}`);
        await refreshExtensions();
      } catch (error: any) {
        toast("error", `Install failed: ${error?.message}`);
      }
    },
  },
  {
    id: "ext.uninstall",
    title: "Extensions: Uninstall…",
    run: async () => {
      const list = await bridge.request<ExtensionInfo[]>("ext.list").catch(() => []);
      const choice = await showQuickPick(
        list.map((ext) => ({ label: ext.displayName, description: ext.id, id: ext.id }))
      );
      if (!choice) return;
      await bridge.request("ext.uninstall", { id: choice.id });
      toast("info", `Uninstalled ${choice.label}`);
      await refreshExtensions();
    },
  },
  { id: "ext.all", title: "Extensions: Show All", run: () => { toggleSidebar(false); setSidebarView("extensions"); } },
  { id: "workspace.open", title: "Workspace: Open Folder…", run: () => filetree.openFolder() },
  { id: "connection.url", title: "Connection: Set Server URL…", run: () => openConnectionDialog() },
  {
    id: "server.termux",
    title: "Server: Start in Termux…",
    run: async () => {
      if (!isNativePlatform()) {
        toast("warning", "Only available in the Android app");
        return;
      }
      try {
        const { installed } = await KodeServer.isTermuxInstalled();
        if (!installed) {
          toast("error", "Termux is not installed");
          return;
        }
        const workdir = await showInputBox({
          prompt: "Server directory inside Termux",
          value: "~/kode-server",
        });
        if (!workdir) return;
        await KodeServer.startInTermux({
          command: "EDITOR_WORKSPACE=/storage/emulated/0/Projects ./start.sh",
          workdir,
        });
        bridge.setUrl("ws://127.0.0.1:3177/ws");
        toast("info", "Starting the server in Termux; connecting to 127.0.0.1:3177");
      } catch (error: any) {
        toast("error", `Termux launch failed: ${error?.message}`);
      }
    },
  },
  {
    id: "lsp.config",
    title: "LSP: Show Server Config",
    run: async () => {
      const config = await bridge.request("lsp.config");
      layout.outputHost.textContent += `[LSP] ${JSON.stringify(config, null, 2)}\n`;
      togglePanel(true);
      setPanelView("output");
    },
  },
  { id: "terminal.clear", title: "Terminal: Clear", run: () => terminal.clear() },
];

palette.setCommands(builtinCommands);

layout.activityBar.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-view]");
  if (!button || !button.dataset.view) return;
  const view = button.dataset.view as "files" | "search" | "extensions" | "settings";
  const hidden = layout.sidebar.classList.contains("hidden");
  if (!hidden && activeView === view) {
    toggleSidebar(true);
  } else {
    toggleSidebar(false);
    setSidebarView(view);
  }
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
bus.on("sidebar.toggle", () => toggleSidebar());
bus.on("file.deleted", ({ path }: { path: string }) => editor.close(path));
bus.on("file.renamed", ({ from, to }: { from: string; to: string }) =>
  editor.renamePath(from, to)
);

const toUri = (filePath: string) =>
  filePath.startsWith("file://") ? filePath : `file://${filePath}`;
const fromUri = (uri: string) => uri.replace(/^file:\/\//, "");

bus.on("editor.open", ({ path, languageId, text }) => {
  const uri = toUri(path);
  bridge.request("doc.open", { uri, languageId, text });
  bridge.request("lsp.didOpen", { uri, languageId, text });
});
let changeTimer: number | undefined;
const pendingChanges = new Map<string, string>();
bus.on("editor.change", ({ path, text }) => {
  if (appSettings?.editor.autoSave === "afterDelay") {
    window.clearTimeout(autoSaveTimer);
    autoSaveTimer = window.setTimeout(() => {
      editor.save(path).catch(() => undefined);
    }, appSettings.editor.autoSaveDelay || 1000);
  } else {
    window.clearTimeout(autoSaveTimer);
  }
  pendingChanges.set(path, text);
  window.clearTimeout(changeTimer);
  changeTimer = window.setTimeout(() => {
    for (const [changedPath, changedText] of pendingChanges) {
      const uri = toUri(changedPath);
      bridge.request("doc.change", { uri, text: changedText });
      bridge.request("lsp.didChange", { uri, text: changedText });
    }
    pendingChanges.clear();
  }, 120);
});
bus.on("editor.saved", ({ path }) => bridge.request("doc.save", { uri: toUri(path) }));
bus.on("editor.active", ({ path }) => bridge.request("doc.active", { uri: toUri(path) }));
bus.on("editor.close", ({ path }) => {
  const uri = toUri(path);
  bridge.request("doc.close", { uri });
  bridge.request("lsp.didClose", { uri });
});
bus.on("editor.selection", ({ path, selection }) =>
  bridge.request("doc.selection", { uri: toUri(path), selection })
);
bus.on("editor.change", schedulePersist);
bus.on("editor.open", schedulePersist);
bus.on("editor.close", schedulePersist);
bus.on("editor.active", schedulePersist);
bus.on("tree.changed", schedulePersist);
editor.onDidChange(schedulePersist);
bus.on("icons.changed", () => {
  void filetree.refresh();
  editor.refreshTabs();
});
bus.on("workspace.changed", ({ root }: { root: string }) => {
  workspaceRoot = root;
  editor.closeAll();
  schedulePersist();
});

bridge.handleRequest("editor.applyEdits", (params) => editor.applyEdits(params.uri, params.edits));
bridge.handleRequest("editor.saveDocument", (params) =>
  editor.saveDocument(fromUri(params.uri))
);
bridge.handleRequest("editor.showDocument", (params) => editor.showDocument(fromUri(params.uri)));

// Global shortcuts are handled here in the capture phase so the editor and the
// terminal cannot also act on them (which previously double-toggled the panel).
document.addEventListener(
  "keydown",
  (event) => {
    if (event.altKey && event.code === "Backquote") {
      event.preventDefault();
      event.stopPropagation();
      editor.triggerSuggest();
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    const backquote = event.code === "Backquote" || event.key === "`";

    if (event.shiftKey && key === "p") {
      event.preventDefault();
      event.stopPropagation();
      palette.open();
      return;
    }
    if (event.shiftKey && key === "f") {
      event.preventDefault();
      event.stopPropagation();
      toggleSidebar(false);
      setSidebarView("search");
      return;
    }
    if (backquote) {
      event.preventDefault();
      event.stopPropagation();
      togglePanel();
      return;
    }
    if (event.code === "Space" && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      editor.triggerSuggest();
      return;
    }
    if (!event.shiftKey && key === "s") {
      event.preventDefault();
      event.stopPropagation();
      editor
        .save()
        .then(() => toast("info", "Saved"))
        .catch((error: any) => toast("error", error?.message));
      return;
    }
    if (!event.shiftKey && key === "b") {
      event.preventDefault();
      event.stopPropagation();
      toggleSidebar();
    }
  },
  true
);

bridge.on("output.line", ({ channel, line }) => {
  layout.outputHost.textContent += `[${channel}] ${line}\n`;
  layout.outputHost.scrollTop = layout.outputHost.scrollHeight;
});

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
  let info: ServerInfo | null = null;
  try {
    info = await bridge.request<ServerInfo>("server.info");
    workspaceRoot = info.workspace.root;
  } catch (error: any) {
    toast("error", `Server unavailable: ${error?.message}`);
  }

  await settingsView.refresh();

  const session = loadSession();
  const sameWorkspace = Boolean(session && info && session.workspaceRoot === info.workspace.root);

  if (session && sameWorkspace) {
    await filetree.setExpanded(session.expanded || []);
    setSidebarView(session.sidebarView || "files");
    setPanelView(session.panelView || "terminal");
    togglePanel(Boolean(session.panelVisible));
    for (const path of session.openDocs) {
      try {
        await editor.open(path, session.drafts?.[path], { activate: false });
      } catch {
        /* the file may have been renamed or deleted */
      }
    }
    const target =
      session.active && editor.get(session.active) ? session.active : editor.openDocs[0]?.path;
    if (target) {
      editor.activate(target);
      if (session.activeCursor !== undefined) {
        editor.setCursorOffset(target, session.activeCursor);
      }
    }
  } else {
    await filetree.refresh();
    try {
      await editor.open("README.md");
    } catch {
      /* no default file */
    }
  }

  await refreshExtensions();
  schedulePersist();
}

bridge.connect();
disableInputAssistance();
initConnectionUi();
setSidebarView("files");
init();

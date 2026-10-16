import plugin from "../plugin.json";
import { store } from "./lib/store.js";
import { syncForInstalled } from "./lib/lsp.js";
import { installStyles, registerCommand, registerSidebar, setContext, openMarketplace } from "./lib/ui.js";

function mod(name) {
  try {
    return acode.require(name);
  } catch {
    return null;
  }
}

async function init(baseUrl, page, options = {}) {
  installStyles();
  setContext({ baseUrl, fileIcons: options.fileIcons || null });

  try {
    await store.load(options.cacheFile);
  } catch (error) {
    console.warn("[vscmk] failed to load settings", error);
  }

  // Re-register language servers for already-installed plugins.
  try {
    syncForInstalled(store.data.installed);
  } catch (error) {
    console.warn("[vscmk] failed to sync language servers", error);
  }

  registerSidebar();
  registerCommand();
}

function destroy() {
  const sidebarApps = mod("sidebarApps");
  if (sidebarApps?.remove) sidebarApps.remove("vscmk-marketplace");

  const commands = mod("commands");
  if (commands?.removeCommand) {
    commands.removeCommand("vscode-marketplace.open");
    commands.removeCommand("vscode-marketplace.installed");
  }

  // Leave language servers registered: Acode may still be using them for open
  // documents. They are re-synced on the next init.
}

acode.setPluginInit(plugin.id, init);
acode.setPluginUnmount(plugin.id, destroy);

// Expose a tiny debug hook (harmless, useful from the console).
if (typeof window !== "undefined") {
  window.vscodeMarketplace = { open: openMarketplace, store };
}

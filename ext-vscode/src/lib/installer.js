/**
 * Writes converted plugins into Acode's PLUGIN_DIR and activates them
 * in-process, mirroring what Acode's own loader (src/lib/loadPlugin.js) does.
 */

const CONVERTED_PREFIX = "vscmk.";

function acodeModule(name) {
  try {
    return acode.require(name);
  } catch {
    return null;
  }
}

function globals() {
  return {
    PLUGIN_DIR: typeof PLUGIN_DIR !== "undefined" ? PLUGIN_DIR : "",
    DATA_STORAGE: typeof DATA_STORAGE !== "undefined" ? DATA_STORAGE : "",
    CACHE_STORAGE: typeof CACHE_STORAGE !== "undefined" ? CACHE_STORAGE : "",
    app: typeof app !== "undefined" ? app : document.body,
  };
}

export function isConvertedPlugin(id) {
  return typeof id === "string" && id.startsWith(CONVERTED_PREFIX);
}

export async function ensurePluginDir() {
  const { PLUGIN_DIR, DATA_STORAGE } = globals();
  const fs = acodeModule("fs");
  if (!fs) throw new Error("fs module unavailable");
  if (!(await fs(PLUGIN_DIR).exists())) {
    await fs(DATA_STORAGE).createDirectory("plugins");
  }
}

/** Write every asset of a converted plugin and its plugin.json. */
export async function installConverted(built, { onProgress } = {}) {
  const { PLUGIN_DIR } = globals();
  const fs = acodeModule("fs");
  const Url = acodeModule("Url");
  if (!fs || !Url) throw new Error("Required Acode modules are unavailable");

  await ensurePluginDir();

  const root = Url.join(PLUGIN_DIR, built.id);
  if (await fs(root).exists()) await fs(root).delete();
  await fs(PLUGIN_DIR).createDirectory(built.id);

  const assets = [{ path: "plugin.json", data: JSON.stringify(built.pluginJson, null, 2) }, ...built.assets];
  const total = assets.length;

  for (let index = 0; index < assets.length; index++) {
    const asset = assets[index];
    await writeAsset(root, asset, fs, Url);
    if (onProgress) {
      onProgress({ loaded: index + 1, total, path: asset.path });
    }
  }

  return root;
}

async function writeAsset(root, asset, fs, Url) {
  const segments = String(asset.path).split("/").filter(Boolean);
  const fileName = segments.pop();
  let parent = root;

  for (const segment of segments) {
    const next = Url.join(parent, segment);
    if (!(await fs(next).exists())) await fs(parent).createDirectory(segment);
    parent = next;
  }

  const target = Url.join(parent, fileName);
  const data = toWritable(asset.data, fileName);

  if (await fs(target).exists()) await fs(target).delete();
  await fs(parent).createFile(fileName, data);
}

/** Cordova's FileWriter accepts strings and Blobs; wrap binary assets in a Blob. */
function toWritable(data, fileName) {
  if (typeof data === "string") return data;
  if (typeof Blob !== "undefined") {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    if (bytes && typeof bytes === "object" && bytes.buffer) {
      return new Blob([bytes], { type: mimeFor(fileName) });
    }
  }
  return data || "";
}

function mimeFor(fileName) {
  const ext = String(fileName).split(".").pop().toLowerCase();
  const types = {
    png: "image/png",
    svg: "image/svg+xml",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    json: "application/json",
    js: "text/javascript",
    md: "text/markdown",
    txt: "text/plain",
  };
  return types[ext] || "application/octet-stream";
}

/** List converted plugins currently present in PLUGIN_DIR. */
export async function listConverted() {
  const { PLUGIN_DIR } = globals();
  const fs = acodeModule("fs");
  const Url = acodeModule("Url");
  if (!fs || !Url) return [];

  let entries = [];
  try {
    entries = await fs(PLUGIN_DIR).lsDir();
  } catch {
    return [];
  }

  const result = [];
  for (const entry of entries) {
    const name = entry.name || Url.basename(entry.url);
    if (!isConvertedPlugin(name)) continue;
    try {
      const json = await fs(Url.join(entry.url, "plugin.json")).readFile("json");
      result.push({ id: name, dir: entry.url, json });
    } catch {
      result.push({ id: name, dir: entry.url, json: null });
    }
  }
  return result;
}

export async function removeConverted(id) {
  const { PLUGIN_DIR } = globals();
  const fs = acodeModule("fs");
  const Url = acodeModule("Url");
  if (!fs || !Url) throw new Error("Required Acode modules are unavailable");

  try {
    acode.unmountPlugin(id);
  } catch {
    /* not loaded */
  }

  const root = Url.join(PLUGIN_DIR, id);
  if (await fs(root).exists()) await fs(root).delete();
}

/**
 * Load a freshly written plugin without restarting Acode. Replicates the
 * relevant part of Acode's loadPlugin: append the main script, then call
 * acode.initPlugin with the cache file and a bound fileIcons API.
 */
export async function activatePlugin(id, { firstInit = true, fileIcons } = {}) {
  const { PLUGIN_DIR, CACHE_STORAGE } = globals();
  const fs = acodeModule("fs");
  const Url = acodeModule("Url");
  const helpers = acodeModule("helpers");
  const Page = acodeModule("page");
  const actionStack = acodeModule("actionStack");
  if (!fs || !Url || !helpers || !Page) throw new Error("Required Acode modules are unavailable");

  const pluginJson = await fs(Url.join(PLUGIN_DIR, id, "plugin.json")).readFile("json");
  const baseUrl = await helpers.toInternalUri(Url.join(PLUGIN_DIR, id));
  const cacheFile = Url.join(CACHE_STORAGE, id);
  const iconApi = fileIcons || acodeModule("fileIcons");

  const oldScript = document.getElementById(`${id}-mainScript`);
  if (oldScript) oldScript.remove();

  const mainPath = pluginJson.main || "main.js";
  const mainUrl = Url.join(baseUrl, mainPath);

  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = `${id}-mainScript`;
    script.src = mainUrl;
    script.onerror = () => reject(new Error(`Failed to load script for ${id}`));
    script.onload = async () => {
      try {
        const page = Page("Plugin");
        page.show = () => {
          actionStack?.push({ id, action: page.hide });
          globals().app.append(page);
        };
        page.onhide = () => actionStack?.remove(id);

        if (!(await fs(cacheFile).exists())) {
          await fs(CACHE_STORAGE).createFile(id);
        }

        await acode.initPlugin(id, baseUrl, page, {
          fileIcons: iconApi,
          cacheFileUrl: await helpers.toInternalUri(cacheFile),
          cacheFile: fs(cacheFile),
          firstInit,
        });
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    document.head.append(script);
  });

  return true;
}

export async function reloadPlugin(id) {
  try {
    acode.unmountPlugin(id);
  } catch {
    /* ignore */
  }
  return activatePlugin(id, { firstInit: false });
}

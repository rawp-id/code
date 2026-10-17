import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface Settings {
  editor: {
    fontSize: number;
    tabSize: number;
    wordWrap: "off" | "on";
    lineNumbers: boolean;
    highlightActiveLine: boolean;
    autoSave: "off" | "afterDelay" | "onFocusChange";
    autoSaveDelay: number;
    colorTheme: string;
  };
  files: { exclude: string[] };
  search: { exclude: string[]; maxResults: number };
  terminal: { fontSize: number; prompt: string };
  workbench: { sidebarWidth: number; iconTheme: "default" | "minimal" };
  [key: string]: any;
}

export const DEFAULT_SETTINGS: Settings = {
  editor: {
    fontSize: 14,
    tabSize: 2,
    wordWrap: "off",
    lineNumbers: true,
    highlightActiveLine: true,
    autoSave: "off",
    autoSaveDelay: 1000,
    colorTheme: "dark-plus",
  },
  files: {
    exclude: [
      "node_modules",
      ".git",
      "dist",
      "build",
      ".cache",
      ".next",
      "vendor",
      "target",
      "coverage",
      ".gradle",
      ".idea",
      ".dart_tool",
      "Pods",
    ],
  },
  search: {
    exclude: [
      "node_modules",
      ".git",
      "dist",
      "build",
      ".cache",
      ".next",
      "vendor",
      "target",
      "coverage",
      ".gradle",
      ".idea",
      ".dart_tool",
      "Pods",
    ],
    maxResults: 1000,
  },
  terminal: {
    fontSize: 13,
    prompt: "\\u@\\h \\w \\$ ",
  },
  workbench: {
    sidebarWidth: 240,
    iconTheme: "default",
  },
};

function isObject(value: any): boolean {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function mergeSettings(base: any, override: any): any {
  const out: any = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    out[key] = isObject(value) && isObject(base[key]) ? mergeSettings(base[key], value) : value;
  }
  return out;
}

/** Read merged settings (defaults + `<workspace>/settings.json`). */
export function readSettings(root: string): Settings {
  try {
    const raw = JSON.parse(readFileSync(path.join(root, "settings.json"), "utf8"));
    return mergeSettings(DEFAULT_SETTINGS, raw) as Settings;
  } catch {
    return mergeSettings(DEFAULT_SETTINGS, {}) as Settings;
  }
}

export function writeSettings(root: string, settings: any): Settings {
  const merged = mergeSettings(DEFAULT_SETTINGS, settings) as Settings;
  writeFileSync(
    path.join(root, "settings.json"),
    JSON.stringify(merged, null, 2) + "\n",
    "utf8"
  );
  return merged;
}

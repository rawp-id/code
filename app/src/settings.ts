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
  files: { exclude: [] },
  search: { exclude: [], maxResults: 1000 },
  terminal: { fontSize: 13, prompt: "\\u@\\h \\w \\$ " },
  workbench: { sidebarWidth: 240, iconTheme: "default" },
};

export function getPath(object: any, dotted: string, fallback?: any): any {
  let current = object;
  for (const key of dotted.split(".")) {
    if (current == null || typeof current !== "object") return fallback;
    current = current[key];
    if (current === undefined) return fallback;
  }
  return current;
}

export function setPath(object: any, dotted: string, value: any): void {
  const keys = dotted.split(".");
  let current = object;
  for (const key of keys.slice(0, -1)) {
    if (!current[key] || typeof current[key] !== "object") current[key] = {};
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}

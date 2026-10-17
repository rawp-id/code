/** Inline SVG icons (VSCode-like, no emoji, no external assets). */

const outline = (inner: string, size = 16) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" ` +
  `fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const icons = {
  explorer: outline(
    `<path d="M4.2 2.6h4.6l3 3v8.2H4.2z"/><path d="M8.8 2.6v3h3"/>`,
    22
  ),
  extensions: outline(
    `<path d="M2.6 2.6h4v4h-4z"/><path d="M9.4 2.6h4v4h-4z"/><path d="M2.6 9.4h4v4h-4z"/><path d="M9.4 9.4h1.6a2.4 2.4 0 1 1 2.4 2.4v1.6h-4z"/>`,
    22
  ),
  search: outline(`<circle cx="7.2" cy="7.2" r="4.2"/><path d="M10.4 10.4L14 14"/>`, 22),
  settings:
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">` +
    `<circle cx="12" cy="12" r="3"/>` +
    `<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>` +
    `</svg>`,
  newFile: outline(
    `<path d="M4 2.6h4l3 3V9"/><path d="M8 2.6v3h3"/><path d="M11.5 9.4v4.6M9.2 11.7h4.6"/>`
  ),
  newFolder: outline(
    `<path d="M2 3.8h3.5l1.1 1.4h7.4v3.4"/><path d="M2 3.8v8.4h4.6"/><path d="M11.5 9.6v4.4M9.3 11.8h4.4"/>`
  ),
  refresh: outline(`<path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M13.2 3.2v3h-3"/>`),
  openFolder: outline(
    `<path d="M1.9 3.6h3.8l1.2 1.5h7.2v7.3H1.9z"/><path d="M8 11.6V6.6"/><path d="M5.9 8.6L8 6.5l2.1 2.1"/>`
  ),
  rename: outline(`<path d="M2.5 13.5l1-3L11 3l2 2-7.5 7.5z"/><path d="M9.8 4.2l2 2"/>`),
  trash: outline(
    `<path d="M2.6 4.6h10.8"/><path d="M6.3 4.6V3h3.4v1.6"/><path d="M4.2 4.6l.7 9.4h6.2l.7-9.4"/>`
  ),
  chevronRight: outline(`<path d="M6 3.5L10.5 8 6 12.5"/>`, 14),
  chevronLeft: outline(`<path d="M10 3.5L5.5 8 10 12.5"/>`, 14),
  chevronDown: outline(`<path d="M3.5 6L8 10.5 12.5 6"/>`, 14),
  folder: outline(`<path d="M1.9 3.6h3.8l1.2 1.5h7.2v7.3H1.9z"/>`),
  folderOpen: outline(
    `<path d="M1.9 3.6h3.8l1.2 1.5h7.2v1.4H1.9z"/><path d="M1.6 6.5h12.9l-1.4 6.1a.7.7 0 0 1-.68.53H2.9a.7.7 0 0 1-.68-.53z"/>`
  ),
  file: outline(`<path d="M3.6 2.2h5.1l3.3 3.3v8.3H3.6z"/><path d="M8.7 2.2v3.3h3.3"/>`),
  close: outline(`<path d="M4 4l8 8M12 4l-8 8"/>`, 14),
};

/** Accent colour for a file icon, by extension. */
let iconTheme: "default" | "minimal" = "default";

export function setIconTheme(name: string): void {
  iconTheme = name === "minimal" ? "minimal" : "default";
}

export function fileColor(fileName: string): string {
  if (iconTheme === "minimal") return "#8a8a8a";
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
  const colors: Record<string, string> = {
    ".js": "#e5c07b",
    ".mjs": "#e5c07b",
    ".cjs": "#e5c07b",
    ".jsx": "#61dafb",
    ".ts": "#4d9fec",
    ".tsx": "#4d9fec",
    ".json": "#e5c07b",
    ".html": "#e06c4b",
    ".htm": "#e06c4b",
    ".css": "#42a5f5",
    ".scss": "#cf649a",
    ".md": "#519aba",
    ".markdown": "#519aba",
    ".py": "#4b8bbe",
    ".rs": "#dea584",
    ".go": "#00add8",
    ".java": "#b07219",
    ".kt": "#a97bff",
    ".c": "#6f7c8c",
    ".h": "#6f7c8c",
    ".cpp": "#f34b7d",
    ".cc": "#f34b7d",
    ".hpp": "#f34b7d",
    ".cs": "#9b4f96",
    ".php": "#8892bf",
    ".rb": "#cc342d",
    ".swift": "#f05138",
    ".vue": "#41b883",
    ".svelte": "#ff3e00",
    ".sql": "#e38c00",
    ".xml": "#e37933",
    ".svg": "#ffb13b",
    ".yml": "#cb6d51",
    ".yaml": "#cb6d51",
    ".sh": "#89e051",
    ".bash": "#89e051",
    ".sass": "#cf649a",
    ".less": "#4a86c8",
    ".toml": "#9c6b4f",
    ".ini": "#6d8086",
    ".diff": "#8a8a8a",
    ".patch": "#8a8a8a",
  };
  return colors[ext] || "#7f8c98";
}

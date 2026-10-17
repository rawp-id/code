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
  chevronRight: outline(`<path d="M6 3.5L10.5 8 6 12.5"/>`, 14),
  chevronDown: outline(`<path d="M3.5 6L8 10.5 12.5 6"/>`, 14),
  folder: outline(`<path d="M1.9 3.6h3.8l1.2 1.5h7.2v7.3H1.9z"/>`),
  folderOpen: outline(
    `<path d="M1.9 3.6h3.8l1.2 1.5h7.2v1.4H1.9z"/><path d="M1.6 6.5h12.9l-1.4 6.1a.7.7 0 0 1-.68.53H2.9a.7.7 0 0 1-.68-.53z"/>`
  ),
  file: outline(`<path d="M3.6 2.2h5.1l3.3 3.3v8.3H3.6z"/><path d="M8.7 2.2v3.3h3.3"/>`),
  close: outline(`<path d="M4 4l8 8M12 4l-8 8"/>`, 14),
};

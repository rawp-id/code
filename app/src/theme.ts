/**
 * Apply a VS Code color theme's workbench colors to the whole UI.
 *
 * Shiki only knows the editor (syntax) colors, so this module maps the theme's
 * `colors` map (or derives a coherent palette from the editor background /
 * foreground when the theme does not provide one) onto our CSS variables.
 */

export interface ThemeRegistrationLike {
  name?: string;
  type?: string;
  fg?: string;
  bg?: string;
  colors?: Record<string, string>;
}

type RGB = [number, number, number];

function parseColor(color: string | undefined): RGB | null {
  if (!color) return null;
  let c = color.trim().replace(/^#/, "");
  if (c.length === 3 || c.length === 4) {
    c = c
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  if (c.length === 6 || c.length === 8) {
    const num = parseInt(c.slice(0, 6), 16);
    if (Number.isNaN(num)) return null;
    return [(num >>> 16) & 255, (num >>> 8) & 255, num & 255];
  }
  const match = /^rgba?\(([^)]+)\)$/.exec(color.trim());
  if (match) {
    const parts = match[1].split(",").map((p) => parseFloat(p.trim()));
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
      return [parts[0], parts[1], parts[2]];
    }
  }
  return null;
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Blend two colors; `t` is the weight of `b` (0..1). */
export function mixColors(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  return toHex(
    ca[0] + (cb[0] - ca[0]) * t,
    ca[1] + (cb[1] - ca[1]) * t,
    ca[2] + (cb[2] - ca[2]) * t
  );
}

function luminance(color: string | undefined): number {
  const c = parseColor(color);
  if (!c) return 0;
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
}

export function isDarkTheme(theme: ThemeRegistrationLike | undefined): boolean {
  const type = (theme?.type || "").toLowerCase();
  if (type === "light" || type === "hcLight") return false;
  if (type === "dark" || type === "hcDark") return true;
  const bg = theme?.bg || theme?.colors?.["editor.background"];
  return luminance(bg) < 0.5;
}

let appliedDark: boolean | null = null;

/** A color that would be invisible (fully transparent) should not be used. */
function transparent(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.trim();
  if (/^#[0-9a-fA-F]{8}$/.test(v)) return v.slice(7).toLowerCase() === "00";
  if (/^#[0-9a-fA-F]{4}$/.test(v)) return v[4].toLowerCase() === "0";
  const match = /^rgba?\(([^)]+)\)$/.exec(v);
  if (match) {
    const parts = match[1].split(",").map((p) => p.trim());
    if (parts.length >= 4) return parseFloat(parts[3]) <= 0;
  }
  return false;
}

/** Apply the given theme to the workbench. Returns whether it is a dark theme. */
export function applyWorkbenchTheme(theme: ThemeRegistrationLike | undefined): boolean {
  const root = document.documentElement;
  const colors = theme?.colors ?? {};
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = colors[key];
      if (value && !transparent(value)) return value;
    }
    return undefined;
  };

  const dark = isDarkTheme(theme);
  const bg = theme?.bg || pick("editor.background") || (dark ? "#1e1e1e" : "#ffffff");
  const fg =
    theme?.fg || pick("editor.foreground", "foreground") || (dark ? "#d4d4d4" : "#333333");
  const surface = (t: number) => mixColors(bg, fg, t);
  const setVar = (name: string, value: string | undefined, fallback: string) => {
    root.style.setProperty(name, value || fallback);
  };

  setVar("--bg", pick("editor.background"), bg);
  setVar("--fg", pick("editor.foreground", "foreground"), fg);

  setVar("--bg-side", pick("sideBar.background"), surface(dark ? 0.055 : 0.045));
  setVar("--bg-activity", pick("activityBar.background"), surface(dark ? 0.09 : 0.075));
  setVar("--bg-tab", pick("editorGroupHeader.tabsBackground"), surface(dark ? 0.05 : 0.045));
  setVar("--bg-tab-active", pick("tab.activeBackground"), pick("editor.background") || bg);
  setVar("--bg-panel", pick("panel.background"), pick("editor.background") || bg);

  const dimFallback = mixColors(fg, bg, 0.45);
  const dimCandidate = pick("descriptionForeground", "disabledForeground");
  const fgDim =
    dimCandidate && Math.abs(luminance(dimCandidate) - luminance(fg)) > 0.08
      ? dimCandidate
      : dimFallback;
  setVar("--fg-dim", fgDim, dimFallback);
  setVar(
    "--border",
    pick(
      "panel.border",
      "editorGroup.border",
      "sideBar.border",
      "contrastBorder",
      "editorWidget.border",
      "input.border"
    ),
    surface(dark ? 0.14 : 0.12)
  );
  setVar(
    "--hover",
    pick("list.hoverBackground", "toolbar.hoverBackground", "editorHoverWidget.background", "menu.selectionBackground"),
    surface(dark ? 0.09 : 0.06)
  );
  setVar(
    "--selected",
    pick("list.activeSelectionBackground", "editor.selectionBackground", "tab.activeBorder"),
    dark ? "#094771" : "#cde8ff"
  );
  setVar(
    "--accent",
    pick(
      "activityBarBadge.background",
      "textLink.foreground",
      "button.background",
      "editorInfo.foreground",
      "focusBorder"
    ),
    dark ? "#0078d4" : "#005fb8"
  );
  setVar("--status", pick("statusBar.background"), pick("activityBar.background") || "#007acc");
  setVar("--status-fg", pick("statusBar.foreground"), "#ffffff");
  setVar("--error", pick("errorForeground", "editorError.foreground"), dark ? "#f14c4c" : "#e51400");
  setVar(
    "--warning",
    pick("editorWarning.foreground", "list.warningForeground"),
    dark ? "#cca700" : "#bf8803"
  );

  setVar(
    "--input-bg",
    pick("input.background", "dropdown.background", "editorWidget.background"),
    surface(dark ? 0.08 : 0.05)
  );
  setVar(
    "--widget-bg",
    pick("menu.background", "editorWidget.background", "dropdown.background", "input.background"),
    surface(dark ? 0.06 : 0.04)
  );

  root.dataset.theme = dark ? "dark" : "light";
  appliedDark = dark;
  return dark;
}

export function themeIsDark(): boolean {
  return appliedDark !== false;
}

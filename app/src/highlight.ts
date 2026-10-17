import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import wasm from "shiki/wasm";
import darkPlus from "@shikijs/themes/dark-plus";
import oneDarkPro from "@shikijs/themes/one-dark-pro";
import githubDark from "@shikijs/themes/github-dark";
import monokai from "@shikijs/themes/monokai";
import dracula from "@shikijs/themes/dracula";
import nord from "@shikijs/themes/nord";
import vitesseDark from "@shikijs/themes/vitesse-dark";
import solarizedDark from "@shikijs/themes/solarized-dark";
import materialTheme from "@shikijs/themes/material-theme";
import catppuccinMocha from "@shikijs/themes/catppuccin-mocha";
import tokyoNight from "@shikijs/themes/tokyo-night";
import { StateEffect, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { applyWorkbenchTheme, isDarkTheme } from "./theme";

export const SHIKI_THEMES: Record<string, { label: string; theme: any }> = {
  "dark-plus": { label: "Dark+ (VS Code)", theme: darkPlus },
  "one-dark-pro": { label: "One Dark Pro", theme: oneDarkPro },
  "github-dark": { label: "GitHub Dark", theme: githubDark },
  monokai: { label: "Monokai", theme: monokai },
  dracula: { label: "Dracula", theme: dracula },
  nord: { label: "Nord", theme: nord },
  "vitesse-dark": { label: "Vitesse Dark", theme: vitesseDark },
  "solarized-dark": { label: "Solarized Dark", theme: solarizedDark },
  "material-theme": { label: "Material Theme", theme: materialTheme },
  "catppuccin-mocha": { label: "Catppuccin Mocha", theme: catppuccinMocha },
  "tokyo-night": { label: "Tokyo Night", theme: tokyoNight },
};

const DEFAULT_THEME = "dark-plus";
let currentTheme = DEFAULT_THEME;

const themeRegistry = new Map<string, any>(
  Object.entries(SHIKI_THEMES).map(([name, entry]) => [name, entry.theme])
);

/** Register a theme at runtime (e.g. from an installed VS Code theme). */
export function registerShikiTheme(name: string, theme: any): void {
  // Give the theme a unique name: extension themes often all share the same
  // internal name (e.g. "Mayukai"), which makes Shiki resolve the wrong one.
  const registration = { ...theme, name };
  themeRegistry.set(name, registration);
  if (corePromise) {
    corePromise.then((core) => core.loadTheme(registration)).catch(() => undefined);
  }
}

function getTheme(name: string): any {
  return themeRegistry.get(name) || themeRegistry.get(DEFAULT_THEME);
}

export const refreshHighlighting = StateEffect.define<null>();

export function setShikiTheme(name: string): string {
  currentTheme = themeRegistry.has(name) ? name : DEFAULT_THEME;
  applyWorkbenchTheme(getTheme(currentTheme));
  return currentTheme;
}

function themeColors(name: string): {
  fg: string;
  bg: string;
  selection: string;
  lineHighlight: string;
  gutter: string;
  gutterActive: string;
  selectionMatch: string;
  bracket: string;
  bracketBorder: string;
  dark: boolean;
} {
  const theme: any = getTheme(name);
  const colors = theme.colors ?? {};
  const fg = theme.fg || colors["editor.foreground"] || "#d4d4d4";
  const bg = theme.bg || colors["editor.background"] || "#1e1e1e";
  const dark = isDarkTheme(theme);
  const overlay = dark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)";
  return {
    fg,
    bg,
    dark,
    selection: colors["editor.selectionBackground"] || (dark ? "#264f78" : "#add6ff"),
    lineHighlight: colors["editor.lineHighlightBackground"] || overlay,
    gutter: colors["editorLineNumber.foreground"] || (dark ? "#858585" : "#237893"),
    gutterActive: colors["editorLineNumber.activeForeground"] || (dark ? "#c6c6c6" : "#0b216f"),
    selectionMatch:
      colors["editor.selectionHighlightBackground"] || (dark ? "#3a3d41" : "#e5ebf1"),
    bracket: colors["editorBracketMatch.background"] || (dark ? "#3a3d41" : "#e5ebf1"),
    bracketBorder: colors["editorBracketMatch.border"] || (dark ? "#888888" : "#b9b9b9"),
  };
}

/** Base editor theme derived from the selected Shiki theme. */
export function editorBaseTheme(name: string): Extension {
  const c = themeColors(name);
  return EditorView.theme(
    {
      "&": { color: c.fg, backgroundColor: c.bg },
      ".cm-content": { caretColor: c.fg },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: c.fg },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: c.selection,
      },
      ".cm-gutters": { backgroundColor: c.bg, color: c.gutter, border: "none" },
      ".cm-activeLine": { backgroundColor: c.lineHighlight },
      ".cm-activeLineGutter": { backgroundColor: c.lineHighlight, color: c.gutterActive },
      ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 6px" },
      ".cm-selectionMatch": { backgroundColor: c.selectionMatch },
      ".cm-matchingBracket, .cm-nonmatchingBracket": {
        backgroundColor: c.bracket,
        outline: `1px solid ${c.bracketBorder}`,
      },
    },
    { dark: c.dark }
  );
}

/**
 * TextMate grammars are loaded lazily so the bundle only carries the languages
 * that are actually opened. Add a line here to support another language.
 */
const LANG_LOADERS: Record<string, () => Promise<any>> = {
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  json: () => import("@shikijs/langs/json"),
  html: () => import("@shikijs/langs/html"),
  vue: () => import("@shikijs/langs/vue"),
  svelte: () => import("@shikijs/langs/svelte"),
  css: () => import("@shikijs/langs/css"),
  scss: () => import("@shikijs/langs/scss"),
  less: () => import("@shikijs/langs/less"),
  markdown: () => import("@shikijs/langs/markdown"),
  python: () => import("@shikijs/langs/python"),
  rust: () => import("@shikijs/langs/rust"),
  go: () => import("@shikijs/langs/go"),
  java: () => import("@shikijs/langs/java"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  php: () => import("@shikijs/langs/php"),
  ruby: () => import("@shikijs/langs/ruby"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  sql: () => import("@shikijs/langs/sql"),
  xml: () => import("@shikijs/langs/xml"),
  ini: () => import("@shikijs/langs/ini"),
  diff: () => import("@shikijs/langs/diff"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  make: () => import("@shikijs/langs/make"),
};

let corePromise: Promise<HighlighterCore> | null = null;
const loaded = new Set<string>();

function getCore(): Promise<HighlighterCore> {
  if (!corePromise) {
    corePromise = createHighlighterCore({
      themes: [...themeRegistry.values()],
      langs: [],
      engine: createOnigurumaEngine(wasm),
    });
  }
  return corePromise;
}

async function ensureLanguage(lang: string): Promise<boolean> {
  if (loaded.has(lang)) return true;
  const loader = LANG_LOADERS[lang];
  if (!loader) return false;
  const core = await getCore();
  const module: any = await loader();
  await core.loadLanguage(module.default ?? module);
  loaded.add(lang);
  return true;
}

function styleFor(token: any): string {
  const parts: string[] = [];
  if (token.color) parts.push(`color:${token.color}`);
  const font = token.fontStyle || 0;
  if (font & 1) parts.push("font-style:italic");
  if (font & 2) parts.push("font-weight:600");
  if (font & 4) parts.push("text-decoration:underline");
  return parts.join(";");
}

function buildDecorations(view: EditorView, tokens: any[][]): DecorationSet {
  const total = view.state.doc.length;
  const ranges = view.visibleRanges;
  let from = ranges.length ? ranges[0].from : 0;
  let to = ranges.length ? ranges[ranges.length - 1].to : total;
  if (to <= from) {
    from = 0;
    to = total;
  }

  const marks = new Map<string, Decoration>();
  const list: { from: number; to: number; deco: Decoration }[] = [];

  let offset = 0;
  for (const line of tokens) {
    let cursor = offset;
    for (const token of line) {
      const start = cursor;
      const end = start + token.content.length;
      cursor = end;
      if (end <= start || end <= from || start >= to || end > total) continue;
      const style = styleFor(token);
      if (!style) continue;
      let mark = marks.get(style);
      if (!mark) {
        mark = Decoration.mark({ attributes: { style } });
        marks.set(style, mark);
      }
      list.push({ from: start, to: end, deco: mark });
    }
    offset = cursor + 1;
  }

  list.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(list.map((item) => item.deco.range(item.from, item.to)), true);
}

class ShikiRunner {
  private decorations: DecorationSet = Decoration.none;
  private timer: number | undefined;
  private destroyed = false;

  constructor(
    private view: EditorView,
    private lang: string,
    private onUpdate: (decorations: DecorationSet) => void
  ) {
    this.schedule(0);
  }

  update(update: ViewUpdate): void {
    const refreshed = update.transactions.some((tr) =>
      tr.effects.some((effect) => effect.is(refreshHighlighting))
    );
    if (update.docChanged || update.viewportChanged || update.geometryChanged || refreshed) {
      this.schedule(60);
    }
  }

  destroy(): void {
    this.destroyed = true;
    window.clearTimeout(this.timer);
  }

  private schedule(delay: number): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.run(), delay);
  }

  private async run(): Promise<void> {
    const text = this.view.state.doc.toString();
    try {
      if (!(await ensureLanguage(this.lang))) return;
      const core = await getCore();
      if (this.destroyed) return;
      const result = core.codeToTokens(text, { lang: this.lang, theme: getTheme(currentTheme) });
      if (this.destroyed) return;
      this.decorations = buildDecorations(this.view, result.tokens);
      this.onUpdate(this.decorations);
      this.view.dispatch({});
    } catch {
      /* highlighting is best-effort */
    }
  }
}

export function shikiHighlighting(lang?: string): Extension {
  if (!lang || !LANG_LOADERS[lang]) return [];
  const language = lang;
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private runner: ShikiRunner;
      constructor(view: EditorView) {
        this.runner = new ShikiRunner(view, language, (decorations) => {
          this.decorations = decorations;
        });
      }
      update(update: ViewUpdate): void {
        this.runner.update(update);
      }
      destroy(): void {
        this.runner.destroy();
      }
    },
    { decorations: (value) => value.decorations }
  );
}

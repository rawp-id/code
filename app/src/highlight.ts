import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import wasm from "shiki/wasm";
import oneDarkPro from "@shikijs/themes/one-dark-pro";
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

const THEME = "one-dark-pro";
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
      themes: [oneDarkPro],
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
  const from = ranges.length ? ranges[0].from : 0;
  const to = ranges.length ? ranges[ranges.length - 1].to : total;

  const marks = new Map<string, Decoration>();
  const ranges2: { from: number; to: number; deco: Decoration }[] = [];

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
      ranges2.push({ from: start, to: end, deco: mark });
    }
    offset = cursor + 1; // newline
  }

  ranges2.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(
    ranges2.map((range) => range.deco.range(range.from, range.to)),
    true
  );
}

/** Async TextMate highlighting, applied as inline-styled marks. */
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
    if (update.docChanged || update.viewportChanged) this.schedule(60);
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
      const result = core.codeToTokens(text, { lang: this.lang, theme: THEME });
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

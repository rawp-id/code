import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import type { Extension } from "@codemirror/state";

export interface LanguageSpec {
  /** Language id sent to the language server. */
  languageId: string;
  /** Shiki (TextMate) grammar id used for highlighting. */
  shiki?: string;
  /** CodeMirror language support (bracket matching, indentation, folding). */
  extensions: Extension[];
}

interface Entry {
  languageId: string;
  shiki?: string;
  cm?: () => Extension;
}

const EXTENSIONS: Record<string, Entry> = {
  ".js": { languageId: "javascript", shiki: "javascript", cm: () => javascript({ jsx: true }) },
  ".mjs": { languageId: "javascript", shiki: "javascript", cm: () => javascript({ jsx: true }) },
  ".cjs": { languageId: "javascript", shiki: "javascript", cm: () => javascript({ jsx: true }) },
  ".jsx": { languageId: "javascriptreact", shiki: "jsx", cm: () => javascript({ jsx: true }) },
  ".ts": {
    languageId: "typescript",
    shiki: "typescript",
    cm: () => javascript({ typescript: true, jsx: true }),
  },
  ".tsx": {
    languageId: "typescriptreact",
    shiki: "tsx",
    cm: () => javascript({ typescript: true, jsx: true }),
  },
  ".json": { languageId: "json", shiki: "json", cm: () => json() },
  ".jsonc": { languageId: "jsonc", shiki: "json", cm: () => json() },
  ".html": { languageId: "html", shiki: "html", cm: () => html() },
  ".htm": { languageId: "html", shiki: "html", cm: () => html() },
  ".vue": { languageId: "vue", shiki: "vue" },
  ".svelte": { languageId: "svelte", shiki: "svelte" },
  ".css": { languageId: "css", shiki: "css", cm: () => css() },
  ".scss": { languageId: "scss", shiki: "scss" },
  ".less": { languageId: "less", shiki: "less" },
  ".md": { languageId: "markdown", shiki: "markdown", cm: () => markdown() },
  ".markdown": { languageId: "markdown", shiki: "markdown", cm: () => markdown() },
  ".py": { languageId: "python", shiki: "python", cm: () => python() },
  ".rs": { languageId: "rust", shiki: "rust" },
  ".go": { languageId: "go", shiki: "go" },
  ".java": { languageId: "java", shiki: "java" },
  ".kt": { languageId: "kotlin", shiki: "kotlin" },
  ".c": { languageId: "c", shiki: "c" },
  ".h": { languageId: "c", shiki: "cpp" },
  ".cpp": { languageId: "cpp", shiki: "cpp" },
  ".cc": { languageId: "cpp", shiki: "cpp" },
  ".hpp": { languageId: "cpp", shiki: "cpp" },
  ".cs": { languageId: "csharp", shiki: "csharp" },
  ".php": { languageId: "php", shiki: "php" },
  ".rb": { languageId: "ruby", shiki: "ruby" },
  ".sh": { languageId: "shellscript", shiki: "shellscript" },
  ".bash": { languageId: "shellscript", shiki: "shellscript" },
  ".zsh": { languageId: "shellscript", shiki: "shellscript" },
  ".yml": { languageId: "yaml", shiki: "yaml" },
  ".yaml": { languageId: "yaml", shiki: "yaml" },
  ".toml": { languageId: "toml", shiki: "toml" },
  ".sql": { languageId: "sql", shiki: "sql" },
  ".xml": { languageId: "xml", shiki: "xml" },
  ".svg": { languageId: "xml", shiki: "xml" },
  ".ini": { languageId: "ini", shiki: "ini" },
  ".conf": { languageId: "ini", shiki: "ini" },
  ".env": { languageId: "ini", shiki: "ini" },
  ".diff": { languageId: "diff", shiki: "diff" },
  ".patch": { languageId: "diff", shiki: "diff" },
};

const SPECIAL_FILES: Record<string, Entry> = {
  dockerfile: { languageId: "dockerfile", shiki: "dockerfile" },
  makefile: { languageId: "makefile", shiki: "make" },
};

export function languageFor(filePath: string): LanguageSpec {
  const lower = filePath.toLowerCase();
  const base = lower.slice(lower.lastIndexOf("/") + 1);
  const special = SPECIAL_FILES[base] ?? SPECIAL_FILES[base.split(".")[0]];
  if (special) return toSpec(special);

  const dot = lower.lastIndexOf(".");
  const entry = dot >= 0 ? EXTENSIONS[lower.slice(dot)] : undefined;
  if (!entry) return { languageId: "plaintext", extensions: [] };
  return toSpec(entry);
}

function toSpec(entry: Entry): LanguageSpec {
  return {
    languageId: entry.languageId,
    shiki: entry.shiki,
    extensions: entry.cm ? [entry.cm()] : [],
  };
}

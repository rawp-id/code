import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import type { Extension } from "@codemirror/state";

export interface LanguageSpec {
  languageId: string;
  extensions: Extension[];
}

export function languageFor(filePath: string): LanguageSpec {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".tsx":
      return { languageId: "typescript", extensions: [javascript({ typescript: true, jsx: true })] };
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return { languageId: "javascript", extensions: [javascript({ jsx: true })] };
    case ".json":
      return { languageId: "json", extensions: [json()] };
    case ".html":
    case ".htm":
      return { languageId: "html", extensions: [html()] };
    case ".css":
      return { languageId: "css", extensions: [css()] };
    case ".md":
    case ".markdown":
      return { languageId: "markdown", extensions: [markdown()] };
    case ".py":
      return { languageId: "python", extensions: [python()] };
    default:
      return { languageId: "plaintext", extensions: [] };
  }
}

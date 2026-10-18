import type { Settings } from "./settings";

/**
 * Formatter registry (VS Code-style providers).
 *
 * Metadata lives on the main thread; the actual formatting runs inside the
 * language worker (see `worker/language-worker.ts`). Providers are selected by
 * `resolveFormatter()` using (in order): per-language default, global default,
 * a single available provider, or the highest priority.
 */

export type FormatterSource = "builtin" | "wasm" | "lsp" | "server-ext" | "client-ext";

export interface FormatterProvider {
  id: string;
  label: string;
  source: FormatterSource;
  languages: string[];
  /** Higher wins when several providers support the same language. */
  priority: number;
  kind: ("document" | "range" | "onType")[];
}

const JS_LIKE = [
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
  "json",
  "jsonc",
  "css",
  "scss",
  "less",
  "html",
  "vue",
  "markdown",
  "yaml",
];

export const FORMATTERS: FormatterProvider[] = [
  {
    id: "builtin:prettier",
    label: "Prettier",
    source: "builtin",
    priority: 100,
    kind: ["document", "range"],
    languages: JS_LIKE,
  },
  {
    id: "builtin:json",
    label: "JSON (basic)",
    source: "builtin",
    priority: 20,
    kind: ["document"],
    languages: ["json", "jsonc"],
  },
];

/** Providers that can format `languageId`, highest priority first. */
export function formattersFor(languageId: string): FormatterProvider[] {
  return FORMATTERS.filter((provider) => provider.languages.includes(languageId)).sort(
    (a, b) => b.priority - a.priority || a.label.localeCompare(b.label)
  );
}

export type FormatterReason =
  | "language-default"
  | "global-default"
  | "only-provider"
  | "priority";

export interface ResolvedFormatter {
  provider: FormatterProvider;
  reason: FormatterReason;
}

function byId(providers: FormatterProvider[], id: string | undefined): FormatterProvider | null {
  if (!id) return null;
  return providers.find((provider) => provider.id === id) ?? null;
}

/** Select the formatter for a language, VS Code-style. */
export function resolveFormatter(
  languageId: string,
  settings: Settings | null
): ResolvedFormatter | null {
  const candidates = formattersFor(languageId);
  if (candidates.length === 0) return null;

  const languageDefault = byId(candidates, settings?.formatters?.byLanguage?.[languageId]);
  if (languageDefault) return { provider: languageDefault, reason: "language-default" };

  const globalDefault = byId(candidates, settings?.editor?.defaultFormatter);
  if (globalDefault) return { provider: globalDefault, reason: "global-default" };

  if (candidates.length === 1) return { provider: candidates[0], reason: "only-provider" };
  return { provider: candidates[0], reason: "priority" };
}

/** Currently configured default id for a language (empty string = auto). */
export function configuredFormatterId(languageId: string, settings: Settings | null): string {
  return (
    settings?.formatters?.byLanguage?.[languageId] ||
    settings?.editor?.defaultFormatter ||
    ""
  );
}

/** Every language that has at least one formatter provider. */
export function languagesWithFormatters(): string[] {
  const languages = new Set<string>();
  for (const provider of FORMATTERS) {
    for (const language of provider.languages) languages.add(language);
  }
  return [...languages].sort();
}

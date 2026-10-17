import { promises as fs } from "node:fs";
import path from "node:path";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".cache",
  ".next",
  "vendor",
  "target",
  "coverage",
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_MATCHES = 1000;
const MAX_FILES = 200;

export interface SearchOptions {
  query: string;
  caseSensitive?: boolean;
  regex?: boolean;
  wholeWord?: boolean;
  maxResults?: number;
}

export interface SearchMatch {
  line: number;
  column: number;
  endColumn: number;
  text: string;
}

export interface SearchFileResult {
  path: string;
  matches: SearchMatch[];
}

export interface SearchResult {
  files: SearchFileResult[];
  matchCount: number;
  truncated: boolean;
}

/** Plain recursive text search over the workspace (skips binaries and heavy dirs). */
export async function searchWorkspace(
  root: string,
  options: SearchOptions
): Promise<SearchResult> {
  const query = String(options.query ?? "");
  if (!query) return { files: [], matchCount: 0, truncated: false };

  let source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (options.wholeWord) source = `\\b${source}\\b`;

  let pattern: RegExp;
  try {
    pattern = new RegExp(source, options.caseSensitive ? "g" : "gi");
  } catch {
    throw new Error("Invalid regular expression");
  }

  const limit = options.maxResults ?? DEFAULT_MAX_MATCHES;
  const files: SearchFileResult[] = [];
  let matchCount = 0;
  let truncated = false;

  const walk = async (dir: string): Promise<void> => {
    if (truncated || files.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (truncated) return;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile() || IGNORED_DIRS.has(entry.name)) continue;

      let content: Buffer;
      try {
        const stat = await fs.stat(full);
        if (stat.size > MAX_FILE_BYTES) continue;
        content = await fs.readFile(full);
      } catch {
        continue;
      }
      if (content.includes(0)) continue; // binary

      const lines = content.toString("utf8").split("\n");
      const matches: SearchMatch[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
          matches.push({
            line: i + 1,
            column: match.index,
            endColumn: match.index + match[0].length,
            text: line,
          });
          matchCount++;
          if (match[0].length === 0) pattern.lastIndex++;
          if (matchCount >= limit) {
            truncated = true;
            break;
          }
        }
        if (truncated) break;
      }
      if (matches.length > 0) {
        files.push({ path: path.relative(root, full).split(path.sep).join("/"), matches });
      }
    }
  };

  await walk(root);
  return { files, matchCount, truncated };
}

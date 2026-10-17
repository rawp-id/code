import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface DirListing {
  path: string;
  parent: string | null;
  home: string;
  dirs: { name: string; path: string }[];
  truncated: boolean;
}

const MAX_DIRS = 2000;

/**
 * List sub-directories of an absolute path so the UI can browse the device.
 * Paths are NOT restricted to the workspace: this is a read-only picker, and
 * the result is only used after the user confirms it.
 */
export async function listDirectories(input?: string): Promise<DirListing> {
  const home = os.homedir();
  let dir = expand(input, home);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: path.join(dir, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const truncated = dirs.length > MAX_DIRS;
  const parentDir = path.dirname(dir);
  return {
    path: dir,
    parent: parentDir === dir ? null : parentDir,
    home,
    dirs: truncated ? dirs.slice(0, MAX_DIRS) : dirs,
    truncated,
  };
}

function expand(input: string | undefined, home: string): string {
  const raw = (input || "").trim();
  if (!raw) return home;
  if (raw === "~") return home;
  if (raw.startsWith("~/")) return path.join(home, raw.slice(2));
  return path.resolve(raw);
}

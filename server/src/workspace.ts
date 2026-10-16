import { promises as fs } from "node:fs";
import path from "node:path";

export interface DirEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}

const IGNORED = new Set(["node_modules", ".git", ".DS_Store"]);

/**
 * A workspace rooted at a single absolute directory. Every path coming from the
 * client is relative to the root and is checked so it can never escape it.
 */
export class Workspace {
  root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  resolve(rel = ""): string {
    const target = path.resolve(this.root, rel);
    const check = path.relative(this.root, target);
    if (check.startsWith("..") || path.isAbsolute(check)) {
      throw new Error(`Path outside workspace: ${rel}`);
    }
    return target;
  }

  rel(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join("/");
  }

  async info() {
    return { root: this.root, name: path.basename(this.root) };
  }

  async readDir(rel = ""): Promise<DirEntry[]> {
    const dir = this.resolve(rel);
    const items = await fs.readdir(dir, { withFileTypes: true });
    const entries: DirEntry[] = [];
    for (const item of items) {
      if (IGNORED.has(item.name)) continue;
      entries.push({
        name: item.name,
        path: this.rel(path.join(dir, item.name)),
        type: item.isDirectory() ? "dir" : "file",
      });
    }
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  }

  async readFile(rel: string): Promise<string> {
    return fs.readFile(this.resolve(rel), "utf8");
  }

  async writeFile(rel: string, content: string): Promise<void> {
    const target = this.resolve(rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }

  async createFile(rel: string): Promise<void> {
    await this.writeFile(rel, "");
  }

  async mkdir(rel: string): Promise<void> {
    await fs.mkdir(this.resolve(rel), { recursive: true });
  }

  async rename(from: string, to: string): Promise<void> {
    await fs.rename(this.resolve(from), this.resolve(to));
  }

  async delete(rel: string): Promise<void> {
    await fs.rm(this.resolve(rel), { recursive: true, force: true });
  }
}

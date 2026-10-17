import { promises as fs } from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";

const dirCache = new Map<string, string>();

/** Find an installed extension directory by `<publisher>.<name>` id. */
export async function resolveExtensionDir(
  extensionsDir: string,
  id: string
): Promise<string | null> {
  if (dirCache.has(id)) return dirCache.get(id)!;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(extensionsDir);
  } catch {
    return null;
  }
  for (const name of entries) {
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(extensionsDir, name, "package.json"), "utf8")
      );
      const extId = `${manifest.publisher || "local"}.${manifest.name}`;
      if (extId === id) {
        const dir = path.join(extensionsDir, name);
        dirCache.set(id, dir);
        return dir;
      }
    } catch {
      /* not an extension */
    }
  }
  return null;
}

const MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** Serve a file that lives inside an installed extension. */
export async function serveExtensionAsset(
  extensionsDir: string,
  extId: string,
  relativePath: string,
  res: ServerResponse
): Promise<void> {
  const dir = await resolveExtensionDir(extensionsDir, extId);
  if (!dir) {
    res.writeHead(404);
    res.end("extension not found");
    return;
  }
  const file = path.resolve(dir, relativePath);
  if (file !== dir && !file.startsWith(dir + path.sep)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "public, max-age=3600",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

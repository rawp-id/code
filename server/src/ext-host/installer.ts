import AdmZip from "adm-zip";
import { promises as fs } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

export interface InstalledExtension {
  id: string;
  name: string;
  displayName: string;
  publisher: string;
  version: string;
  dir: string;
}

const PREFIX = "extension/";

/** Install a `.vsix` (from a local path or URL) into the extensions directory. */
export async function installVsix(
  extensionsDir: string,
  source: { path?: string; url?: string; data?: Buffer },
  onProgress?: (received: number, total: number) => void
): Promise<InstalledExtension> {
  let buffer = await readSource(source, onProgress);
  // The VS Code Marketplace serves gzipped packages; Open VSX serves plain VSIX.
  if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    buffer = gunzipSync(buffer);
  }
  const zip = new AdmZip(buffer);

  const manifestEntry = zip.getEntry(`${PREFIX}package.json`);
  if (!manifestEntry) throw new Error("Invalid VSIX: extension/package.json is missing");
  const manifest = JSON.parse(manifestEntry.getData().toString("utf8"));
  if (!manifest.name) throw new Error("Invalid VSIX: package.json has no name");

  const publisher = manifest.publisher || "local";
  const version = manifest.version || "0.0.0";
  const folder = `${publisher}.${manifest.name}-${version}`;
  const target = path.join(extensionsDir, folder);

  await removeExisting(extensionsDir, publisher, manifest.name);
  await fs.mkdir(target, { recursive: true });

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith(PREFIX)) continue;
    const relative = entry.entryName.slice(PREFIX.length);
    const outPath = path.resolve(target, relative);
    // Guard against `../` path traversal inside the archive.
    if (!outPath.startsWith(target + path.sep) && outPath !== target) continue;
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, entry.getData());
  }

  return {
    id: `${publisher}.${manifest.name}`,
    name: manifest.name,
    displayName: manifest.displayName || manifest.name,
    publisher,
    version,
    dir: target,
  };
}

export async function uninstallExtension(extensionsDir: string, id: string): Promise<boolean> {
  for (const name of await listDirs(extensionsDir)) {
    const manifest = await readManifest(extensionsDir, name);
    if (!manifest) continue;
    const manifestId = `${manifest.publisher || "local"}.${manifest.name}`;
    if (manifestId === id) {
      await fs.rm(path.join(extensionsDir, name), { recursive: true, force: true });
      return true;
    }
  }
  return false;
}

async function readSource(
  source: { path?: string; url?: string; data?: Buffer },
  onProgress?: (received: number, total: number) => void
): Promise<Buffer> {
  if (source.data) return source.data;
  if (source.url) {
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    const total = Number(response.headers.get("content-length") || 0);
    if (!response.body || !onProgress) {
      return Buffer.from(await response.arrayBuffer());
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress(received, total);
    }
    return Buffer.concat(chunks);
  }
  if (source.path) return fs.readFile(source.path);
  throw new Error("Provide a VSIX path, url or data");
}

async function removeExisting(extensionsDir: string, publisher: string, name: string): Promise<void> {
  for (const entry of await listDirs(extensionsDir)) {
    const manifest = await readManifest(extensionsDir, entry);
    if (!manifest) continue;
    if ((manifest.publisher || "local") === publisher && manifest.name === name) {
      await fs.rm(path.join(extensionsDir, entry), { recursive: true, force: true });
    }
  }
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function readManifest(dir: string, name: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, name, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

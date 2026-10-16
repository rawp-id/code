#!/usr/bin/env node
/**
 * Build a portable Kode server bundle (zip) that can be copied to a phone and
 * run from Termux / proot without a build step.
 *
 * Layout:
 *   dist/            compiled server
 *   lsp-servers/     bundled language server
 *   extensions/      sample extensions
 *   workspace/       sample workspace
 *   node_modules/    runtime deps (ws, adm-zip — no transitive deps)
 *   lsp.config.json
 *   start.sh
 */
import AdmZip from "adm-zip";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "server");
const OUT_DIR = path.join(ROOT, "build");

// ws and adm-zip have no transitive runtime dependencies.
const RUNTIME_MODULES = ["ws", "adm-zip"];

async function addTree(zip, abs, prefix) {
  const entries = await fs.readdir(abs, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(abs, entry.name);
    const name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await addTree(zip, child, name);
    else zip.addFile(name, await fs.readFile(child));
  }
}

async function main() {
  console.log("[bundle] building server (tsc)…");
  execFileSync("npm", ["--workspace", "server", "run", "build"], { cwd: ROOT, stdio: "inherit" });

  const zip = new AdmZip();
  await addTree(zip, path.join(SERVER, "dist"), "dist");
  await addTree(zip, path.join(SERVER, "lsp-servers"), "lsp-servers");
  await addTree(zip, path.join(SERVER, "extensions"), "extensions");
  await addTree(zip, path.join(SERVER, "workspace"), "workspace");
  zip.addFile("lsp.config.json", await fs.readFile(path.join(SERVER, "lsp.config.json")));

  zip.addFile(
    "package.json",
    Buffer.from(
      JSON.stringify(
        {
          name: "kode-server",
          private: true,
          version: "0.1.0",
          type: "module",
          main: "dist/index.js",
          scripts: { start: "node dist/index.js" },
        },
        null,
        2
      ) + "\n"
    )
  );

  for (const mod of RUNTIME_MODULES) {
    await addTree(zip, path.join(ROOT, "node_modules", mod), `node_modules/${mod}`);
  }

  zip.addFile(
    "start.sh",
    Buffer.from('#!/bin/sh\nexec node "$(dirname "$0")/dist/index.js" "$@"\n')
  );
  zip.addFile(
    "README.txt",
    Buffer.from(
      "Kode server bundle.\n" +
        "Run: ./start.sh   (or: node dist/index.js)\n" +
        "Env: PORT (default 3177), HOST (default 0.0.0.0), EDITOR_WORKSPACE (default ./workspace)\n"
    )
  );

  await fs.mkdir(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, "kode-server.zip");
  zip.writeZip(out);
  const size = (await fs.stat(out)).size;
  console.log(`[bundle] wrote ${out} (${(size / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

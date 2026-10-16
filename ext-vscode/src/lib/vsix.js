import JSZip from "jszip";
import { fetchBinary } from "./http.js";

const ROOT = "extension/";

export function downloadVsix(url, onProgress) {
  return fetchBinary(url, onProgress);
}

/**
 * Open a downloaded VSIX archive and normalise access to its files.
 * A VSIX is a zip whose payload lives under `extension/`.
 */
export async function openVsix(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const manifestEntry = findEntry(zip, `${ROOT}package.json`);
  if (!manifestEntry) {
    throw new Error("Invalid VSIX: extension/package.json is missing");
  }
  const manifest = JSON.parse(await manifestEntry.async("string"));
  return new VsxPackage(zip, manifest);
}

class VsxPackage {
  constructor(zip, manifest) {
    this.zip = zip;
    this.manifest = manifest;
    this.publisher = manifest.publisher || "unknown";
    this.name = manifest.name || "extension";
    this.displayName = manifest.displayName || manifest.name || "Extension";
    this.version = manifest.version || "0.0.0";
  }

  entry(path) {
    return findEntry(this.zip, this.normalize(path));
  }

  normalize(path) {
    const clean = String(path).replace(/^\.?\//, "").replace(/\\/g, "/");
    return clean.startsWith(ROOT) ? clean : `${ROOT}${clean}`;
  }

  has(path) {
    return Boolean(this.entry(path));
  }

  async text(path) {
    const entry = this.entry(path);
    return entry ? entry.async("string") : "";
  }

  async bytes(path) {
    const entry = this.entry(path);
    return entry ? entry.async("uint8array") : null;
  }

  async dataUrl(path) {
    const entry = this.entry(path);
    if (!entry) return "";
    const bytes = await entry.async("uint8array");
    return `data:${mimeFor(path)};base64,${toBase64(bytes)}`;
  }

  /** Resolve a contributes path declared in package.json. */
  resolve(path) {
    return this.normalize(path);
  }

  async readme() {
    const candidates = [this.manifest.readme, "README.md", "readme.md", "Readme.md"].filter(Boolean);
    for (const candidate of candidates) {
      if (await this.has(candidate)) return this.text(candidate);
    }
    return "";
  }

  async changelog() {
    const candidates = [this.manifest.changelog, "CHANGELOG.md", "changelog.md"].filter(Boolean);
    for (const candidate of candidates) {
      if (await this.has(candidate)) return this.text(candidate);
    }
    return "";
  }

  async icon() {
    const candidates = [
      this.manifest.icon,
      "icon.png",
      "logo.png",
      "images/icon.png",
      "assets/icon.png",
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (await this.has(candidate)) return this.dataUrl(candidate);
    }
    return "";
  }

  contributes() {
    return this.manifest.contributes || {};
  }

  /** Return the raw bytes of every file below a directory prefix. */
  async list(prefix = "") {
    const result = [];
    const normalized = prefix ? this.normalize(prefix).replace(/\/?$/, "/") : ROOT;
    for (const [path, entry] of Object.entries(this.zip.files)) {
      if (entry.dir) continue;
      if (!path.startsWith(normalized)) continue;
      result.push({ path, relative: path.slice(normalized.length), entry });
    }
    return result;
  }
}

function findEntry(zip, path) {
  const normalized = String(path).replace(/\\/g, "/");
  if (zip.file(normalized)) return zip.file(normalized);
  const lower = normalized.toLowerCase();
  const key = Object.keys(zip.files).find((name) => name.replace(/\\/g, "/").toLowerCase() === lower);
  return key ? zip.files[key] : null;
}

function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function mimeFor(path) {
  const ext = String(path).toLowerCase().split(".").pop();
  const map = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    ico: "image/x-icon",
  };
  return map[ext] || "application/octet-stream";
}

/**
 * Network helpers with progress reporting and a Cordova fallback.
 * Both Open VSX and the Visual Studio Marketplace send permissive CORS
 * headers, so a plain fetch works inside the Acode WebView.
 */

const DEFAULT_TIMEOUT = 30_000;

function withTimeout(signal, timeout) {
  if (!timeout) return signal;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function request(url, options = {}) {
  const { timeout = DEFAULT_TIMEOUT, signal, ...rest } = options;
  const wrapped = withTimeout(signal, timeout);
  try {
    return await fetch(url, { ...rest, signal: wrapped.signal });
  } finally {
    if (wrapped.clear) wrapped.clear();
  }
}

export async function fetchJson(url, options = {}) {
  const response = await request(url, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${shorten(url)}`);
  }
  return response.json();
}

export async function fetchText(url, options = {}) {
  const response = await request(url, {
    ...options,
    headers: { Accept: "text/plain, text/markdown, */*", ...(options.headers || {}) },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${shorten(url)}`);
  }
  return response.text();
}

/**
 * Download a binary payload. Calls onProgress({ loaded, total }) while streaming.
 * Falls back to the Cordova advanced-http plugin when fetch cannot read the body.
 */
export async function fetchBinary(url, onProgress, options = {}) {
  try {
    const response = await request(url, {
      ...options,
      headers: { Accept: "*/*", ...(options.headers || {}) },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const total = Number(response.headers.get("Content-Length")) || 0;

    if (response.body && typeof response.body.getReader === "function") {
      const reader = response.body.getReader();
      const chunks = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (onProgress) onProgress({ loaded, total });
      }
      const buffer = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }
      return buffer.buffer;
    }

    const buffer = await response.arrayBuffer();
    if (onProgress) onProgress({ loaded: buffer.byteLength, total });
    return buffer;
  } catch (error) {
    if (typeof window !== "undefined" && window.cordova?.plugin?.http) {
      return cordovaDownload(url, onProgress);
    }
    throw error;
  }
}

function cordovaDownload(url, onProgress) {
  return new Promise((resolve, reject) => {
    window.cordova.plugin.http.sendRequest(
      url,
      { method: "GET", responseType: "arraybuffer" },
      (response) => {
        const data = response.data;
        if (onProgress) onProgress({ loaded: data.byteLength || data.length, total: data.byteLength || data.length });
        resolve(data);
      },
      (error) => reject(new Error(error?.error || "Download failed")),
    );
  });
}

function shorten(url) {
  return url.length > 80 ? `${url.slice(0, 77)}...` : url;
}

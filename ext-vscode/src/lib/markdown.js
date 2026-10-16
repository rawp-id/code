import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({
  gfm: true,
  breaks: false,
  headerIds: false,
  mangle: false,
});

/**
 * Render Markdown to sanitized HTML. Relative image/link URLs are resolved
 * against `baseUrl` so README screenshots keep working.
 */
export function renderMarkdown(markdown, baseUrl = "") {
  if (!markdown) return "";
  let html;
  try {
    html = marked.parse(String(markdown));
  } catch {
    html = `<pre>${escapeHtml(markdown)}</pre>`;
  }
  if (baseUrl) html = resolveUrls(html, baseUrl);
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target", "rel"],
    ADD_TAGS: ["details", "summary"],
  });
}

function resolveUrls(html, baseUrl) {
  try {
    const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html");
    const root = doc.getElementById("root");
    const resolve = (value) => {
      try {
        return new URL(value, baseUrl).href;
      } catch {
        return value;
      }
    };
    for (const img of root.querySelectorAll("img[src]")) {
      const src = img.getAttribute("src");
      if (src && !/^(https?:|data:)/i.test(src)) img.setAttribute("src", resolve(src));
    }
    for (const a of root.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href");
      if (href && !/^(https?:|mailto:|#)/i.test(href)) a.setAttribute("href", resolve(href));
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
    return root.innerHTML;
  } catch {
    return html;
  }
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

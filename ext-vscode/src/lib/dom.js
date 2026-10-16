/**
 * Tiny DOM helper used across the plugin UI. Kept dependency free so the
 * bundle stays small and the plugin can be tested outside Acode.
 */

export function h(tag, props, ...children) {
  const el = document.createElement(tag);

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;

      if (key === "class" || key === "className") {
        el.className = value;
      } else if (key === "style" && typeof value === "object") {
        for (const [prop, val] of Object.entries(value)) {
          if (val !== null && val !== undefined) el.style[prop] = val;
        }
      } else if (key === "dataset" && typeof value === "object") {
        Object.assign(el.dataset, value);
      } else if (key === "html") {
        el.innerHTML = value;
      } else if (key === "text") {
        el.textContent = value;
      } else if (key.startsWith("on") && typeof value === "function") {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === "attrs" && typeof value === "object") {
        for (const [attr, val] of Object.entries(value)) {
          if (val === null || val === undefined || val === false) continue;
          el.setAttribute(attr, val === true ? "" : String(val));
        }
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }

  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function debounce(fn, wait = 300) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/** Format a number as 1.2k / 3.4M. */
export function formatCount(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/** Relative time such as "3 days ago". */
export function timeAgo(input) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const steps = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [30, "day"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  let value = seconds;
  for (const [factor, unit] of steps) {
    if (Math.abs(value) < factor) {
      const rounded = Math.floor(value);
      return `${rounded} ${unit}${Math.abs(rounded) === 1 ? "" : "s"} ago`;
    }
    value /= factor;
  }
  return "";
}

export function isHttp(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

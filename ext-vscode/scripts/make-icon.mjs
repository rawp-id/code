import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- PNG encoder ----------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- Drawing --------------------------------------------------------------
function draw(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b, a = 255]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const alpha = a / 255;
    rgba[i] = Math.round(rgba[i] * (1 - alpha) + r * alpha);
    rgba[i + 1] = Math.round(rgba[i + 1] * (1 - alpha) + g * alpha);
    rgba[i + 2] = Math.round(rgba[i + 2] * (1 - alpha) + b * alpha);
    rgba[i + 3] = 255;
  };

  const blue = [21, 101, 192];
  const white = [255, 255, 255];
  const orange = [255, 160, 0];
  const radius = size * 0.22;

  // background rounded square
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (insideRounded(x + 0.5, y + 0.5, radius, radius, size - radius, size - radius, radius)) {
        set(x, y, blue);
      }
    }
  }

  const stroke = (x0, y0, x1, y1, width, color) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = x0 + (x1 - x0) * t;
      const cy = y0 + (y1 - y0) * t;
      const r = width / 2;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy <= r * r) set(Math.round(cx + dx), Math.round(cy + dy), color);
        }
      }
    }
  };

  // shopping bag body
  roundRect(size, set, size * 0.27, size * 0.42, size * 0.73, size * 0.83, size * 0.06, white);
  // bag handle (ring, top half)
  const cx = size * 0.5;
  const cy = size * 0.44;
  const handleR = size * 0.15;
  const handleW = size * 0.055;
  for (let angle = Math.PI; angle <= Math.PI * 2; angle += 0.004) {
    const x = cx + Math.cos(angle) * handleR;
    const y = cy + Math.sin(angle) * handleR;
    for (let dy = -handleW; dy <= handleW; dy++) {
      for (let dx = -handleW; dx <= handleW; dx++) {
        if (dx * dx + dy * dy <= handleW * handleW) set(Math.round(x + dx), Math.round(y + dy), white);
      }
    }
  }

  // code chevron inside the bag
  stroke(size * 0.42, size * 0.55, size * 0.56, size * 0.635, size * 0.055, blue);
  stroke(size * 0.56, size * 0.635, size * 0.42, size * 0.72, size * 0.055, blue);
  // small accent dot
  for (let y = -size * 0.02; y <= size * 0.02; y++) {
    for (let x = -size * 0.02; x <= size * 0.02; x++) {
      if (x * x + y * y <= (size * 0.02) ** 2) {
        set(Math.round(size * 0.62 + x), Math.round(size * 0.635 + y), orange);
      }
    }
  }

  return rgba;
}

function roundRect(size, set, x0, y0, x1, y1, radius, color) {
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
      if (insideRounded(x + 0.5, y + 0.5, x0 + radius, y0 + radius, x1 - radius, y1 - radius, radius)) {
        set(x, y, color);
      }
    }
  }
}

function insideRounded(x, y, minX, minY, maxX, maxY, radius) {
  const cx = Math.min(Math.max(x, minX), maxX);
  const cy = Math.min(Math.max(y, minY), maxY);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

// ---- Output ---------------------------------------------------------------
const big = encodePng(256, 256, draw(256));
fs.writeFileSync(path.join(root, "icon.png"), big);
console.log(`icon.png written (${(big.length / 1024).toFixed(1)} KB)`);

const small = encodePng(64, 64, draw(64));
console.log("FALLBACK_ICON_BASE64=" + small.toString("base64"));

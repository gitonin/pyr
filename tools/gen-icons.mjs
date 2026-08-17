#!/usr/bin/env node
/**
 * Renders the PWA PNG icons without any dependency: the artwork is rasterised
 * here and written through zlib as a minimal PNG. Run `npm run icons` after
 * changing assets/icons/icon.svg so the raster versions stay in sync.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/icons');

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Signed distance from p to segment ab, in normalised units. */
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy));
  return Math.hypot(wx - vx * t, wy - vy * t);
}

function inTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const TOP = [[0.266, 0.227], [0.734, 0.227], [0.5, 0.5]];
  const BOT = [[0.5, 0.5], [0.734, 0.773], [0.266, 0.773]];
  const edges = [
    [...TOP[0], ...TOP[1]], [...TOP[1], ...TOP[2]], [...TOP[2], ...TOP[0]],
    [...BOT[0], ...BOT[1]], [...BOT[1], ...BOT[2]], [...BOT[2], ...BOT[0]],
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;

      // Night background with a soft blue core.
      const r = Math.hypot(u - 0.5, v - 0.46);
      let col = mix([0.043, 0.165, 0.29], [0.012, 0.027, 0.059], clamp01(r / 0.62));

      // Distant red neon on the horizon.
      const neon = Math.exp(-Math.abs(v - 0.5) * 90) * Math.exp(-Math.abs(u - 0.5) * 2.2);
      col = [col[0] + neon * 0.85, col[1] + neon * 0.1, col[2] + neon * 0.09];

      // Glass bodies.
      if (inTriangle(u, v, ...TOP)) {
        const depth = clamp01((v - 0.227) / 0.273);
        col = mix(col, [0.35, 0.78, 0.95], 0.16 + depth * 0.22);
        if (depth > 0.4) col = mix(col, [0.02, 0.05, 0.12], (depth - 0.4) * 1.1); // sand
      }
      if (inTriangle(u, v, ...BOT)) {
        const depth = clamp01((v - 0.5) / 0.273);
        col = mix(col, [0.3, 0.72, 0.92], 0.14 + (1 - depth) * 0.2);
        if (depth > 0.55) col = mix(col, [0.02, 0.05, 0.12], (depth - 0.55) * 1.4);
      }

      // Luminous edges.
      let d = 1;
      for (const e of edges) d = Math.min(d, segDist(u, v, e[0], e[1], e[2], e[3]));
      const line = Math.exp(-d * 420 / 1) * 1.0 + Math.exp(-d * 45) * 0.32;
      col = [col[0] + line * 0.5, col[1] + line * 0.95, col[2] + line * 1.0];

      // Ground reflection.
      const refl = Math.exp(-Math.abs(v - 0.845) * 26) * Math.exp(-Math.abs(u - 0.5) * 4.5);
      col = [col[0] + refl * 0.06, col[1] + refl * 0.3, col[2] + refl * 0.38];

      const i = (y * size + x) * 4;
      buf[i] = Math.round(clamp01(col[0]) * 255);
      buf[i + 1] = Math.round(clamp01(col[1]) * 255);
      buf[i + 2] = Math.round(clamp01(col[2]) * 255);
      buf[i + 3] = 255;
    }
  }
  return buf;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  const file = resolve(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, png(size, size, render(size)));
  console.log(`wrote ${file}`);
}

#!/usr/bin/env node
/**
 * The site's favicon, drawn from code: public/favicon.svg and public/favicon.ico (32×32) from one description, so the
 * two cannot drift. It is the app icon's idea (apps/ios/scripts/app-icon.py) at tab size: a table of two by two cells
 * on the app's deep teal, one cell lit amber. The icon's airliner is left out; at 16 or 32 pixels it would be a smudge.
 * Original artwork, with no airline, alliance, loyalty-program or seats.aero mark.
 *
 * The SVG is plain shapes (no script, no external reference). The ICO holds one 32×32 image as a 32-bit BMP with an
 * alpha channel, which every browser that asks for /favicon.ico reads; it is rasterized here, 8×8 samples a pixel,
 * with no dependency. Node built-ins only, no network.
 *
 *   node sites/landing/scripts/favicon.mjs           writes both files into sites/landing/public/
 *   node sites/landing/scripts/favicon.mjs --check   exits 1 if the committed files differ from what this draws
 *
 * sites/landing/test/crawl.test.ts runs the check.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

/** The drawing, in a 32×32 box. Colours are the app icon's (app-icon.py: background gradient, AMBER). */
export const ICON = {
  size: 32,
  radius: 7,
  top: "#0A8A94",
  bottom: "#00393F",
  cell: 12,
  gap: 2,
  cellRadius: 2.5,
  dim: { color: "#FFFFFF", opacity: 0.22 },
  lit: "#FFC857",
};

/** The four cells as [x, y, lit], the top-right one lit, as in the app icon. */
function cells(icon = ICON) {
  const x0 = (icon.size - (2 * icon.cell + icon.gap)) / 2;
  const at = (i) => x0 + i * (icon.cell + icon.gap);
  return [
    [at(0), at(0), false],
    [at(1), at(0), true],
    [at(0), at(1), false],
    [at(1), at(1), false],
  ];
}

export function faviconSvg(icon = ICON) {
  const rect = (x, y, extra) => `<rect x="${x}" y="${y}" width="${icon.cell}" height="${icon.cell}" rx="${icon.cellRadius}"${extra}/>`;
  const dim = cells(icon).filter(([, , lit]) => !lit);
  const [lx, ly] = cells(icon).find(([, , lit]) => lit);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.size} ${icon.size}" width="${icon.size}" height="${icon.size}">`,
    `  <defs>`,
    `    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">`,
    `      <stop offset="0" stop-color="${icon.top}"/>`,
    `      <stop offset="1" stop-color="${icon.bottom}"/>`,
    `    </linearGradient>`,
    `  </defs>`,
    `  <rect width="${icon.size}" height="${icon.size}" rx="${icon.radius}" fill="url(#bg)"/>`,
    `  <g fill="${icon.dim.color}" fill-opacity="${icon.dim.opacity}">`,
    ...dim.map(([x, y]) => `    ${rect(x, y, "")}`),
    `  </g>`,
    `  ${rect(lx, ly, ` fill="${icon.lit}"`)}`,
    `</svg>`,
    "",
  ].join("\n");
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Is (px, py) inside the rounded rectangle? */
function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/** RGBA pixels, row by row from the top, straight (not premultiplied) alpha. */
export function rasterize(icon = ICON, samples = 8) {
  const n = icon.size;
  const top = rgb(icon.top);
  const bottom = rgb(icon.bottom);
  const white = rgb(icon.dim.color);
  const amber = rgb(icon.lit);
  const all = cells(icon);
  const out = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // Premultiplied sums over the samples, then back to straight alpha.
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          if (!inRoundRect(px, py, 0, 0, n, n, icon.radius)) continue;
          const t = py / n;
          let c = top.map((v, i) => v + (bottom[i] - v) * t);
          for (const [cx, cy, lit] of all) {
            if (!inRoundRect(px, py, cx, cy, icon.cell, icon.cell, icon.cellRadius)) continue;
            c = lit ? amber : c.map((v, i) => v + (white[i] - v) * icon.dim.opacity);
          }
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const o = (y * n + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round((255 * a) / (samples * samples));
    }
  }
  return out;
}

/** An ICO file holding one 32-bit BMP image (BITMAPINFOHEADER, bottom-up BGRA, then the 1-bit AND mask). */
export function faviconIco(icon = ICON) {
  const n = icon.size;
  const pixels = rasterize(icon);
  const maskRow = Math.ceil(n / 32) * 4;
  const imageSize = 40 + n * n * 4 + maskRow * n;
  const buf = Buffer.alloc(6 + 16 + imageSize);
  buf.writeUInt16LE(0, 0); // reserved
  buf.writeUInt16LE(1, 2); // type: icon
  buf.writeUInt16LE(1, 4); // one image
  buf.writeUInt8(n, 6); // width
  buf.writeUInt8(n, 7); // height
  buf.writeUInt8(0, 8); // no palette
  buf.writeUInt8(0, 9); // reserved
  buf.writeUInt16LE(1, 10); // colour planes
  buf.writeUInt16LE(32, 12); // bits per pixel
  buf.writeUInt32LE(imageSize, 14);
  buf.writeUInt32LE(22, 18); // offset of the image
  let o = 22;
  buf.writeUInt32LE(40, o); // BITMAPINFOHEADER
  buf.writeInt32LE(n, o + 4);
  buf.writeInt32LE(n * 2, o + 8); // colour rows and mask rows
  buf.writeUInt16LE(1, o + 12);
  buf.writeUInt16LE(32, o + 14);
  buf.writeUInt32LE(0, o + 16); // BI_RGB
  buf.writeUInt32LE(n * n * 4 + maskRow * n, o + 20);
  o += 40;
  for (let y = n - 1; y >= 0; y--) {
    for (let x = 0; x < n; x++) {
      const p = (y * n + x) * 4;
      buf[o++] = pixels[p + 2];
      buf[o++] = pixels[p + 1];
      buf[o++] = pixels[p];
      buf[o++] = pixels[p + 3];
    }
  }
  for (let y = n - 1; y >= 0; y--) {
    for (let x = 0; x < n; x++) if (pixels[(y * n + x) * 4 + 3] === 0) buf[o + (x >> 3)] |= 0x80 >> (x & 7);
    o += maskRow;
  }
  return buf;
}

export const FILES = { "favicon.svg": () => Buffer.from(faviconSvg(), "utf8"), "favicon.ico": () => faviconIco() };

/** The files in `dir` that differ from what this script draws. */
export function stale(dir = PUBLIC) {
  return Object.entries(FILES)
    .filter(([name, draw]) => {
      try {
        return !readFileSync(path.join(dir, name)).equals(draw());
      } catch {
        return true;
      }
    })
    .map(([name]) => name);
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes("--check")) {
    const differ = stale();
    if (differ.length) {
      console.error(`${differ.join(", ")} differ from what sites/landing/scripts/favicon.mjs draws; run it and commit the result`);
      process.exitCode = 1;
    } else console.log("favicon.svg and favicon.ico match the drawing");
    return;
  }
  for (const [name, draw] of Object.entries(FILES)) {
    writeFileSync(path.join(PUBLIC, name), draw());
    console.log(`wrote ${path.join(PUBLIC, name)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

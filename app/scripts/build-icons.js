#!/usr/bin/env node
/* ============================================================================
   Build the Valmont Data icon set from lib/brandmark.js (gold constellation
   hexagon):
     favicon-16.png · favicon-32.png   → TRANSPARENT background (browser favicon)
     favicon.ico (16+32 embedded PNG)  → transparent
     apple-touch-icon.png (180)        → navy background (iOS fills transparent
                                         with black — keep the brand navy)
     icon-192.png · icon-512.png       → navy background (PWA install icons)

   Zero-dependency (node + built-in zlib). Renders procedurally with heavy
   supersampling for crisp edges. Dot/line weights are size-adaptive so the
   mark stays readable at 16–32px. Geometry comes from lib/brandmark.js —
   same source as the SVG logo, so they can never drift. Run after editing:
     node scripts/build-icons.js
   ============================================================================ */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { constellation, hasGlow, glowAmp, GOLD_RGB, NAVY_RGB, markSVG, BRAND_OPTS } = require("../lib/brandmark");

const OUT = path.join(__dirname, "..", "assets", "img");
const RADIUS_FRAC = 0.35; // mark fills ~70% of the frame, even margins

/* Size-adaptive parameters: small favicons need relatively thicker lines and
   fewer, larger dots to stay readable; large icons use the spec defaults.
   All sizes inherit the canonical brand treatment (BRAND_OPTS — V2 outline). */
function paramsFor(size) {
  const base = { ...BRAND_OPTS };
  if (size <= 16) {
    return { ...base, interiorCount: 8, cornerRFrac: 0.17, sizePool: [0.15, 0.115, 0.09], lineWFrac: 0.12 };
  }
  if (size <= 32) {
    return { ...base, interiorCount: 12, cornerRFrac: 0.17, sizePool: [0.14, 0.11, 0.085], lineWFrac: 0.09 };
  }
  return { ...base, interiorCount: 18, cornerRFrac: 0.16, sizePool: [0.13, 0.105, 0.075], lineWFrac: 0.038 };
}

/* ---------------- renderer ---------------- */
function render(size, { transparent = false } = {}) {
  const R = size * RADIUS_FRAC;
  const cx = size / 2, cy = size / 2;
  const p = paramsFor(size);
  const geom = constellation({ cx, cy, R, interiorCount: p.interiorCount, cornerRFrac: p.cornerRFrac, sizePool: p.sizePool });
  const dots = geom.dots;
  const edges = geom.edges;
  const lw = R * p.lineWFrac;

  // hexagon outline (perimeter through the 6 corner dots) when brand opts request it
  let outlineLines = [];
  if (p.outline) {
    const ow = R * p.outlineWFrac;
    for (let k = 0; k < 6; k++) {
      const a = dots[k], b = dots[(k + 1) % 6];
      const hw = ow / 2;
      outlineLines.push({ p1: a, p2: b, hw, x0: Math.min(a.x, b.x) - hw, x1: Math.max(a.x, b.x) + hw, y0: Math.min(a.y, b.y) - hw, y1: Math.max(a.y, b.y) + hw, alpha: 0.9 });
    }
  }

  const dotBB = dots.map((d) => ({ x0: d.x - d.r, x1: d.x + d.r, y0: d.y - d.r, y1: d.y + d.r }));
  const glowBB = dots.map((d) => {
    const gr = d.r * 3;
    return { x0: d.x - gr, x1: d.x + gr, y0: d.y - gr, y1: d.y + gr, amp: glowAmp(d, R, p.glowMul), gr, gx: d.x, gy: d.y };
  });
  const lineBB = edges.map(([a, b]) => {
    const p1 = dots[a], p2 = dots[b];
    const hw = lw / 2;
    return { p1, p2, hw, x0: Math.min(p1.x, p2.x) - hw, x1: Math.max(p1.x, p2.x) + hw, y0: Math.min(p1.y, p2.y) - hw, y1: Math.max(p1.y, p2.y) + hw };
  });

  const segDist = (px, py, p1, p2) => {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - p1.x) * dx + (py - p1.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (p1.x + t * dx), py - (p1.y + t * dy));
  };

  // heavy supersampling for crisp edges (cap for speed)
  const S = Math.max(3, Math.min(8, Math.ceil(600 / size)));
  const px = Buffer.alloc(size * size * 4);
  const n = S * S;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rAcc = 0, gAcc = 0, bAcc = 0, aAcc = 0;

      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const ux = x + (sx + 0.5) / S;
          const uy = y + (sy + 0.5) / S;

          let r, g, b, a;
          if (transparent) { r = 0; g = 0; b = 0; a = 0; }
          else { r = NAVY_RGB[0]; g = NAVY_RGB[1]; b = NAVY_RGB[2]; a = 1; }

          const blend = (cr, cg, cb, aa) => {
            if (aa <= 0) return;
            r = cr * aa + r * (1 - aa);
            g = cg * aa + g * (1 - aa);
            b = cb * aa + b * (1 - aa);
            a = aa + a * (1 - aa);
          };

          // glow on larger dots (under everything)
          for (let i = 0; i < glowBB.length; i++) {
            const gb = glowBB[i];
            if (ux < gb.x0 || ux > gb.x1 || uy < gb.y0 || uy > gb.y1) continue;
            const d = Math.hypot(ux - gb.gx, uy - gb.gy);
            if (d >= gb.gr) continue;
            const t = 1 - d / gb.gr;
            blend(GOLD_RGB[0], GOLD_RGB[1], GOLD_RGB[2], gb.amp * t * t);
          }

          // thin gold lines
          for (let i = 0; i < lineBB.length; i++) {
            const lb = lineBB[i];
            if (ux < lb.x0 || ux > lb.x1 || uy < lb.y0 || uy > lb.y1) continue;
            if (segDist(ux, uy, lb.p1, lb.p2) <= lb.hw) blend(GOLD_RGB[0], GOLD_RGB[1], GOLD_RGB[2], 1);
          }

          // hexagon outline (slightly transparent)
          for (let i = 0; i < outlineLines.length; i++) {
            const lb = outlineLines[i];
            if (ux < lb.x0 || ux > lb.x1 || uy < lb.y0 || uy > lb.y1) continue;
            if (segDist(ux, uy, lb.p1, lb.p2) <= lb.hw) blend(GOLD_RGB[0], GOLD_RGB[1], GOLD_RGB[2], lb.alpha);
          }

          // dots
          for (let i = 0; i < dots.length; i++) {
            const bb = dotBB[i];
            if (ux < bb.x0 || ux > bb.x1 || uy < bb.y0 || uy > bb.y1) continue;
            if (Math.hypot(ux - dots[i].x, uy - dots[i].y) <= dots[i].r) blend(GOLD_RGB[0], GOLD_RGB[1], GOLD_RGB[2], 1);
          }

          rAcc += r; gAcc += g; bAcc += b; aAcc += a;
        }
      }

      const i = (y * size + x) * 4;
      px[i] = Math.round(rAcc / n);
      px[i + 1] = Math.round(gAcc / n);
      px[i + 2] = Math.round(bAcc / n);
      px[i + 3] = Math.round((aAcc / n) * 255);
    }
  }
  return px;
}

/* ---------------- PNG encoder (RGBA, filter 0) ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------- ICO container (embedded PNGs) ---------------- */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const img of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(img.w === 256 ? 0 : img.w, 0);
    e.writeUInt8(img.h === 256 ? 0 : img.h, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

/* ---------------- main ---------------- */
const TRANSPARENT_PNGS = [
  ["favicon-16.png", 16],
  ["favicon-32.png", 32],
];
const NAVY_PNGS = [
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
];

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const icoParts = [];

  for (const [name, size] of TRANSPARENT_PNGS) {
    const png = encodePng(size, render(size, { transparent: true }));
    fs.writeFileSync(path.join(OUT, name), png);
    console.log(`${name.padEnd(22)} ${size}x${size} transparent ${(png.length / 1024).toFixed(1)} KB`);
    icoParts.push({ w: size, h: size, data: png });
  }
  for (const [name, size] of NAVY_PNGS) {
    const png = encodePng(size, render(size, { transparent: false }));
    fs.writeFileSync(path.join(OUT, name), png);
    console.log(`${name.padEnd(22)} ${size}x${size} navy       ${(png.length / 1024).toFixed(1)} KB`);
  }

  fs.writeFileSync(path.join(OUT, "favicon.ico"), encodeIco(icoParts));
  console.log("favicon.ico               16+32 transparent PNGs");

  // vector marks — transparent background (site header + favicon), brand opts
  const mark = markSVG({ size: 512, bg: false, ...BRAND_OPTS });
  fs.writeFileSync(path.join(OUT, "favicon.svg"), mark);
  fs.writeFileSync(path.join(OUT, "logo.svg"), mark);
  console.log("favicon.svg + logo.svg    transparent vector marks");

  // root favicon.ico fallback
  fs.copyFileSync(path.join(OUT, "favicon.ico"), path.join(__dirname, "..", "favicon.ico"));
  console.log("favicon.ico               copied to app/favicon.ico");

  console.log("\nDone. Icons written to", OUT);
}

module.exports = { render, encodePng, encodeIco, paramsFor, RADIUS_FRAC };

if (require.main === module) main();

/* ============================================================================
   Brand mark — gold constellation hexagon + VALMONT DATA wordmark.

   One source of truth for the brand assets:
     - scripts/build-icons.js   → favicon/PNG set (procedural renderer)
     - assets/img/logo.svg      → vector mark for the header
     - logo-banner.svg/.png     → 3:1 banner (wordmark text; PNG rasterized
                                  separately with a geometric sans font)

   Design (per brand spec):
     - solid deep navy #0A1830 background
     - gold #D4AF37 hexagon with one vertex pointing straight up, built as a
       constellation mesh: 6 corner dots (largest) + ~18 interior dots of
       mixed sizes, connected by thin gold lines forming an irregular
       triangulated network (true Delaunay triangulation), subtle warm glow
       on the larger dots.
     - banner wordmark: "VALMONT" in gold, "DATA" in solid white, one line,
       widely spaced uppercase geometric sans-serif.

   Zero dependencies. Deterministic (seeded PRNG) — same seed, same mark.
   ============================================================================ */

const GOLD = "#D4AF37";
const NAVY = "#0A1830";
const WHITE = "#FFFFFF";
const GOLD_RGB = [212, 175, 55];
const NAVY_RGB = [10, 24, 48];

const DEFAULT_SEED = 20260807;

/* Canonical brand treatment — the chosen V2 (OUTLINE) variant:
   seed 20260807 · thin gold hexagon outline · softer glow. */
const BRAND_OPTS = {
  seed: DEFAULT_SEED,
  outline: true,
  outlineWFrac: 0.022,
  glowMul: 0.8,
};

/* ---------------- deterministic PRNG ---------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- hexagon geometry (vertex pointing straight up) ---------------- */
function hexVertices(cx, cy, R) {
  const v = [];
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 3;
    v.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  return v;
}

function insideHex(x, y, cx, cy, R) {
  const v = hexVertices(cx, cy, R);
  for (let k = 0; k < 6; k++) {
    const ax = v[k][0], ay = v[k][1];
    const bx = v[(k + 1) % 6][0], by = v[(k + 1) % 6][1];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross < 0) return false; // clockwise winding
  }
  return true;
}

/* ---------------- Delaunay triangulation (Bowyer-Watson) ---------------- */
function delaunayEdges(pts) {
  const n = pts.length;
  if (n < 3) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const dmax = Math.max(maxX - minX, maxY - minY) || 1;
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  const superT = [
    [midX - 20 * dmax, midY - dmax],
    [midX, midY + 20 * dmax],
    [midX + 20 * dmax, midY - dmax],
  ];
  const all = pts.concat(superT);

  function circum(i, j, k) {
    const [ax, ay] = all[i], [bx, by] = all[j], [cx2, cy2] = all[k];
    const d = 2 * (ax * (by - cy2) + bx * (cy2 - ay) + cx2 * (ay - by));
    if (Math.abs(d) < 1e-12) return null;
    const ux = ((ax * ax + ay * ay) * (by - cy2) + (bx * bx + by * by) * (cy2 - ay) + (cx2 * cx2 + cy2 * cy2) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx2 - bx) + (bx * bx + by * by) * (ax - cx2) + (cx2 * cx2 + cy2 * cy2) * (bx - ax)) / d;
    return { x: ux, y: uy, r: Math.hypot(ux - ax, uy - ay) };
  }

  let tris = [{ v: [n, n + 1, n + 2] }];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const bad = [];
    for (const t of tris) {
      const c = circum(t.v[0], t.v[1], t.v[2]);
      if (!c || Math.hypot(p[0] - c.x, p[1] - c.y) <= c.r + 1e-9) bad.push(t);
    }
    const edgeCount = new Map();
    for (const t of bad) {
      for (let k = 0; k < 3; k++) {
        const a = t.v[k], b = t.v[(k + 1) % 3];
        const key = a < b ? a + ":" + b : b + ":" + a;
        edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
      }
    }
    const boundary = [];
    for (const [key, count] of edgeCount) if (count === 1) boundary.push(key.split(":").map(Number));
    tris = tris.filter((t) => !bad.includes(t));
    for (const [a, b] of boundary) tris.push({ v: [i, a, b] });
  }

  const edges = new Set();
  for (const t of tris) {
    if (t.v.some((v) => v >= n)) continue; // drop super-triangle slivers
    for (let k = 0; k < 3; k++) {
      const a = t.v[k], b = t.v[(k + 1) % 3];
      edges.add(a < b ? a + ":" + b : b + ":" + a);
    }
  }
  return [...edges].map((k) => k.split(":").map(Number));
}

/* ---------------- constellation ---------------- */
/* Returns { dots: [{x,y,r,corner}], edges: [[i,j],...] } in absolute coords.
   Variants: cornerRFrac = corner-dot radius / R; sizePool = interior dot
   radius fractions (randomized per dot); interiorCount = # interior dots. */
function constellation({
  cx = 0, cy = 0, R = 100, seed = DEFAULT_SEED, interiorCount = 18,
  cornerRFrac = 0.16, sizePool = [0.13, 0.105, 0.075],
} = {}) {
  const rng = mulberry32(seed);
  const dots = [];
  for (const [x, y] of hexVertices(cx, cy, R)) {
    dots.push({ x, y, r: R * cornerRFrac, corner: true });
  }

  const minCorner = R * cornerRFrac * 1.6, minDot = R * 0.155;
  let tries = 0;
  while (dots.length - 6 < interiorCount && tries < 6000) {
    tries++;
    const x = cx + (rng() * 2 - 1) * R * 1.15;
    const y = cy + (rng() * 2 - 1) * R * 1.15;
    if (!insideHex(x, y, cx, cy, R)) continue;
    if (dots.some((d) => Math.hypot(d.x - x, d.y - y) < (d.corner ? minCorner : minDot))) continue;
    dots.push({ x, y, r: 0, corner: false });
  }

  const sizes = sizePool.map((fr) => R * fr);
  while (sizes.length < interiorCount) sizes.push(R * sizePool[sizePool.length - 1]);
  for (let i = sizes.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [sizes[i], sizes[j]] = [sizes[j], sizes[i]];
  }
  let idx = 0;
  for (const d of dots) if (!d.corner) d.r = sizes[idx++];

  const edges = delaunayEdges(dots.map((d) => [d.x, d.y]));
  const edgeSet = new Set();
  const out = [];
  const addEdge = (a, b) => {
    const key = a < b ? a + ":" + b : b + ":" + a;
    if (!edgeSet.has(key)) { edgeSet.add(key); out.push([a, b]); }
  };
  for (const [a, b] of edges) addEdge(a, b);
  for (let k = 0; k < 6; k++) addEdge(k, (k + 1) % 6); // hexagon perimeter

  return { dots, edges: out };
}

/* Glow on larger dots only (spec: subtle warm glow on the larger dots) */
function hasGlow(dot, R) {
  return dot.r >= R * 0.10;
}

function glowAmp(dot, R, glowMul = 1) {
  return Math.min(0.5, (0.22 + (dot.r / R) * 1.8) * glowMul);
}

/* ---------------- shared mark body (glow + lines + dots) ---------------- */
/* Options: R, idPrefix, lineWFrac, glowMul, outline (hexagon stroke), outlineWFrac */
function markBody(geom, { R, idPrefix = "g", lineWFrac = 0.038, glowMul = 1, outline = false, outlineWFrac = 0.02 } = {}) {
  const f = (v) => Math.round(v * 100) / 100;
  const glowRadii = [...new Set(geom.dots.filter((d) => hasGlow(d, R)).map((d) => d.r))];
  const defs = glowRadii.map((r, i) =>
    `<radialGradient id="${idPrefix}${i}" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0%" stop-color="${GOLD}" stop-opacity="${(0.50 * Math.min(1, glowMul)).toFixed(2)}"/>` +
    `<stop offset="45%" stop-color="${GOLD}" stop-opacity="${(0.20 * Math.min(1, glowMul)).toFixed(2)}"/>` +
    `<stop offset="100%" stop-color="${GOLD}" stop-opacity="0"/>` +
    `</radialGradient>`
  ).join("");
  const glowByR = new Map(glowRadii.map((r, i) => [r, `url(#${idPrefix}${i})`]));

  let body = "";
  for (const d of geom.dots) {
    if (glowByR.has(d.r)) body += `<circle cx="${f(d.x)}" cy="${f(d.y)}" r="${f(d.r * 3)}" fill="${glowByR.get(d.r)}"/>`;
  }
  const lw = f(R * lineWFrac);
  for (const [a, b] of geom.edges) {
    body += `<line x1="${f(geom.dots[a].x)}" y1="${f(geom.dots[a].y)}" x2="${f(geom.dots[b].x)}" y2="${f(geom.dots[b].y)}" stroke="${GOLD}" stroke-width="${lw}" stroke-linecap="round"/>`;
  }
  if (outline) {
    // hexagon perimeter path from the 6 corner dots
    const pts = geom.dots.slice(0, 6).map((d) => `${f(d.x)},${f(d.y)}`);
    body += `<polygon points="${pts.join(" ")}" fill="none" stroke="${GOLD}" stroke-width="${f(R * outlineWFrac)}" stroke-linejoin="round" opacity="0.9"/>`;
  }
  for (const d of geom.dots) {
    body += `<circle cx="${f(d.x)}" cy="${f(d.y)}" r="${f(d.r)}" fill="${GOLD}"/>`;
  }
  return { defs, body };
}

/* ---------------- square mark SVG (favicon / header logo, no text) ----------------
   bg=false → transparent background (gold constellation on its own). */
function markSVG({
  size = 512, radiusFrac = 0.35, seed = DEFAULT_SEED, interiorCount = 18,
  cornerRFrac = 0.16, sizePool, lineWFrac = 0.038, glowMul = 1, outline = false, outlineWFrac = 0.02,
  bg = true,
} = {}) {
  const R = size * radiusFrac;
  const geom = constellation({
    cx: size / 2, cy: size / 2, R, seed, interiorCount,
    cornerRFrac, sizePool: sizePool || [0.13, 0.105, 0.075],
  });
  const { defs, body } = markBody(geom, { R, idPrefix: "g", lineWFrac, glowMul, outline, outlineWFrac });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Valmont Data constellation mark">
  ${bg ? `<rect width="${size}" height="${size}" fill="${NAVY}"/>` : ""}
  <defs>${defs}</defs>
  ${body}
</svg>`;
}

/* ---------------- wide banner SVG (mark + wordmark) ----------------
   bg=false → transparent background (no navy rect). */
function bannerSVG({
  width = 1800, seed = DEFAULT_SEED, interiorCount = 18,
  cornerRFrac = 0.16, sizePool, lineWFrac = 0.038, glowMul = 1, outline = false, outlineWFrac = 0.02,
  valmontColor = GOLD, dataColor = WHITE, fontSizeFrac = 0.193, lsFrac = 0.224,
  bg = true,
} = {}) {
  const height = Math.round(width / 3);
  const cx = Math.round(width * 0.167); // mark centre, left third
  const cy = Math.round(height / 2);
  const R = Math.round(height * 0.35);  // top vertex ~ (height - 2R)/2 below the top edge
  const geom = constellation({
    cx, cy, R, seed, interiorCount, cornerRFrac, sizePool: sizePool || [0.13, 0.105, 0.075],
  });
  const { defs, body } = markBody(geom, { R, idPrefix: "b", lineWFrac, glowMul, outline, outlineWFrac });

  const fontSize = Math.round(height * fontSizeFrac);
  const ls = Math.round(fontSize * lsFrac);
  const textX = Math.round(cx + R + 25);
  const textY = Math.round(cy + fontSize * 0.36); // optical vertical centre of caps

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Valmont Data">
  ${bg ? `<rect width="${width}" height="${height}" fill="${NAVY}"/>` : ""}
  <defs>${defs}</defs>
  ${body}
  <text x="${textX}" y="${textY}" font-family="'Montserrat','Avenir','Segoe UI','Century Gothic',sans-serif" font-weight="700" font-size="${fontSize}" letter-spacing="${ls}" fill="${valmontColor}">VALMONT<tspan fill="${dataColor}"> DATA</tspan></text>
</svg>`;
}

module.exports = {
  GOLD, NAVY, WHITE, GOLD_RGB, NAVY_RGB, DEFAULT_SEED, BRAND_OPTS,
  constellation, delaunayEdges, hexVertices, insideHex,
  hasGlow, glowAmp, markBody, markSVG, bannerSVG,
};

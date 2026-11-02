// Procedural world generation for Aleria / Kremantin.
// Pipeline: mesh (jittered points -> Voronoi) -> heightmap -> regions & climate ->
// hydrology (pit fill, lakes, flux, rivers) -> biomes -> population (settlements,
// states, faith, races, threats, mana, roads, labels).
import { makeRng, makeNoise2D, fbm, ridged, clamp, smoothstep, MinHeap } from './rng.js';
import { BIOMES, B } from './biomes.js';
import { NameGen } from './names.js';

/** Lore regions of Kremantin. Anchors are fractions of map width/height. */
export const LORE_REGIONS = [
  { key: 'elysandria', name: 'Kingdom of Elysandria', ax: 0.49, ay: 0.50, s: 0.20, bias: 1.2, t: 0.55, m: 0.55,
    notes: 'Fertile plains, ancient forests and rugged mountain ranges. Seat of Queen Elisabeth Bernt Ravenshield III and of the Church of Ucliat; historical hero-summoning site.' },
  { key: 'menfor', name: 'Menfor', ax: 0.40, ay: 0.14, s: 0.15, bias: 1, t: 0.17, m: 0.2, notes: 'Harsh northern wastes. Cold, barren, dangerous.' },
  { key: 'frozen', name: 'The Frozen Lands', ax: 0.80, ay: 0.15, s: 0.14, bias: 1, t: -0.14, m: 0.45, notes: 'Frozen lands of the north-east: glaciers, ice fields and snowbound peaks.' },
  { key: 'jungle', name: 'The Southern Jungles', ax: 0.38, ay: 0.87, s: 0.15, bias: 1, t: 0.97, m: 0.86, notes: 'Wild southern jungles, hot, wet and largely untamed.' },
  { key: 'storm', name: 'The Storm-Shrouded Reach', ax: 0.80, ay: 0.80, s: 0.14, bias: 1, t: 0.62, m: 0.88, notes: 'A storm-shrouded region in the south-east. Few maps of it agree with one another.' },
  { key: 'shadowW', name: 'The Shadowed West', ax: 0.13, ay: 0.50, s: 0.11, bias: 1, t: 0.45, m: 0.45, notes: 'Unexplored, shadowed lands. Rumours only.' },
  { key: 'shadowE', name: 'The Unmapped East', ax: 0.89, ay: 0.46, s: 0.09, bias: 1, t: 0.45, m: 0.5, notes: 'Beyond the last surveyed coast. Unexplored.' },
];
export const REGION_NONE = 255;

export const RELIGIONS_DEFAULT = [
  { id: 0, name: 'Unknown / none', color: '#6f6a60', notes: '' },
  { id: 1, name: 'Church of Ucliat', color: '#e3bd4f', notes: 'Dominant faith of Elysandria. Church Knights: silver chains, sword-crossed sun medallions, halo headpieces.' },
  { id: 2, name: 'Crimson Sun Order', color: '#b3261e', notes: 'Hidden / experimental order. Its sites are secret laboratories.' },
  { id: 3, name: 'Old Ways (folk & clan faiths)', color: '#5f8f5a', notes: '' },
  { id: 4, name: 'Spirit Cults', color: '#7b5ea7', notes: '' },
];
export const RACES_DEFAULT = [
  { id: 0, name: 'Unknown', color: '#5a5a5a', notes: '' },
  { id: 1, name: 'Humans', color: '#d9a441', notes: '' },
  { id: 2, name: 'Beastfolk (lion-like)', color: '#c8662b', notes: '' },
  { id: 3, name: 'Short folk', color: '#6b8e23', notes: '' },
  { id: 4, name: 'Rih-Fugh (horned, third-eye)', color: '#8e44ad', notes: '' },
  { id: 5, name: 'Tenebrim', color: '#3d5566', notes: '' },
  { id: 6, name: 'Narelith', color: '#16a085', notes: '' },
];

export const DEFAULT_SETTINGS = {
  seed: 'kremantin', lore: true, size: '1600x1000', cells: 8000, shape: 'continent',
  land: 0.48, mountains: 0.6, roughness: 0.5, temp: 0, moist: 0, rivers: 0.5, settlements: 0.5, states: 6, customNames: '',
};

const CELL_ARRAYS = { h: Float32Array, t0: Float32Array, m0: Float32Array, biome: Uint8Array, lock: Uint8Array, region: Uint8Array, state: Int16Array, religion: Uint8Array, race: Uint8Array, mana: Float32Array, known: Float32Array, threat: Float32Array, lake: Uint8Array };
export const SAVED_CELL_KEYS = Object.keys(CELL_ARRAYS);

// ---------------------------------------------------------------- mesh
/** Build the Voronoi mesh from a seed. Deterministic: same seed/size/count -> same mesh. */
export function buildMesh(seed, W, H, count) {
  const d3 = window.d3;
  const rng = makeRng(seed + '|mesh');
  const cols = Math.max(4, Math.round(Math.sqrt((count * W) / H))), rows = Math.max(4, Math.round(count / cols));
  const sx = W / cols, sy = H / rows, n = cols * rows;
  const coords = new Float64Array(n * 2);
  let k = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    coords[k++] = (c + 0.5 + (rng() - 0.5) * 0.9) * sx;
    coords[k++] = (r + 0.5 + (rng() - 0.5) * 0.9) * sy;
  }
  const delaunay = new d3.Delaunay(coords);
  const vor = delaunay.voronoi([0, 0, W, H]);
  const px = new Float32Array(n), py = new Float32Array(n), polys = new Array(n), border = new Uint8Array(n);
  const emap = new Map();
  const key = (p) => Math.round(p[0] * 1000) + ',' + Math.round(p[1] * 1000);
  const tmpEdges = [];
  for (let i = 0; i < n; i++) {
    px[i] = coords[2 * i]; py[i] = coords[2 * i + 1];
    const poly = vor.cellPolygon(i);
    if (!poly) { polys[i] = new Float32Array([px[i], py[i]]); continue; }
    const m = poly.length - 1, flat = new Float32Array(m * 2);
    for (let j = 0; j < m; j++) {
      flat[2 * j] = poly[j][0]; flat[2 * j + 1] = poly[j][1];
      if (poly[j][0] < 1e-6 || poly[j][1] < 1e-6 || poly[j][0] > W - 1e-6 || poly[j][1] > H - 1e-6) border[i] = 1;
      const a = poly[j], b = poly[j + 1], ka = key(a), kb = key(b);
      const ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      const e = emap.get(ek);
      if (!e) { const ne = { c1: i, c2: -1, x1: a[0], y1: a[1], x2: b[0], y2: b[1] }; emap.set(ek, ne); tmpEdges.push(ne); } else e.c2 = i;
    }
    polys[i] = flat;
  }
  const inner = tmpEdges.filter((e) => e.c2 >= 0);
  const E = inner.length;
  const edges = { n: E, a: new Int32Array(E), b: new Int32Array(E), x1: new Float32Array(E), y1: new Float32Array(E), x2: new Float32Array(E), y2: new Float32Array(E) };
  const nbr = Array.from({ length: n }, () => []);
  inner.forEach((e, i) => {
    edges.a[i] = e.c1; edges.b[i] = e.c2; edges.x1[i] = e.x1; edges.y1[i] = e.y1; edges.x2[i] = e.x2; edges.y2[i] = e.y2;
    nbr[e.c1].push(e.c2); nbr[e.c2].push(e.c1);
  });
  return { W, H, n, px, py, polys, nbr, edges, border, delaunay, spacing: Math.sqrt((W * H) / n) };
}

export function findCell(mesh, x, y, hint = 0) { return mesh.delaunay.find(x, y, hint); }

// ---------------------------------------------------------------- project
export function emptyProject(S, mesh) {
  const cells = {};
  for (const [k, T] of Object.entries(CELL_ARRAYS)) cells[k] = new T(mesh.n);
  return {
    app: 'aleria-map-generator', version: 1, settings: { ...S }, cells, rivers: [], features: [], lines: [], labels: [], stamps: [], drawings: [],
    states: [{ id: 0, name: 'Unclaimed', color: '#888888', notes: '' }],
    religions: RELIGIONS_DEFAULT.map((r) => ({ ...r })), races: RACES_DEFAULT.map((r) => ({ ...r })),
    regions: S.lore ? LORE_REGIONS.map((r) => ({ key: r.key, name: r.name, notes: r.notes })) : [],
    customAssets: [], nextId: 1,
  };
}
export const uid = (P) => P.nextId++;

/** Derived (not saved) per-cell arrays. */
export function ensureDerived(mesh, P) {
  const c = P.cells, n = mesh.n;
  for (const k of ['t', 'm', 'flux']) if (!c[k] || c[k].length !== n) c[k] = new Float32Array(n);
  if (!c.dist || c.dist.length !== n) c.dist = new Uint16Array(n);
}

export const isWater = (P, i) => P.cells.h[i] <= 0 || P.cells.lake[i] > 0;
export const isOcean = (P, i) => P.cells.h[i] <= 0;

// ---------------------------------------------------------------- generation entry
export function generateWorld(S) {
  const [W, H] = S.size.split('x').map(Number);
  const mesh = buildMesh(S.seed, W, H, S.cells);
  const rng = makeRng(S.seed + '|world|' + (S.lore ? 'lore' : S.shape));
  const P = emptyProject(S, mesh);
  ensureDerived(mesh, P);
  terrain(mesh, P, rng);
  recomputeEnvironment(mesh, P);
  populate(mesh, P, rng);
  assignBiomes(mesh, P); // mana bumps may create anomaly zones
  return { mesh, P };
}

/** Re-run climate, hydrology and biomes after terrain edits (keeps locked biomes and manual rivers). */
export function recomputeEnvironment(mesh, P) {
  ensureDerived(mesh, P);
  computeClimate(mesh, P);
  hydrology(mesh, P);
  computeClimate(mesh, P); // lakes change water distance
  assignBiomes(mesh, P);
}

// ---------------------------------------------------------------- terrain
function distToPolyline(x, y, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? clamp(((x - ax) * dx + (y - ay) * dy) / L) : 0;
    const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
    if (d < best) best = d;
  }
  return best;
}

function terrain(mesh, P, rng) {
  const S = P.settings, { n, px, py, W, H } = mesh, A = W / H, c = P.cells;
  const nA = makeNoise2D(rng), nB = makeNoise2D(rng), nC = makeNoise2D(rng), nD = makeNoise2D(rng), nE = makeNoise2D(rng), nF = makeNoise2D(rng);
  const blobs = [], ridges = [];
  if (S.lore) {
    blobs.push({ x: 0.5, y: 0.5, rx: 0.45, ry: 0.42, a: 1 });
    blobs.push({ x: 0.34, y: 0.80, rx: 0.16, ry: 0.13, a: 0.8 });
    blobs.push({ x: 0.74, y: 0.17, rx: 0.17, ry: 0.10, a: 0.8 });
    blobs.push({ x: 0.36, y: 0.16, rx: 0.2, ry: 0.09, a: 0.75 });
    ridges.push({ pts: [[0.22, 0.31], [0.36, 0.27], [0.50, 0.29], [0.62, 0.26], [0.70, 0.27]], w: 0.032, s: 1 }); // wall between Elysandria & Menfor
    ridges.push({ pts: [[0.33, 0.39], [0.35, 0.50], [0.39, 0.63]], w: 0.03, s: 0.95 }); // western range
    ridges.push({ pts: [[0.65, 0.38], [0.67, 0.49], [0.63, 0.59]], w: 0.028, s: 0.85 }); // eastern range
    ridges.push({ pts: [[0.72, 0.10], [0.80, 0.17], [0.87, 0.28]], w: 0.03, s: 1 }); // frozen peaks
    ridges.push({ pts: [[0.25, 0.80], [0.36, 0.76], [0.47, 0.79]], w: 0.025, s: 0.5 }); // jungle hills
    for (let k = 0; k < 7; k++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(0.45, 0.5);
      blobs.push({ x: 0.5 + Math.cos(a) * r * 0.95, y: 0.5 + Math.sin(a) * r * 0.9, rx: rng.range(0.02, 0.05), ry: rng.range(0.02, 0.05), a: 0.55 });
    }
  } else {
    const shape = S.shape;
    if (shape === 'continent') {
      blobs.push({ x: rng.range(0.44, 0.56), y: rng.range(0.44, 0.56), rx: 0.36, ry: 0.38, a: 1 });
      for (let k = 0; k < 3; k++) blobs.push({ x: rng.range(0.25, 0.75), y: rng.range(0.25, 0.75), rx: rng.range(0.1, 0.2), ry: rng.range(0.1, 0.2), a: 0.8 });
    } else if (shape === 'twin') {
      blobs.push({ x: rng.range(0.25, 0.32), y: rng.range(0.4, 0.6), rx: 0.2, ry: 0.36, a: 1 });
      blobs.push({ x: rng.range(0.68, 0.75), y: rng.range(0.4, 0.6), rx: 0.2, ry: 0.36, a: 1 });
    } else if (shape === 'pangea') {
      blobs.push({ x: 0.5, y: 0.5, rx: 0.47, ry: 0.46, a: 1.2 });
    } else { // archipelago
      const k = rng.int(10, 16);
      for (let i = 0; i < k; i++) blobs.push({ x: rng.range(0.12, 0.88), y: rng.range(0.12, 0.88), rx: rng.range(0.04, 0.12), ry: rng.range(0.04, 0.12), a: 0.9 });
    }
    const rc = shape === 'archipelago' ? rng.int(1, 3) : rng.int(2, 4);
    for (let r = 0; r < rc; r++) {
      const b = rng.pick(blobs); let x = b.x + rng.range(-0.5, 0.5) * b.rx, y = b.y + rng.range(-0.5, 0.5) * b.ry;
      let ang = rng.range(0, Math.PI * 2); const pts = [[x, y]];
      for (let s = 0; s < 3; s++) { ang += rng.range(-0.6, 0.6); x += Math.cos(ang) * 0.08; y += Math.sin(ang) * 0.08; pts.push([x, y]); }
      ridges.push({ pts, w: 0.03, s: rng.range(0.7, 1) });
    }
  }
  ridges.forEach((r) => (r.pts = r.pts.map(([x, y]) => [x * A, y])));
  const raw = new Float32Array(n);
  const roughAmp = (0.16 + 0.22 * S.roughness) * (S.lore ? 1 : 1.6);
  for (let i = 0; i < n; i++) {
    const nx = px[i] / W, ny = py[i] / H;
    const wa = S.lore ? 0.05 : 0.11, wx = nx + wa * fbm(nA, nx * 3 + 11, ny * 3 + 3, 3), wy = ny + wa * fbm(nA, nx * 3 + 7, ny * 3 + 19, 3);
    let base = -1;
    for (const b of blobs) { const v = b.a * (1 - Math.hypot((wx - b.x) / b.rx, (wy - b.y) / b.ry)); if (v > base) base = v; }
    base = Math.tanh(base * 2.5) * 0.45;
    let e = base + fbm(nB, nx * A * 4, ny * 4, 5) * roughAmp;
    if (S.lore) { // ragged, island-strewn storm coast in the SE
      const se = Math.exp(-((nx - 0.83) ** 2 + (ny - 0.82) ** 2) / 0.012);
      e -= se * Math.abs(nC(nx * 16, ny * 16)) * 0.45;
    }
    let r = 0;
    for (const rg of ridges) { const d = distToPolyline((wx + 0.025 * nE(nx * 6 + 40, ny * 6)) * A, wy + 0.025 * nE(nx * 6, ny * 6 + 40), rg.pts) + 0.012 * nE(nx * 20, ny * 20); r = Math.max(r, rg.s * Math.exp(-((d / rg.w) ** 2))); }
    r *= 0.55 + 0.45 * ridged(nD, nx * A * 6, ny * 6);
    e += r * (0.25 + 0.6 * S.mountains) * (base > -0.15 ? 1 : 0.35);
    e += (S.mountains - 0.5) * 0.12 * Math.max(0, ridged(nD, nx * A * 3 + 50, ny * 3) - 0.5);
    const de = Math.min(nx, 1 - nx, ny, 1 - ny);
    if (de < 0.07) e -= ((0.07 - de) / 0.07) * 0.9;
    raw[i] = e;
  }
  // light smoothing
  const sm = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (const j of mesh.nbr[i]) s += raw[j]; sm[i] = 0.55 * raw[i] + (0.45 * s) / Math.max(1, mesh.nbr[i].length); }
  const sorted = Array.from(sm).sort((a, b) => a - b);
  const q = sorted[Math.floor((1 - S.land) * (n - 1))], mx = sorted[n - 1], mn = sorted[0];
  for (let i = 0; i < n; i++) {
    let v = sm[i] > q ? (sm[i] - q) / (mx - q) : -(q - sm[i]) / (q - mn + 1e-6);
    if (v > 0) v = Math.max(0.01, Math.pow(v, 1.15));
    if (S.lore) { // keep the Elysandrian heartland mostly dry lowland (no inland sea at the capital)
      const w = Math.exp(-(((px[i] / W) - 0.5) ** 2 / 0.03 + ((py[i] / H) - 0.52) ** 2 / 0.022));
      if (w > 0.2 && v < 0.03 + 0.09 * w) v = 0.03 + 0.09 * w; // gentle dome: drains outward, no inland sea
    }
    if (mesh.border[i]) v = Math.min(v, -0.3);
    c.h[i] = v;
  }
  // regions & base climate
  for (let i = 0; i < n; i++) {
    const nx = px[i] / W, ny = py[i] / H;
    const wx = nx + 0.05 * nE(nx * 4 + 3, ny * 4), wy = ny + 0.05 * nE(nx * 4, ny * 4 + 9);
    let t0, m0;
    if (S.lore) {
      let best = -1, bi = 0, sw = 0, st = 0, smo = 0;
      LORE_REGIONS.forEach((R, ri) => {
        const w = R.bias * Math.exp(-((wx - R.ax) ** 2 + (wy - R.ay) ** 2) / (R.s * R.s));
        sw += w; st += w * R.t; smo += w * R.m;
        if (w > best) { best = w; bi = ri; }
      });
      c.region[i] = bi;
      t0 = sw > 1e-9 ? st / sw : 0.5; m0 = sw > 1e-9 ? smo / sw : 0.5;
      t0 += (ny - 0.5) * 0.15;
    } else {
      c.region[i] = REGION_NONE;
      t0 = -0.05 + ny * 1.0; m0 = 0.5;
    }
    c.t0[i] = t0 + fbm(nF, nx * 5, ny * 5, 3) * 0.12;
    c.m0[i] = m0 + fbm(nC, nx * 7 + 30, ny * 7, 4) * 0.5;
    c.mana[i] = Math.pow(clamp((fbm(nF, nx * 4 + 70, ny * 4 + 70, 4) + 0.6) / 1.4), 1.6) * 0.55;
  }
}

// ---------------------------------------------------------------- climate & hydrology
function bfsDistance(mesh, isSource, maxD = 60) {
  const n = mesh.n, d = new Uint16Array(n).fill(65535), q = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) if (isSource(i)) { d[i] = 0; q[tail++] = i; }
  while (head < tail) {
    const i = q[head++]; if (d[i] >= maxD) continue;
    for (const j of mesh.nbr[i]) if (d[j] === 65535) { d[j] = d[i] + 1; q[tail++] = j; }
  }
  return d;
}

export function computeClimate(mesh, P) {
  const c = P.cells, S = P.settings, n = mesh.n;
  c.dist = bfsDistance(mesh, (i) => isWater(P, i), 200);
  for (let i = 0; i < n; i++) {
    const hh = Math.max(0, c.h[i]);
    c.t[i] = c.t0[i] + S.temp * 0.3 - hh * 0.42;
    const d = c.dist[i];
    c.m[i] = c.m0[i] + S.moist * 0.3 + (d <= 1 ? 0.1 : d <= 3 ? 0.05 : d > 8 ? -0.06 : 0);
  }
}

export function hydrology(mesh, P) {
  const c = P.cells, n = mesh.n, S = P.settings;
  const filled = new Float32Array(n), done = new Uint8Array(n), heap = new MinHeap();
  for (let i = 0; i < n; i++) if (c.h[i] <= 0 || mesh.border[i]) { filled[i] = c.h[i]; done[i] = 1; heap.push(i, c.h[i]); }
  const eps = 1e-4;
  while (heap.size) {
    const i = heap.pop();
    for (const j of mesh.nbr[i]) if (!done[j]) { done[j] = 1; filled[j] = Math.max(c.h[j], filled[i] + eps); heap.push(j, filled[j]); }
  }
  for (let i = 0; i < n; i++) {
    if (c.lake[i] === 2) continue; // user-painted lakes stay
    c.lake[i] = c.h[i] > 0 && filled[i] - c.h[i] > 0.04 ? 1 : 0;
  }
  // cap auto-lake size: oversized basins keep only their deepest cells (the rest becomes marsh/lowland)
  const cap = Math.max(12, Math.round(n * 0.0035)), seen = new Uint8Array(n);
  for (let s0 = 0; s0 < n; s0++) {
    if (c.lake[s0] !== 1 || seen[s0]) continue;
    const comp = [s0]; seen[s0] = 1;
    for (let k = 0; k < comp.length; k++) for (const j of mesh.nbr[comp[k]]) if (c.lake[j] === 1 && !seen[j]) { seen[j] = 1; comp.push(j); }
    if (comp.length <= cap) continue;
    comp.sort((a, b) => (filled[b] - c.h[b]) - (filled[a] - c.h[a]));
    for (let k = cap; k < comp.length; k++) c.lake[comp[k]] = 0;
  }
  const down = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (c.h[i] <= 0) continue;
    let best = filled[i], bj = -1;
    for (const j of mesh.nbr[i]) if (filled[j] < best) { best = filled[j]; bj = j; }
    down[i] = bj;
  }
  const order = Array.from({ length: n }, (_, i) => i).filter((i) => c.h[i] > 0).sort((a, b) => filled[b] - filled[a]);
  c.flux.fill(0);
  for (const i of order) { c.flux[i] += Math.max(0.05, c.m[i]); if (down[i] >= 0) c.flux[down[i]] += c.flux[i]; }
  const T = mesh.n * 0.0022 * (1.6 - S.rivers);
  P.riverThreshold = T;
  const isRiver = new Uint8Array(n), hasUp = new Uint8Array(n), lakeUp = new Int32Array(n).fill(-1);
  for (const i of order) if (!c.lake[i] && c.flux[i] > T) isRiver[i] = 1;
  for (const i of order) { const d = down[i]; if (d < 0) continue; if (isRiver[i] && isRiver[d]) hasUp[d] = 1; if (c.lake[i] && isRiver[d]) lakeUp[d] = i; }
  const visited = new Uint8Array(n), rivers = [];
  const width = (f) => 0.5 + Math.sqrt(f / T) * 0.55;
  for (const s of order) {
    if (!isRiver[s] || hasUp[s] || visited[s]) continue;
    const pts = [], w = [];
    if (lakeUp[s] >= 0) { pts.push([mesh.px[lakeUp[s]], mesh.py[lakeUp[s]]]); w.push(width(c.flux[s])); }
    let cur = s;
    for (let guard = 0; guard < n; guard++) {
      pts.push([mesh.px[cur], mesh.py[cur]]); w.push(width(c.flux[cur])); visited[cur] = 1;
      const d = down[cur]; if (d < 0) break;
      if (c.h[d] <= 0 || c.lake[d]) { pts.push([(mesh.px[cur] + mesh.px[d]) / 2, (mesh.py[cur] + mesh.py[d]) / 2]); w.push(width(c.flux[cur])); break; }
      if (visited[d]) { pts.push([mesh.px[d], mesh.py[d]]); w.push(width(c.flux[d])); break; }
      cur = d;
    }
    if (pts.length >= 3) rivers.push({ pts: pts.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]), w: w.map((v) => +v.toFixed(2)), auto: true, flux: c.flux[cur] });
  }
  const old = P.rivers || [];
  const keep = old.filter((r) => !r.auto);
  // preserve names/notes of auto rivers whose mouths are unchanged
  const oldAuto = old.filter((r) => r.auto);
  rivers.forEach((r) => {
    const last = r.pts[r.pts.length - 1];
    const match = oldAuto.find((o) => { const l = o.pts[o.pts.length - 1]; return Math.abs(l[0] - last[0]) < 0.5 && Math.abs(l[1] - last[1]) < 0.5; });
    r.id = match ? match.id : uid(P);
    if (match) { r.name = match.name; r.notes = match.notes; } else r.name = '';
  });
  P.rivers = keep.concat(rivers);
}

export function biomeFor(P, i) {
  const c = P.cells;
  if (c.h[i] <= 0) return B.ocean;
  if (c.lake[i]) return B.lake;
  const h = c.h[i], t = c.t[i], m = c.m[i];
  const reg = c.region[i] !== REGION_NONE ? LORE_REGIONS[c.region[i]]?.key : null;
  if (c.mana[i] > 0.86) return B.anomaly;
  if (h > 0.6) return t < 0.12 ? B.snowpeak : B.mountain;
  if (h > 0.4) return t < 0.02 ? B.glacier : B.hills;
  if (t < 0.02) return B.glacier;
  if (t < 0.17) return m > 0.5 ? B.tundra : B.coldwaste;
  if (t < 0.3) return m > 0.45 ? B.taiga : m < 0.3 ? B.coldwaste : B.tundra;
  if (reg === 'storm' && m > 0.62) return B.storm;
  if (t < 0.72) {
    if (m < 0.55) return B.plains;
    if (m < 0.74) return B.forest;
    if (m < 0.9) return reg === 'elysandria' || reg === 'shadowW' ? B.ancient : B.forest;
    return B.swamp;
  }
  if (m < 0.22) return B.desert;
  if (m < 0.45) return B.savanna;
  if (m < 0.95) return B.jungle;
  return B.swamp;
}

export function assignBiomes(mesh, P) {
  const c = P.cells;
  for (let i = 0; i < mesh.n; i++) {
    if (c.lock[i]) { // locked biome; keep water/land consistent
      continue;
    }
    c.biome[i] = biomeFor(P, i);
  }
}

// ---------------------------------------------------------------- graph search
/** Multi-source Dijkstra. sources: [{cell, owner}]. stepCost(owner, from, to) -> cost or Infinity. */
export function dijkstra(mesh, sources, stepCost, maxCost = Infinity) {
  const n = mesh.n, cost = new Float64Array(n).fill(Infinity), owner = new Int16Array(n).fill(-1), heap = new MinHeap();
  for (const s of sources) { cost[s.cell] = 0; owner[s.cell] = s.owner; heap.push(s.cell, 0); }
  while (heap.size) {
    const i = heap.pop(), ci = heap.lastPri;
    if (ci > cost[i]) continue;
    for (const j of mesh.nbr[i]) {
      const sc = stepCost(owner[i], i, j); if (!isFinite(sc)) continue;
      const nc = ci + sc; const lim = typeof maxCost === 'number' ? maxCost : (maxCost[owner[i]] ?? Infinity); if (nc < cost[j] && nc <= lim) { cost[j] = nc; owner[j] = owner[i]; heap.push(j, nc); }
    }
  }
  return { cost, owner };
}

/** A* path between two cells. mode 'land' (avoid water) or 'sea' (water only). */
export function findPath(mesh, P, a, b, mode = 'land', reuse = null) {
  const c = P.cells, n = mesh.n, g = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), heap = new MinHeap();
  const sp = mesh.spacing, bx = mesh.px[b], by = mesh.py[b];
  const h = (i) => (Math.hypot(mesh.px[i] - bx, mesh.py[i] - by) / sp) * (mode === 'sea' ? 1 : 0.35);
  g[a] = 0; heap.push(a, h(a));
  let iter = 0;
  while (heap.size && iter++ < n * 4) {
    const i = heap.pop();
    if (i === b) break;
    for (const j of mesh.nbr[i]) {
      let sc;
      if (mode === 'sea') sc = j === b || isOcean(P, j) ? 1 : Infinity;
      else {
        if (isWater(P, j) && j !== b) sc = Infinity;
        else sc = (BIOMES[c.biome[j]].cost || 1) * (1 + Math.abs(c.h[j] - c.h[i]) * 8) * (reuse && reuse[j] ? 0.35 : 1);
      }
      if (!isFinite(sc)) continue;
      const ng = g[i] + sc;
      if (ng < g[j]) { g[j] = ng; from[j] = i; heap.push(j, ng + h(j)); }
    }
  }
  if (from[b] < 0 && a !== b) return null;
  const path = []; for (let i = b; i >= 0; i = from[i]) { path.push(i); if (i === a) break; }
  return path.reverse();
}

// ---------------------------------------------------------------- population
const KIND_MIN_DIST = { capital: 0.08, city: 0.065, town: 0.04, village: 0.022 };

function populate(mesh, P, rng) {
  const S = P.settings, c = P.cells, n = mesh.n, W = mesh.W, H = mesh.H, lore = S.lore;
  const names = new NameGen(rng, (S.customNames || '').split('\n'));
  P.nameState = null;
  const regKey = (i) => (c.region[i] !== REGION_NONE ? LORE_REGIONS[c.region[i]].key : null);
  const T = P.riverThreshold || 30;
  const f = Math.sqrt(n / 8000);
  const land = (i) => !isWater(P, i);
  const feats = [];
  const add = (kind, cell, extra = {}) => {
    const ft = { id: uid(P), kind, x: +mesh.px[cell].toFixed(1), y: +mesh.py[cell].toFixed(1), cell, name: extra.name || names.forKind(kind), notes: '', ...extra };
    feats.push(ft); return ft;
  };
  const farFrom = (x, y, d, kinds) => feats.every((ft) => (kinds && !kinds.includes(ft.kind)) || Math.hypot(ft.x - x, ft.y - y) >= d);
  const regionFactor = { elysandria: 1.35, menfor: 0.7, frozen: 0.45, jungle: 0.75, storm: 0.6, shadowW: 0.25, shadowE: 0.15 };
  const hab = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!land(i) || mesh.border[i]) continue;
    let v = BIOMES[c.biome[i]].hab * (1 + Math.min(c.flux[i] / T, 3) * 0.35) + (c.dist[i] === 1 ? 0.3 : 0);
    if (lore) v *= regionFactor[regKey(i)] ?? 1;
    hab[i] = v * (0.75 + 0.5 * rng());
  }
  const byHab = Array.from({ length: n }, (_, i) => i).filter((i) => hab[i] > 0.02).sort((a, b) => hab[b] - hab[a]);

  // capital
  let capCell = -1, best = -1;
  const cx = lore ? 0.49 : 0.5, cy = lore ? 0.5 : 0.5;
  for (const i of byHab) {
    const d = Math.hypot(mesh.px[i] / W - cx, mesh.py[i] / H - cy);
    const sc = hab[i] * Math.exp(-((d / (lore ? 0.07 : 0.25)) ** 2));
    if (sc > best) { best = sc; capCell = i; }
  }
  if (capCell < 0) capCell = byHab[0] ?? 0;
  const capital = add('capital', capCell, lore ? {
    name: 'Royal Capital of Elysandria', church: true,
    notes: 'Grand palace-temple complex: marble halls, crystal statues and the main summoning chamber (magic circles). Seat of the Church of Ucliat and historical hero-summoning site. Domain of Queen Elisabeth Bernt Ravenshield III. (Rename to match the novel if desired.)',
  } : { name: names.forKind('city') });
  capital.pop = rng.int(180, 320) * 1000;

  const seats = {};
  if (lore) {
    for (const rk of ['menfor', 'frozen', 'jungle', 'storm', 'shadowW']) {
      const cand = byHab.find((i) => regKey(i) === rk && farFrom(mesh.px[i], mesh.py[i], W * 0.06));
      if (cand !== undefined) seats[rk] = add('city', cand, { pop: rng.int(8, 40) * 1000 });
    }
  }
  const dens = S.settlements;
  const quota = { city: Math.round((5 + 6 * dens) * (lore ? 1 : 1)), town: Math.round(10 + 18 * dens), village: Math.round(18 + 36 * dens) };
  for (const kind of ['city', 'town', 'village']) {
    let placed = 0; const md = KIND_MIN_DIST[kind] * W * (1.2 - dens * 0.4);
    for (const i of byHab) {
      if (placed >= quota[kind]) break;
      if (!farFrom(mesh.px[i], mesh.py[i], md)) continue;
      const pop = kind === 'city' ? rng.int(15, 90) * 1000 : kind === 'town' ? rng.int(2, 14) * 1000 : rng.int(80, 900);
      add(kind, i, { pop }); placed++;
    }
  }

  // ---- states
  const stateDefs = [];
  if (lore) {
    stateDefs.push({ name: 'Kingdom of Elysandria', color: '#3a64a8', home: 'elysandria', power: 1.5, seat: capital, ruler: 'Queen Elisabeth Bernt Ravenshield III', notes: 'Central kingdom of Kremantin. Church of Ucliat is the state faith.' });
    const defs = { menfor: ['Menfor', '#8a96a3', 0.9, 'Holdings of the harsh northern wastes.'], frozen: ['Frozen Holds', '#9cc3df', 0.8, 'Placeholder realm of the frozen north-east (rename/edit freely).'], jungle: ['Beastfolk Prides', '#c27a33', 1.0, 'Placeholder: lion-like beastfolk territories of the southern jungles.'], storm: ['Rih-Fugh Enclaves', '#8457b8', 0.85, 'Placeholder: horned, third-eyed Rih-Fugh in the storm-shrouded reach.'], shadowW: ['Tenebrim Reaches', '#4f6573', 0.6, 'Placeholder: barely-known tenebrim lands.'] };
    for (const [rk, [nm, col, pw, nt]] of Object.entries(defs)) if (seats[rk]) stateDefs.push({ name: nm, color: col, home: rk, power: pw, seat: seats[rk], notes: nt });
  } else {
    const k = Math.max(1, Math.min(12, S.states | 0));
    const pal = ['#3a64a8', '#a8433a', '#3a8f5a', '#8f7a3a', '#7a3a8f', '#3a8f8f', '#8f3a6a', '#5a6a8f', '#6a8f3a', '#8f5a3a', '#4a4a8f', '#8f8f3a'];
    const cities = feats.filter((ft) => ft.kind === 'capital' || ft.kind === 'city');
    const chosen = [capital];
    while (chosen.length < k && chosen.length < cities.length) {
      let bc = null, bd = -1;
      for (const ct of cities) { if (chosen.includes(ct)) continue; const d = Math.min(...chosen.map((o) => Math.hypot(o.x - ct.x, o.y - ct.y))); if (d > bd) { bd = d; bc = ct; } }
      if (!bc) break; chosen.push(bc);
    }
    chosen.forEach((ct, i) => stateDefs.push({ name: names.state(), color: pal[i % pal.length], home: null, power: i === 0 ? 1.2 : 1, seat: ct, notes: '' }));
  }
  P.states = [{ id: 0, name: 'Unclaimed', color: '#888888', notes: '' }];
  stateDefs.forEach((d, i) => { P.states.push({ id: i + 1, name: d.name, color: d.color, notes: d.notes, ruler: d.ruler || '', capital: d.seat.id }); if (d.seat !== capital) d.seat.kind = 'city'; d.seat.stateSeat = true; });
  const maxC = {};
  stateDefs.forEach((d, i) => (maxC[i] = (d.home === 'elysandria' ? 46 : d.home === 'shadowW' ? 14 : lore ? 26 : 40) * f * 1.6));
  const res = dijkstra(mesh, stateDefs.map((d, i) => ({ cell: d.seat.cell, owner: i })), (o, a, b) => {
    if (isWater(P, b)) return Infinity;
    const d = stateDefs[o];
    let cost = (BIOMES[c.biome[b]].cost || 1) * (1 + Math.max(0, c.h[b]) * 0.5);
    if (d.home && regKey(b) !== d.home) cost *= 3;
    return cost / d.power;
  }, maxC);
  for (let i = 0; i < n; i++) c.state[i] = res.owner[i] >= 0 && land(i) ? res.owner[i] + 1 : 0;

  // ---- known world (Hero's View)
  const kn = dijkstra(mesh, [{ cell: capCell, owner: 0 }], (o, a, b) => (isWater(P, b) ? 2.5 : BIOMES[c.biome[b]].cost || 1));
  for (let i = 0; i < n; i++) {
    const nx = mesh.px[i] / W, ny = mesh.py[i] / H, de = Math.min(nx, 1 - nx, ny, 1 - ny);
    let k = 1 - smoothstep(30 * f, 110 * f, kn.cost[i]);
    if (lore) { const rk = regKey(i); if (rk === 'shadowW' || rk === 'shadowE') k *= 0.12; if (rk === 'elysandria') k = Math.max(k, 0.85 * (1 - smoothstep(30 * f, 90 * f, kn.cost[i]))); }
    k *= smoothstep(0.02, 0.16, de);
    c.known[i] = clamp(k);
  }

  // ---- lore markers & special sites
  const elysState = 1;
  const pickCells = (count, filter, minD, score = () => rng()) => {
    const cand = []; for (let i = 0; i < n; i++) if (land(i) && !mesh.border[i] && filter(i)) cand.push(i);
    const sc = new Map(cand.map((i) => [i, score(i)]));
    cand.sort((a, b) => sc.get(b) - sc.get(a));
    const out = [], clear = mesh.spacing * 1.8;
    for (const i of cand) { if (out.length >= count) break; if (farFrom(mesh.px[i], mesh.py[i], clear) && out.every((o) => Math.hypot(mesh.px[o] - mesh.px[i], mesh.py[o] - mesh.py[i]) >= minD)) out.push(i); }
    return out;
  };
  const frontier = (i) => c.state[i] === elysState && mesh.nbr[i].some((j) => land(j) && c.state[j] !== elysState);
  pickCells(lore ? 5 : 3, frontier, W * 0.07, (i) => (lore && ['menfor', 'shadowW', 'shadowE'].some((rk) => mesh.nbr[i].some((j) => regKey(j) === rk)) ? 1 : 0) + rng() * 0.8)
    .forEach((i) => add('fortress', i, { notes: 'Fortified frontier. Church Knights garrisoned here.' }));
  if (!lore) feats.filter((ft) => ft.kind === 'fortress').forEach((ft) => (ft.notes = 'Fortified frontier.'));
  const inEly = (i) => c.state[i] === elysState;
  pickCells(4, (i) => inEly(i) && BIOMES[c.biome[i]].hab > 0.4, W * 0.035, (i) => hab[i]).forEach((i) => add('temple', i, { church: true, notes: lore ? 'Church of Ucliat stronghold.' : 'Temple.' }));
  const dungeonBiomes = new Set([B.hills, B.mountain, B.forest, B.ancient, B.jungle, B.anomaly, B.taiga, B.storm]);
  pickCells(Math.round(8 + 4 * dens), (i) => dungeonBiomes.has(c.biome[i]) && c.known[i] > 0.05, W * 0.06).forEach((i) => add('dungeon', i, { notes: 'Dungeon entrance. Lost Magic relics are said to lie within.' }));
  pickCells(5, (i) => c.known[i] > 0.1 && c.known[i] < 0.9, W * 0.07).forEach((i) => add('ruins', i, { notes: 'Ancient ruins.' }));
  pickCells(4, (i) => c.known[i] > 0.2, W * 0.08, (i) => c.mana[i] + rng() * 0.2).forEach((i) => add('relic', i, { notes: 'Relic site: Lost Magic artefacts (appraisal required).' }));
  if (lore) {
    pickCells(3, (i) => c.known[i] < 0.75, W * 0.15, (i) => c.mana[i] + rng() * 0.15).forEach((i) => add('lumenari', i, { notes: 'Rare Lumenari manifestation: cracked stone humanoids with glowing cracks; unstable mana.' }));
    pickCells(4, (i) => c.known[i] > 0.08 && c.known[i] < 0.55 && !inEly(i), W * 0.13).forEach((i) => add('breach', i, { notes: 'Doomsday underworld breach point. Monster flood zone.' }));
    pickCells(2, (i) => inEly(i) && c.known[i] > 0.5 && [B.forest, B.ancient, B.hills].includes(c.biome[i]), W * 0.12).forEach((i) => add('crimson', i, { hidden: true, notes: 'Hidden Crimson Sun Order laboratory (experimental site).' }));
    pickCells(5, (i) => c.known[i] < 0.5 && c.known[i] > 0.03, W * 0.09).forEach((i) => add('monster', i, { notes: 'Monster incursions reported.' }));
    feats.filter((ft) => ft.kind === 'fortress').slice(0, 3).forEach((ft) => {
      const j = mesh.nbr[ft.cell].find((q) => land(q)) ?? ft.cell;
      const k = add('knights', j, { notes: 'Church Knights: silver chains, sword-crossed sun medallions, halo headpieces.' });
      k.x = +(ft.x + mesh.spacing * 1.3).toFixed(1); k.y = +(ft.y - mesh.spacing * 0.6).toFixed(1);
    });
    const sm = add('summoning', capCell, { notes: 'Main summoning chamber (magic circles) beneath the palace-temple. Historical hero-summoning site.' });
    sm.x = +(capital.x + mesh.spacing * 1.6).toFixed(1); sm.y = +(capital.y + mesh.spacing * 1.1).toFixed(1);
  }
  // mana & threat fields
  const bump = (arr, kinds, amp, r) => {
    for (const ft of feats) if (kinds.includes(ft.kind)) for (let i = 0; i < n; i++) {
      const d2 = (mesh.px[i] - ft.x) ** 2 + (mesh.py[i] - ft.y) ** 2; if (d2 > 9 * r * r) continue;
      arr[i] = Math.min(1, arr[i] + amp * Math.exp(-d2 / (r * r)));
    }
  };
  bump(c.mana, ['lumenari'], 0.6, W * 0.03); bump(c.mana, ['dungeon', 'relic'], 0.2, W * 0.02); bump(c.mana, ['breach'], 0.3, W * 0.03); bump(c.mana, ['summoning'], 0.25, W * 0.015);
  for (let i = 0; i < n; i++) c.threat[i] = land(i) ? (1 - c.known[i]) * 0.18 : 0;
  bump(c.threat, ['breach'], 0.95, W * 0.05); bump(c.threat, ['monster'], 0.4, W * 0.025);

  // religion
  const churchSites = feats.filter((ft) => ft.church || (ft.kind === 'city' && c.state[ft.cell] === elysState));
  churchSites.forEach((ft) => (ft.church = true));
  const rel = churchSites.length ? dijkstra(mesh, churchSites.map((ft) => ({ cell: ft.cell, owner: 0 })), (o, a, b) => (isWater(P, b) ? Infinity : BIOMES[c.biome[b]].cost || 1)) : null;
  for (let i = 0; i < n; i++) {
    if (!land(i)) { c.religion[i] = 0; continue; }
    const rk = regKey(i), rc = rel ? rel.cost[i] : Infinity;
    if (inEly(i) || rc < 10 * f) c.religion[i] = 1;
    else if (!lore) c.religion[i] = 3;
    else if (rk === 'menfor' || rk === 'frozen') c.religion[i] = 3;
    else if (rk === 'jungle' || rk === 'storm') c.religion[i] = 4;
    else c.religion[i] = c.known[i] > 0.3 ? 3 : 0;
  }
  for (const ft of feats) if (ft.kind === 'crimson') for (let i = 0; i < n; i++) if (land(i) && Math.hypot(mesh.px[i] - ft.x, mesh.py[i] - ft.y) < W * 0.022) c.religion[i] = 2;
  // races
  const nz = makeNoise2D(rng);
  for (let i = 0; i < n; i++) {
    if (!land(i)) { c.race[i] = 0; continue; }
    if (!lore) { c.race[i] = c.state[i] ? ((c.state[i] - 1) % 6) + 1 : 0; continue; }
    const rk = regKey(i), b = c.biome[i];
    const highland = b === B.hills || b === B.mountain || b === B.snowpeak;
    c.race[i] = { elysandria: 1, menfor: 1, frozen: 3, jungle: 2, storm: 4, shadowW: 5, shadowE: 6 }[rk] || 0;
    if (rk === 'elysandria' && highland && nz(mesh.px[i] / 90, mesh.py[i] / 90) > -0.1) c.race[i] = 3;
    if (c.known[i] < 0.05) c.race[i] = 0;
  }
  feats.forEach((ft) => (ft.state = c.state[ft.cell]));

  // ---- roads & trade routes
  const lines = [], roadUse = new Uint8Array(n);
  const connect = (a, b, kind) => {
    const path = findPath(mesh, P, a.cell, b.cell, 'land', roadUse);
    if (!path || path.length < 2) return false;
    path.forEach((i) => (roadUse[i] = 1));
    const pts = path.map((i) => [+mesh.px[i].toFixed(1), +mesh.py[i].toFixed(1)]);
    pts[0] = [a.x, a.y]; pts[pts.length - 1] = [b.x, b.y];
    lines.push({ id: uid(P), kind, pts, name: kind === 'trade' ? `${a.name} – ${b.name} Road` : '', notes: '' });
    return true;
  };
  const major = feats.filter((ft) => ft.kind === 'capital' || ft.kind === 'city');
  // MST (Prim) over major settlements
  const inT = [major[0]], rest = major.slice(1);
  while (rest.length) {
    let bi = -1, bj = -1, bd = Infinity;
    rest.forEach((r, i) => inT.forEach((t, j) => { const d = Math.hypot(r.x - t.x, r.y - t.y); if (d < bd) { bd = d; bi = i; bj = j; } }));
    const r = rest.splice(bi, 1)[0];
    if (bd < W * 0.35) connect(inT[bj], r, 'trade');
    inT.push(r);
  }
  const net = major.slice();
  for (const kind of ['town', 'fortress', 'temple', 'village']) {
    for (const ft of feats.filter((q) => q.kind === kind)) {
      let bn = null, bd = Infinity;
      for (const o of net) { const d = Math.hypot(o.x - ft.x, o.y - ft.y); if (d < bd) { bd = d; bn = o; } }
      if (bn && bd < W * (kind === 'village' ? 0.08 : 0.16)) connect(ft, bn, kind === 'village' ? 'path' : 'road');
      if (kind !== 'village') net.push(ft);
    }
  }
  // sea routes between ports
  const ports = major.filter((ft) => mesh.nbr[ft.cell].some((j) => isOcean(P, j)));
  let seaCount = 0;
  for (const a of ports) {
    if (seaCount >= 5) break;
    const others = ports.filter((b) => b !== a && Math.hypot(a.x - b.x, a.y - b.y) > W * 0.14).sort((p, q) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(a.x - q.x, a.y - q.y));
    const b = others[0]; if (!b || lines.some((l) => l.kind === 'sea' && ((l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id)))) continue;
    const wa = mesh.nbr[a.cell].find((j) => isOcean(P, j)), wb = mesh.nbr[b.cell].find((j) => isOcean(P, j));
    const path = findPath(mesh, P, wa, wb, 'sea');
    if (path && path.length > 3) {
      const pts = [[a.x, a.y], ...path.map((i) => [+mesh.px[i].toFixed(1), +mesh.py[i].toFixed(1)]), [b.x, b.y]];
      lines.push({ id: uid(P), kind: 'sea', pts, a: a.id, b: b.id, name: `${a.name} – ${b.name} sea lane`, notes: '' }); seaCount++;
    }
  }

  // ---- labels & decorations
  const labels = [];
  if (lore) {
    LORE_REGIONS.forEach((R, ri) => {
      let sx = 0, sy = 0, k = 0;
      for (let i = 0; i < n; i++) if (c.region[i] === ri && land(i)) { sx += mesh.px[i]; sy += mesh.py[i]; k++; }
      if (k < 15) return;
      const big = R.key === 'elysandria';
      const txt = big ? 'ELYSANDRIA' : R.key === 'menfor' ? 'MENFOR' : R.name;
      let lx = sx / k, ly = sy / k;
      if (big) ly -= H * 0.06;
      labels.push({ id: uid(P), kind: 'region', x: +lx.toFixed(1), y: +ly.toFixed(1), text: txt, size: big ? 30 : R.key === 'menfor' ? 24 : 17, spacing: big ? 10 : 5, font: 'title', rot: 0, italic: !['elysandria', 'menfor'].includes(R.key), region: R.key });
    });
    const sub = (txt, rk, dy) => { const L = labels.find((l) => l.region === rk); if (L) labels.push({ id: uid(P), kind: 'note', x: L.x, y: L.y + dy, text: txt, size: 10, spacing: 1, font: 'serif', italic: true, rot: 0 }); };
    sub('cold · barren · dangerous', 'menfor', 20);
    sub('here the storms never cease', 'storm', 17);
    sub('terra incognita', 'shadowW', 17);
    sub('terra incognita', 'shadowE', 17);
    labels.push({ id: uid(P), kind: 'title', x: W * 0.135, y: H * 0.065, text: 'KREMANTIN', size: 34, spacing: 8, font: 'title', rot: 0 });
    labels.push({ id: uid(P), kind: 'subtitle', x: W * 0.135, y: H * 0.065 + 33, text: 'the known continent of Aleria', size: 12, spacing: 2, font: 'serif', italic: true, rot: 0 });
  } else {
    labels.push({ id: uid(P), kind: 'title', x: W * 0.14, y: H * 0.065, text: names.word().toUpperCase(), size: 32, spacing: 8, font: 'title', rot: 0 });
  }
  // ocean labels: deepest open water
  const fromLand = bfsDistance(mesh, (i) => land(i), 400);
  const oceanPicks = [];
  const cand = []; for (let i = 0; i < n; i++) if (isOcean(P, i) && !mesh.border[i]) cand.push(i);
  cand.sort((a, b) => fromLand[b] - fromLand[a]);
  for (const i of cand) {
    if (oceanPicks.length >= 3) break;
    const x = mesh.px[i], y = mesh.py[i];
    if (x < W * 0.08 || x > W * 0.92 || y < H * 0.12 || y > H * 0.92) continue;
    if (oceanPicks.every((o) => Math.hypot(o[0] - x, o[1] - y) > W * 0.25) && labels.every((l) => Math.hypot(l.x - x, l.y - y) > W * 0.12)) oceanPicks.push([x, y]);
  }
  oceanPicks.forEach(([x, y]) => labels.push({ id: uid(P), kind: 'ocean', x: +x.toFixed(1), y: +y.toFixed(1), text: names.sea(), size: 14, spacing: 3, font: 'serif', italic: true, rot: 0 }));
  // name the biggest rivers
  P.rivers.filter((r) => r.auto).sort((a, b) => b.flux - a.flux).slice(0, 6).forEach((r) => (r.name = `River ${names.word()}`));

  P.features = feats; P.lines = lines; P.labels = labels;
  P.stamps = [{ id: uid(P), asset: 'compass', x: W * 0.065, y: H * 0.87, size: 70, rot: 0, opacity: 1, notes: '' }];
  P.drawings = [];
}

/** Re-place settlements/markers/roads/labels on the current terrain (keeps terrain edits). */
export function repopulate(mesh, P) {
  const rng = makeRng(P.settings.seed + '|world|repop|' + Date.now());
  ensureDerived(mesh, P);
  populate(mesh, P, rng);
  assignBiomes(mesh, P);
}

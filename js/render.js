// Renderer: builds cached geometry ("derived" data) from the project, then paints the
// map through a Painter (canvas or SVG). Order: water -> coast effects -> land ->
// overlays -> rivers -> borders -> relief -> roads -> drawings -> stamps -> features
// -> labels -> atmosphere (fog, storms, paper, vignette).
import { BIOMES, B } from './biomes.js';
import { LORE_REGIONS, isWater, isOcean, REGION_NONE } from './generator.js';
import { FEATURE_KINDS } from './assets.js';
import { mix, shade, rgba } from './color.js';
import { makeRng, clamp } from './rng.js';

// ------------------------------------------------------------------ geometry helpers
/** Join loose segments [x1,y1,x2,y2,...] into polylines. Returns [{pts, closed}]. */
export function chain(segs) {
  const m = segs.length / 4, key = (x, y) => Math.round(x * 20) + ',' + Math.round(y * 20);
  const adj = new Map(), k1 = new Array(m), k2 = new Array(m);
  const addAdj = (k, s) => { let a = adj.get(k); if (!a) adj.set(k, (a = [])); a.push(s); };
  for (let s = 0; s < m; s++) { k1[s] = key(segs[4 * s], segs[4 * s + 1]); k2[s] = key(segs[4 * s + 2], segs[4 * s + 3]); addAdj(k1[s], s); addAdj(k2[s], s); }
  const used = new Uint8Array(m), out = [];
  const walk = (s, startAtK2) => {
    const pts = [];
    let curKey;
    if (startAtK2) { pts.push(segs[4 * s + 2], segs[4 * s + 3], segs[4 * s], segs[4 * s + 1]); curKey = k1[s]; }
    else { pts.push(segs[4 * s], segs[4 * s + 1], segs[4 * s + 2], segs[4 * s + 3]); curKey = k2[s]; }
    const startKey = startAtK2 ? k2[s] : k1[s];
    used[s] = 1;
    for (let guard = 0; guard < m; guard++) {
      const nxt = (adj.get(curKey) || []).find((q) => !used[q]);
      if (nxt === undefined) break;
      used[nxt] = 1;
      if (k1[nxt] === curKey) { pts.push(segs[4 * nxt + 2], segs[4 * nxt + 3]); curKey = k2[nxt]; } else { pts.push(segs[4 * nxt], segs[4 * nxt + 1]); curKey = k1[nxt]; }
      if (curKey === startKey) break;
    }
    out.push({ pts, closed: curKey === startKey });
  };
  for (let s = 0; s < m; s++) if (!used[s]) { if (adj.get(k1[s]).length === 1) walk(s, false); else if (adj.get(k2[s]).length === 1) walk(s, true); }
  for (let s = 0; s < m; s++) if (!used[s]) walk(s, false);
  return out;
}

/** Chaikin corner cutting on a flat point array. */
export function chaikin(p, closed, iters = 2) {
  for (let it = 0; it < iters; it++) {
    const n = p.length / 2; if (n < 3) return p;
    const o = [];
    if (!closed) o.push(p[0], p[1]);
    const lim = closed ? n : n - 1;
    for (let i = 0; i < lim; i++) {
      const j = (i + 1) % n, ax = p[2 * i], ay = p[2 * i + 1], bx = p[2 * j], by = p[2 * j + 1];
      o.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by, 0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by);
    }
    if (!closed) o.push(p[2 * n - 2], p[2 * n - 1]);
    p = o;
  }
  return p;
}
const flatPts = (pts) => { const o = new Array(pts.length * 2); pts.forEach(([x, y], i) => { o[2 * i] = x; o[2 * i + 1] = y; }); return o; };
const smoothCache = new WeakMap();
export function smoothLine(pts, iters = 2) {
  let s = smoothCache.get(pts);
  if (!s) { s = chaikin(flatPts(pts), false, iters); smoothCache.set(pts, s); }
  return s;
}
function edgeSegs(mesh, test) {
  const E = mesh.edges, out = [];
  for (let e = 0; e < E.n; e++) if (test(E.a[e], E.b[e])) out.push(E.x1[e], E.y1[e], E.x2[e], E.y2[e]);
  return out;
}
const ringPoly = (cx, cy, r, k = 7, rot = 0, sy = 1) => { const o = []; for (let i = 0; i < k; i++) { const a = rot + (i / k) * Math.PI * 2; o.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r * sy); } return o; };

// ------------------------------------------------------------------ derived data
export function buildDerived(mesh, P, ES) {
  const c = P.cells, n = mesh.n, D = { overlays: {} };
  const land = (i) => !isOcean(P, i);
  // coastline and lake shores
  D.coast = chain(edgeSegs(mesh, (a, b) => land(a) !== land(b))).map((l) => chaikin(l.pts, l.closed, 2));
  D.lakeShore = chain(edgeSegs(mesh, (a, b) => land(a) && land(b) && !!c.lake[a] !== !!c.lake[b])).map((l) => chaikin(l.pts, l.closed, 2));
  // hillshade
  const hs = new Float32Array(n), lx = -0.7071, ly = -0.7071;
  for (let i = 0; i < n; i++) {
    if (c.h[i] <= 0) continue;
    let gx = 0, gy = 0, sxx = 0, syy = 0;
    for (const j of mesh.nbr[i]) { const dx = mesh.px[j] - mesh.px[i], dy = mesh.py[j] - mesh.py[i], dh = Math.max(0, c.h[j]) - c.h[i]; gx += dh * dx; gy += dh * dy; sxx += dx * dx; syy += dy * dy; }
    gx /= sxx || 1; gy /= syy || 1;
    hs[i] = clamp((gx * lx + gy * ly) * mesh.spacing * 9, -1, 1);
  }
  // cell colour groups
  const landG = new Map(), waterG = new Map();
  const push = (g, col, ring) => { let a = g.get(col); if (!a) g.set(col, (a = [])); a.push(ring); };
  for (let i = 0; i < n; i++) {
    if (c.h[i] <= 0) { const lvl = Math.round(clamp(-c.h[i] * 1.4) * 6) / 6; push(waterG, mix(ES.waterShallow, ES.waterDeep, lvl), mesh.polys[i]); continue; }
    if (c.lake[i]) { push(landG, ES.biomes.lake, mesh.polys[i]); continue; }
    const base = ES.biomes[BIOMES[c.biome[i]].key] || '#999999';
    const lvl = Math.round(hs[i] * ES.hillshade * 6) / 6 * 0.28 + (c.h[i] > 0.55 ? 0.06 : 0);
    push(landG, lvl ? shade(base, lvl) : base, mesh.polys[i]);
  }
  D.landG = landG; D.waterG = waterG;
  // contours
  const band = (h) => (h > 0 ? Math.floor(h * 7) : -1);
  D.contours = chain(edgeSegs(mesh, (a, b) => c.h[a] > 0 && c.h[b] > 0 && band(c.h[a]) !== band(c.h[b]))).map((l) => chaikin(l.pts, l.closed, 2));
  const dband = (h) => Math.floor(-h * 4);
  D.oceanContours = chain(edgeSegs(mesh, (a, b) => c.h[a] <= 0 && c.h[b] <= 0 && dband(c.h[a]) !== dband(c.h[b]))).map((l) => chaikin(l.pts, l.closed, 2));
  buildRelief(mesh, P, ES, D, hs);
  buildZones(mesh, P, D);
  buildAtmosphere(mesh, P, D);
  return D;
}

/** Zone-dependent geometry (state borders, known-world edge, overlay groups). */
export function buildZones(mesh, P, D) {
  const c = P.cells;
  const landNL = (i) => !isWater(P, i);
  D.borders = chain(edgeSegs(mesh, (a, b) => landNL(a) && landNL(b) && c.state[a] !== c.state[b])).map((l) => ({ pts: chaikin(l.pts, l.closed, 1), closed: l.closed }));
  D.knownEdge = chain(edgeSegs(mesh, (a, b) => c.known[a] >= 0.45 !== c.known[b] >= 0.45 && !mesh.border[a] && !mesh.border[b])).map((l) => chaikin(l.pts, l.closed, 2));
  D.overlays = {};
  // state label anchors (pole of inaccessibility approximated by the most interior cell)
  const st = P.states.map(() => ({ sx: 0, sy: 0, k: 0 }));
  for (let i = 0; i < mesh.n; i++) { const s = c.state[i]; if (s > 0 && landNL(i) && st[s]) { st[s].sx += mesh.px[i]; st[s].sy += mesh.py[i]; st[s].k++; } }
  D.stateLabels = P.states.map((s, i) => (i > 0 && st[i] && st[i].k > 8 ? { x: st[i].sx / st[i].k, y: st[i].sy / st[i].k, name: s.name, k: st[i].k } : null)).filter(Boolean);
}

function overlayGroups(mesh, P, D, key) {
  if (D.overlays[key]) return D.overlays[key];
  const c = P.cells, g = new Map();
  const push = (col, ring) => { let a = g.get(col); if (!a) g.set(col, (a = [])); a.push(ring); };
  const ramp = (t, stops) => { t = clamp(t); const k = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1))); return mix(stops[k], stops[k + 1], t * (stops.length - 1) - k); };
  for (let i = 0; i < mesh.n; i++) {
    const L = !isWater(P, i);
    let col = null;
    if (key === 'political') { if (L && c.state[i] > 0) col = P.states[c.state[i]]?.color; }
    else if (key === 'religious') { if (L && c.religion[i] > 0) col = P.religions[c.religion[i]]?.color; }
    else if (key === 'races') { if (L && c.race[i] > 0) col = P.races[c.race[i]]?.color; }
    else if (key === 'mana') { const v = Math.round(c.mana[i] * 8) / 8; if (v > 0.12) col = ramp(v, ['#1d2b6b', '#3a52c9', '#7b4fd6', '#d65bd1', '#ffd1f4']) + '|' + v; }
    else if (key === 'doomsday') { const v = Math.round(c.threat[i] * 8) / 8; if (v > 0.12) col = ramp(v, ['#5a1a10', '#a3261a', '#e0462a', '#ff9a3c']) + '|' + v; }
    else if (key === 'heroview') { const v = Math.round((1 - c.known[i]) * 6) / 6; if (v > 0.05) col = v; }
    else if (key === 'fog') { const v = Math.round(clamp((0.3 - c.known[i]) / 0.3) * 6) / 6; if (v > 0.05) col = v; }
    if (col != null) push(col, mesh.polys[i]);
  }
  D.overlays[key] = g; return g;
}

function buildRelief(mesh, P, ES, D, hs) {
  const c = P.cells, rng = makeRng(P.settings.seed + '|relief'), sp = mesh.spacing, dens = ES.reliefDensity ?? 1;
  const busy = new Uint8Array(mesh.n);
  for (const f of P.features) { const i = f.cell ?? -1; if (i >= 0 && i < mesh.n) { busy[i] = 1; for (const j of mesh.nbr[i]) busy[j] = 1; } }
  const R = { mtns: [], hFill: [], hLine: [], tFill: [], tLine: [], trunk: [], pFill: [], palm: [], tuft: [], dune: [], rock: [], crystal: [], ice: [] };
  const items = [];
  for (let i = 0; i < mesh.n; i++) {
    if (isWater(P, i)) continue;
    const type = BIOMES[c.biome[i]].relief; if (!type) continue;
    const r = () => rng();
    const jx = () => (r() - 0.5) * sp * 0.7;
    const prob = { mountain: 0.85, snowmountain: 0.85, hill: 0.5, tree: 0.75, bigtree: 0.85, pine: 0.7, palm: 0.8, grass: 0.1, swamp: 0.45, dune: 0.3, rock: 0.22, storm: 0.25, crystal: 0.7, ice: 0.08 }[type] * dens;
    const reps = ['tree', 'bigtree', 'pine', 'palm'].includes(type) ? 2 : 1;
    for (let k = 0; k < reps; k++) {
      if (r() > prob) continue;
      if (busy[i] && !['mountain', 'snowmountain'].includes(type)) continue;
      items.push({ type, x: mesh.px[i] + jx(), y: mesh.py[i] + jx(), h: c.h[i], s: r() });
    }
  }
  items.sort((a, b) => a.y - b.y);
  for (const it of items) {
    const { x, y } = it;
    switch (it.type) {
      case 'mountain': case 'snowmountain': {
        const s = sp * (0.75 + it.s * 0.4) * (0.75 + Math.min(1, it.h) * 0.6), h = s * (1.05 + it.s * 0.3), px = x + (it.s - 0.5) * s * 0.3;
        R.mtns.push({ fill: [x - s, y, px, y - h, x + s, y], shade: [px, y - h, x + s, y, px + s * 0.12, y], line: [x - s, y, px, y - h, x + s, y],
          snow: it.type === 'snowmountain' || it.h > 0.8 ? [px, y - h, px - s * 0.32, y - h * 0.62, px - s * 0.1, y - h * 0.7, px + s * 0.05, y - h * 0.58, px + s * 0.3, y - h * 0.66] : null });
        break;
      }
      case 'hill': {
        const s = sp * (0.45 + it.s * 0.25), arc = [];
        for (let a = 0; a <= 6; a++) { const t = Math.PI - (a / 6) * Math.PI; arc.push(x + Math.cos(t) * s, y - Math.sin(t) * s * 0.55); }
        R.hFill.push(arc); R.hLine.push(arc); break;
      }
      case 'tree': case 'bigtree': {
        const s = sp * (it.type === 'bigtree' ? 0.32 : 0.25) * (0.85 + it.s * 0.3);
        R.trunk.push([x, y, x, y - s * 0.9]);
        const ring = ringPoly(x, y - s * 1.5, s, 8, it.s, 1.1); R.tFill.push(ring); R.tLine.push(ring); break;
      }
      case 'pine': {
        const s = sp * 0.24 * (0.85 + it.s * 0.3);
        R.trunk.push([x, y, x, y - s * 0.5]);
        const tri = [x - s * 0.75, y - s * 0.4, x, y - s * 2.4, x + s * 0.75, y - s * 0.4]; R.pFill.push(tri); R.tLine.push(tri); break;
      }
      case 'palm': {
        const s = sp * 0.27 * (0.85 + it.s * 0.3);
        const ring = ringPoly(x, y - s, s, 9, it.s * 3, 0.85); R.palm.push(ring); R.tLine.push(ring); break;
      }
      case 'grass': case 'storm': { const s = sp * 0.16; R.tuft.push([x - s, y - s * 0.8, x - s * 0.3, y], [x, y - s * 1.1, x, y], [x + s, y - s * 0.8, x + s * 0.3, y]); break; }
      case 'swamp': { const s = sp * 0.2; R.tuft.push([x - s, y, x + s, y], [x - s * 0.5, y - s * 0.9, x - s * 0.3, y], [x + s * 0.4, y - s, x + s * 0.2, y]); break; }
      case 'dune': { const s = sp * 0.3; R.dune.push([x - s, y, x - s * 0.4, y - s * 0.35, x + s * 0.2, y - s * 0.2, x + s, y]); break; }
      case 'rock': R.rock.push(ringPoly(x, y, sp * 0.08 * (1 + it.s), 5, it.s * 6)); break;
      case 'crystal': { const s = sp * 0.22; R.crystal.push([x, y - s * 1.6, x + s * 0.45, y - s * 0.4, x, y, x - s * 0.45, y - s * 0.4]); break; }
      case 'ice': { const s = sp * 0.25; R.ice.push([x - s, y, x - s * 0.2, y - s * 0.2, x + s * 0.3, y + s * 0.1, x + s, y - s * 0.1]); break; }
    }
  }
  D.relief = R;
}

function buildAtmosphere(mesh, P, D) {
  D.storm = null;
  if (!P.settings.lore) return;
  const c = P.cells, si = LORE_REGIONS.findIndex((r) => r.key === 'storm');
  let sx = 0, sy = 0, k = 0;
  for (let i = 0; i < mesh.n; i++) if (c.region[i] === si) { sx += mesh.px[i]; sy += mesh.py[i]; k++; }
  if (!k) return;
  const cx = sx / k + mesh.W * 0.03, cy = sy / k + mesh.H * 0.03, rng = makeRng(P.settings.seed + '|storm'), W = mesh.W;
  const arcs = [], clouds = [], bolts = [];
  for (let a = 0; a < 9; a++) {
    const r0 = W * (0.03 + a * 0.012), start = rng() * Math.PI * 2, len = 1.2 + rng() * 1.6, pts = [];
    for (let t = 0; t <= 24; t++) { const ang = start + (t / 24) * len, r = r0 * (1 + t / 60); pts.push(cx + Math.cos(ang) * r * 1.25, cy + Math.sin(ang) * r * 0.85); }
    arcs.push(pts);
  }
  for (let q = 0; q < 26; q++) { const ang = rng() * Math.PI * 2, r = W * 0.13 * Math.sqrt(rng()); clouds.push({ x: cx + Math.cos(ang) * r * 1.2, y: cy + Math.sin(ang) * r * 0.8, r: W * (0.015 + rng() * 0.03) }); }
  for (let b = 0; b < 4; b++) {
    let x = cx + (rng() - 0.5) * W * 0.18, y = cy + (rng() - 0.5) * W * 0.1; const pts = [x, y];
    for (let s = 0; s < 4; s++) { x += (rng() - 0.5) * 10; y += 7 + rng() * 6; pts.push(x, y); }
    bolts.push(pts);
  }
  D.storm = { cx, cy, arcs, clouds, bolts, r: W * 0.15 };
}

// ------------------------------------------------------------------ painting
const DEFAULT_LAYERS = { terrain: true, relief: true, rivers: true, coast: true, borders: true, roads: true, settlements: true, markers: true, labels: true, stamps: true, drawings: true, atmosphere: true, decor: true };
export const LAYER_LIST = [
  ['terrain', 'Terrain & biomes'], ['relief', 'Relief icons (mountains, trees)'], ['rivers', 'Rivers & lakes'], ['coast', 'Coast effects'], ['borders', 'State borders'],
  ['roads', 'Roads & routes'], ['settlements', 'Settlements'], ['markers', 'Lore markers'], ['labels', 'Labels'], ['stamps', 'Stamps'], ['drawings', 'Drawings'],
  ['atmosphere', 'Fog, storms & paper'], ['decor', 'Scale bar & frame'],
];
export const OVERLAY_LIST = [
  ['political', 'Political (states)'], ['religious', 'Religious (Church vs Order)'], ['races', 'Race distribution'], ['doomsday', 'Doomsday breach zones'],
  ['lumenari', 'Lumenari sites'], ['dungeons', 'Dungeon / relic sites'], ['trade', 'Trade routes'], ['mana', 'Mana density'], ['heroview', "Hero's View (known vs unexplored)"], ['grid', 'Cell grid (editing aid)'],
];

export function renderMap(pt, mesh, P, D, ES, opts = {}) {
  const L = { ...DEFAULT_LAYERS, ...(opts.layers || {}) }, O = opts.overlays || {};
  const W = mesh.W, H = mesh.H, c = P.cells, scale = pt.scale || 1;
  const vis = opts.view || { x0: 0, y0: 0, x1: W, y1: H };
  const inView = (x, y, pad = 40) => x > vis.x0 - pad && x < vis.x1 + pad && y > vis.y0 - pad && y < vis.y1 + pad;
  const dark = ES.palette === 'stormy';

  // 1. water
  pt.rect(0, 0, W, H, { fill: ES.waterShallow });
  if (L.terrain) for (const [col, rings] of D.waterG) pt.poly(rings, { fill: col, stroke: col, width: 0.6 });
  if (ES.oceanContours && L.coast) pt.lines(D.oceanContours, { stroke: ES.rippleColor, width: 0.6, alpha: 0.18 });
  // 2. coast ripples
  if (L.coast && ES.ripples) {
    if (ES.presetDef.ripples === 'ink') {
      for (const [w, a] of [[16, 0.8], [9, 0.9]]) { pt.lines(D.coast, { stroke: ES.rippleColor, width: w + 1.1, alpha: a }); pt.lines(D.coast, { stroke: ES.waterShallow, width: w }); }
    } else if (ES.presetDef.ripples === 'glow') {
      pt.lines(D.coast, { stroke: ES.rippleColor, width: 14, alpha: 0.08 }); pt.lines(D.coast, { stroke: ES.rippleColor, width: 7, alpha: 0.14 });
    } else {
      for (const [w, a] of [[24, 0.07], [15, 0.1], [7, 0.16]]) pt.lines(D.coast, { stroke: ES.rippleColor, width: w, alpha: a });
    }
  }
  // 3. land
  pt.clip(D.coast, 'evenodd');
  pt.rect(0, 0, W, H, { fill: ES.biomes.plains });
  if (L.terrain) for (const [col, rings] of D.landG) pt.poly(rings, { fill: col, stroke: col, width: 0.6 });
  if (ES.contours) pt.lines(D.contours, { stroke: ES.reliefInk, width: 0.45, alpha: 0.35 });
  // overlays (cell fills)
  const cellOverlay = (key, alphaMul = 1) => {
    const g = overlayGroups(mesh, P, D, key);
    pt.group({ alpha: (ES.overlayOpacity ?? 0.55) * alphaMul });
    for (const [col, rings] of g) { const [cc] = String(col).split('|'); pt.poly(rings, { fill: cc, stroke: cc, width: 0.6 }); }
    pt.ungroup();
  };
  if (O.political) cellOverlay('political');
  if (O.religious) cellOverlay('religious');
  if (O.races) cellOverlay('races');
  pt.unclip();
  if (O.mana) { const g = overlayGroups(mesh, P, D, 'mana'); pt.group({ alpha: ES.overlayOpacity ?? 0.55, blur: 3 }); for (const [col, rings] of g) { const [cc, v] = col.split('|'); pt.poly(rings, { fill: cc, stroke: cc, width: 0.6, alpha: Math.min(1, +v * 1.2) }); } pt.ungroup(); }
  if (O.doomsday) { const g = overlayGroups(mesh, P, D, 'doomsday'); pt.group({ alpha: ES.overlayOpacity ?? 0.55, blur: 2.5 }); for (const [col, rings] of g) { const [cc, v] = col.split('|'); pt.poly(rings, { fill: cc, stroke: cc, width: 0.6, alpha: Math.min(1, +v * 1.3) }); } pt.ungroup(); }

  // 4. rivers & lakes
  if (L.rivers) {
    pt.lines(D.lakeShore, { stroke: ES.coast, width: 0.7, alpha: 0.7 });
    const byW = new Map();
    for (const r of P.rivers) {
      const p = smoothLine(r.pts, 2), m = p.length / 2, np = r.pts.length;
      const wmul = r.widthScale || 1;
      for (let k = 0; k < m - 1; k++) {
        const t = (k / (m - 1)) * (np - 1), w = (r.w ? r.w[Math.min(np - 1, Math.round(t))] : 1.2) * wmul;
        const q = Math.round(w * 4) / 4; let a = byW.get(q); if (!a) byW.set(q, (a = [])); a.push([p[2 * k], p[2 * k + 1], p[2 * k + 2], p[2 * k + 3]]);
      }
    }
    for (const [w, segs] of byW) pt.lines(segs, { stroke: ES.river, width: w });
  }
  if (L.coast) pt.lines(D.coast, { stroke: ES.coast, width: ES.presetDef.coastWidth });
  if (O.grid) pt.poly(mesh.polys, { stroke: dark ? '#ffffff' : '#000000', width: 0.25, alpha: 0.25 });

  // 5. borders
  if (L.borders || O.political) {
    if (O.political) for (const b of D.borders) pt.lines([b.pts], { stroke: ES.border, width: 3.2, alpha: 0.25 });
    pt.lines(D.borders.map((b) => b.pts), { stroke: ES.border, width: 1.1, dash: [4, 2.5], alpha: 0.9 });
  }
  if (O.heroview) { pt.lines(D.knownEdge, { stroke: '#f2c14e', width: 2.6, alpha: 0.35 }); pt.lines(D.knownEdge, { stroke: dark ? '#f2c14e' : '#6b4a12', width: 1, dash: [6, 3] }); }

  // 6. relief glyphs
  if (L.relief && ES.relief) drawRelief(pt, D.relief, ES);

  // 7. roads / routes / manual borders
  if (L.roads) {
    for (const l of P.lines) {
      if (!l.pts || l.pts.length < 2) continue;
      const p = l.kind === 'sea' || l.kind === 'border' ? smoothLine(l.pts, 3) : smoothLine(l.pts, 2);
      const st = lineStyle(l, ES, O);
      if (st.under) pt.lines([p], st.under);
      pt.lines([p], st);
    }
  }
  // 8. drawings
  if (L.drawings) for (const d of P.drawings) { const p = smoothLine(d.pts, 1); if (d.fill) pt.poly([p], { fill: d.color, alpha: (d.opacity ?? 1) * 0.35 }); pt.lines([p], { stroke: d.color, width: d.width || 2, alpha: d.opacity ?? 1, dash: d.dash ? [d.width * 3, d.width * 2] : null }); }

  // 9. overlays with point emphasis
  const glow = (kinds, color, rad) => { for (const f of P.features) if (kinds.includes(f.kind)) pt.gradientRect(f.x - rad, f.y - rad, rad * 2, rad * 2, { type: 'radial', cx: f.x, cy: f.y, r0: 0, r1: rad, stops: [[0, rgba(color, 0.55)], [0.5, rgba(color, 0.18)], [1, rgba(color, 0)]] }); };
  if (O.lumenari) { glow(['lumenari'], '#7fe3ff', W * 0.035); for (const f of P.features) if (f.kind === 'lumenari') { pt.circle(f.x, f.y, W * 0.022, { stroke: '#7fe3ff', width: 1, dash: [2, 2], alpha: 0.9 }); } }
  if (O.dungeons) { glow(['dungeon', 'relic', 'ruins'], '#c890ff', W * 0.02); for (const f of P.features) if (['dungeon', 'relic', 'ruins'].includes(f.kind)) pt.circle(f.x, f.y, W * 0.012, { stroke: '#8e44ad', width: 1.2, alpha: 0.9 }); }
  if (O.doomsday) glow(['breach'], '#ff3b1f', W * 0.04);
  if (O.religious) for (const f of P.features) if (f.kind === 'crimson') pt.circle(f.x, f.y, W * 0.018, { stroke: '#b3261e', width: 1.4, dash: [3, 2] });

  // 10. stamps
  if (L.stamps) for (const s of P.stamps) if (inView(s.x, s.y, s.size)) pt.icon(s.asset, s.x, s.y, s.size, s.rot || 0, s.opacity ?? 1);

  // 11. hero's view fog (below labels so names stay readable)
  if (O.heroview) {
    const g = overlayGroups(mesh, P, D, 'heroview');
    pt.group({ blur: 4 });
    for (const [v, rings] of g) pt.poly(rings, { fill: dark ? '#05070a' : '#3b3428', stroke: dark ? '#05070a' : '#3b3428', width: 0.8, alpha: v * 0.82 });
    pt.ungroup();
  }

  // 11b. atmosphere: storms, unexplored fog, edge fog (below names & labels)
  if (L.atmosphere) {
    if (P.settings.lore && D.storm && !O.heroview) {
      const S = D.storm;
      pt.group({ blur: 6, alpha: dark ? 0.6 : 0.5 });
      for (const cl of S.clouds) pt.circle(cl.x, cl.y, cl.r, { fill: dark ? '#0a0e13' : '#5b5f66', alpha: 0.5 });
      pt.ungroup();
      pt.lines(S.arcs, { stroke: dark ? '#9fb6c9' : '#3f4550', width: 1.3, alpha: 0.55, dash: [10, 4] });
      pt.lines(S.bolts, { stroke: dark ? '#ffe28a' : '#d8a520', width: 1.4, alpha: 0.9 });
    }
    if (!O.heroview && P.settings.lore) {
      const g = overlayGroups(mesh, P, D, 'fog');
      pt.group({ blur: 7 });
      for (const [v, rings] of g) pt.poly(rings, { fill: ES.fog, stroke: ES.fog, width: 1, alpha: v * 0.92 });
      pt.ungroup();
    }
    const fogA = P.settings.lore ? 0.9 : 0.5, ew = W * 0.07, fc = ES.fog;
    pt.gradientRect(0, 0, ew, H, { x1: 0, y1: 0, x2: ew, y2: 0, stops: [[0, rgba(fc, fogA)], [1, rgba(fc, 0)]] });
    pt.gradientRect(W - ew, 0, ew, H, { x1: W, y1: 0, x2: W - ew, y2: 0, stops: [[0, rgba(fc, fogA)], [1, rgba(fc, 0)]] });
    pt.gradientRect(0, 0, W, ew, { x1: 0, y1: 0, x2: 0, y2: ew, stops: [[0, rgba(fc, fogA)], [1, rgba(fc, 0)]] });
    pt.gradientRect(0, H - ew, W, ew, { x1: 0, y1: H, x2: 0, y2: H - ew, stops: [[0, rgba(fc, fogA)], [1, rgba(fc, 0)]] });
  }

  // 12. features
  const iconScale = ES.iconScale || 1;
  for (const f of P.features) {
    const K = FEATURE_KINDS[f.kind]; if (!K) continue;
    if (K.cat === 'settlement' ? !L.settlements : !L.markers) continue;
    if (!inView(f.x, f.y)) continue;
    const size = K.size * (f.size || 1) * iconScale;
    if (opts.screen && size * scale < 3) continue;
    pt.icon(K.icon, f.x, f.y, size);
  }
  if (L.labels) for (const f of P.features) {
    const K = FEATURE_KINDS[f.kind]; if (!K || !f.name || f.hideName) continue;
    if (K.cat === 'settlement' ? !L.settlements : !L.markers) continue;
    if (!inView(f.x, f.y)) continue;
    const fs = K.name * (f.size || 1) * Math.sqrt(iconScale);
    if (opts.screen && fs * scale < 6.5) continue;
    const size = K.size * (f.size || 1) * iconScale;
    const isCap = f.kind === 'capital';
    pt.text(isCap ? f.name.toUpperCase() : f.name, f.x, f.y + size * 0.55 + fs * 0.7, { size: fs, family: isCap ? ES.titleFamily : ES.fontFamily, weight: isCap || f.kind === 'city' ? 'bold' : 'normal', italic: K.cat === 'marker', color: ES.text, halo: ES.halo || ES.presetDef.halo, spacing: isCap ? 1.5 : 0.2 });
  }

  // 13. state names (political overlay)
  if (O.political) for (const s of D.stateLabels) pt.text(s.name.toUpperCase(), s.x, s.y + 22, { size: Math.min(20, 8 + Math.sqrt(s.k) * 0.35), family: ES.titleFamily, color: ES.border, halo: ES.presetDef.halo, spacing: 3, alpha: 0.85 });

  // 14. labels
  if (L.labels) for (const lb of P.labels) {
    if (!lb.text) continue;
    const fam = lb.font === 'title' ? ES.titleFamily : lb.font === 'sans' ? '\'Inter\',\'Segoe UI\',Helvetica,Arial,sans-serif' : lb.font === 'script' ? "'Brush Script MT','URW Chancery L',Z003,cursive" : ES.fontFamily;
    const st = { size: lb.size || 14, family: fam, italic: !!lb.italic, color: lb.color || ES.text, halo: ES.presetDef.halo, haloWidth: (lb.size || 14) * 0.22, spacing: lb.spacing || 0, rot: lb.rot || 0, weight: lb.bold || lb.kind === 'title' ? 'bold' : 'normal', alpha: lb.kind === 'ocean' ? 0.8 : 1 };
    if (lb.kind === 'ocean') { st.color = lb.color || (dark ? '#9fb6c9' : mix(ES.text, ES.waterDeep, 0.35)); st.halo = null; }
    if (lb.kind === 'region' && !lb.color) st.color = mix(ES.text, ES.border, 0.25);
    pt.text(lb.text, lb.x, lb.y, st);
    if (lb.kind === 'title') {
      const w = pt.measure(lb.text, st) / 2 + 10, y = lb.y + st.size * 0.62;
      pt.lines([[lb.x - w, y, lb.x - 6, y], [lb.x + 6, y, lb.x + w, y]], { stroke: st.color, width: 1.2 });
      pt.poly([[lb.x, y - 4, lb.x + 4, y, lb.x, y + 4, lb.x - 4, y]], { fill: st.color });
    }
  }

  // 15. paper texture & vignette
  if (L.atmosphere) {
    if (ES.paperTexture > 0) pt.paper(0, 0, W, H, ES.paperTexture);
    if (ES.vignette > 0) pt.gradientRect(0, 0, W, H, { type: 'radial', cx: W / 2, cy: H / 2, r0: Math.min(W, H) * 0.35, r1: Math.hypot(W, H) * 0.56, stops: [[0, 'rgba(0,0,0,0)'], [1, `rgba(${dark ? '0,0,0' : '60,40,15'},${ES.vignette * 0.55})`]] });
  }
  // 16. decor: frame + scale bar
  if (L.decor) {
    const fr = dark ? '#c9b98f' : ES.coast;
    pt.rect(4, 4, W - 8, H - 8, { stroke: fr, width: 2.2 });
    pt.rect(9, 9, W - 18, H - 18, { stroke: fr, width: 0.7 });
    const bx = W - 230, by = H - 34, unit = 50;
    for (let k = 0; k < 4; k++) pt.rect(bx + k * unit, by, unit, 5, { fill: k % 2 ? ES.presetDef.halo : fr, stroke: fr, width: 0.8 });
    ['0', '100', '200 leagues'].forEach((t, k) => pt.text(t, bx + k * unit * 2, by + 15, { size: 9, family: ES.fontFamily, color: ES.text, align: k === 2 ? 'left' : 'center', italic: true }));
  }
}

function lineStyle(l, ES, O) {
  const tr = O.trade && (l.kind === 'trade' || l.kind === 'sea');
  switch (l.kind) {
    case 'trade': return { stroke: tr ? '#d4a017' : ES.road, width: tr ? 2.2 : 1.3, dash: tr ? null : [5, 2.5], alpha: 0.95, under: tr ? { stroke: '#000', width: 3.6, alpha: 0.25 } : null };
    case 'road': return { stroke: ES.road, width: 0.9, dash: [3.5, 2.5], alpha: 0.9 };
    case 'path': return { stroke: ES.road, width: 0.6, dash: [1.5, 2.2], alpha: 0.8 };
    case 'sea': return { stroke: tr ? '#d4a017' : ES.road, width: tr ? 1.8 : 0.9, dash: [6, 4], alpha: tr ? 0.95 : 0.6 };
    case 'border': return { stroke: l.color || ES.border, width: l.width || 1.6, dash: [8, 3, 2, 3], alpha: 0.95 };
    case 'wall': return { stroke: l.color || ES.coast, width: l.width || 2.4, dash: null, alpha: 1 };
    case 'front': return { stroke: l.color || '#b3261e', width: l.width || 2, dash: [2, 3], alpha: 1 };
    default: return { stroke: l.color || ES.road, width: l.width || 1, dash: [3, 2] };
  }
}

function drawRelief(pt, R, ES) {
  const ink = ES.reliefInk, fill = ES.reliefFill, pal = ES.presetDef.palette;
  const colored = pal === 'modern' || pal === 'contrast' || pal === 'stormy';
  const treeFill = pal === 'ink' ? fill : colored ? shade(ES.biomes.forest, pal === 'stormy' ? 0.1 : -0.15) : mix(ES.biomes.forest, '#5f7a3f', 0.45);
  const pineFill = pal === 'ink' ? fill : colored ? shade(ES.biomes.taiga, -0.15) : mix(ES.biomes.taiga, '#4d6646', 0.45);
  const palmFill = pal === 'ink' ? fill : colored ? shade(ES.biomes.jungle, -0.1) : mix(ES.biomes.jungle, '#3f6a35', 0.5);
  const mtnFill = pal === 'ink' ? fill : colored ? shade(ES.biomes.mountain, 0.15) : mix(ES.biomes.mountain, fill, 0.45);
  const lw = pal === 'contrast' ? 0.9 : 0.6;
  pt.poly(R.hFill, { fill: pal === 'ink' ? fill : shade(ES.biomes.hills, 0.05) });
  pt.lines(R.hLine, { stroke: ink, width: lw, alpha: 0.85 });
  pt.lines(R.trunk, { stroke: ink, width: lw * 1.1, alpha: 0.9 });
  pt.poly(R.tFill.concat(R.pFill.length ? [] : []), { fill: treeFill });
  pt.poly(R.pFill, { fill: pineFill });
  pt.poly(R.palm, { fill: palmFill });
  pt.poly(R.tLine, { stroke: ink, width: lw * 0.85, alpha: 0.8 });
  pt.lines(R.tuft, { stroke: ink, width: lw * 0.7, alpha: 0.45 });
  pt.lines(R.dune, { stroke: ink, width: lw * 0.8, alpha: 0.5 });
  pt.poly(R.rock, { fill: ink, alpha: 0.35 });
  pt.lines(R.ice, { stroke: ink, width: lw * 0.6, alpha: 0.35 });
  pt.poly(R.crystal, { fill: '#c9a6ff', stroke: ink, width: lw * 0.8 });
  const shadeA = pal === 'ink' ? 0.55 : 0.28;
  for (const m of R.mtns) {
    pt.poly([m.fill], { fill: mtnFill });
    pt.poly([m.shade], { fill: ink, alpha: shadeA });
    if (m.snow) pt.poly([m.snow], { fill: '#ffffff', alpha: 0.9 });
    pt.lines([m.line], { stroke: ink, width: lw * 1.2, alpha: 0.95 });
  }
}

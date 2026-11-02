// Aleria Map Generator — application shell: state, rendering loop, tools, panels.
import { generateWorld, recomputeEnvironment, computeClimate, assignBiomes, findCell, findPath, biomeFor, repopulate, DEFAULT_SETTINGS, REGION_NONE, uid, isWater } from './generator.js';
import { BIOMES, B } from './biomes.js';
import { STYLE_PRESETS, defaultStyle, effectiveStyle, ICON_PALETTES } from './styles.js';
import { ASSETS, ASSET_MAP, FEATURE_KINDS, AssetStore, assetSvg } from './assets.js';
import { CanvasPainter } from './painter.js';
import { buildDerived, buildZones, renderMap, LAYER_LIST, OVERLAY_LIST, smoothLine } from './render.js';
import { NameGen } from './names.js';
import { makeRng } from './rng.js';
import * as io from './io.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ------------------------------------------------------------------ state
const app = (window.aleria = {
  mesh: null, P: null, D: null, ES: null, view: { x: 0, y: 0, k: 1 }, tool: 'select', sel: [], cache: null, cacheDirty: true,
  interactingUntil: 0, draft: null, stroke: null, box: null, mouseW: null, pool: [], names: new NameGen(makeRng('names|' + Date.now())),
});
const opts = (app.opts = {
  brush: 30, strength: 0.5, biome: 'forest', zoneTarget: 'state', zoneValue: 1, zoneAmount: 1, placeKind: 'town', routeKind: 'road', autoPath: true,
  drawColor: '#7a1f12', drawWidth: 2, drawFill: false, drawDash: false, stamp: 'tree', stampSize: 24, stampRot: 0, labelSize: 16, labelFont: 'serif',
});
const DEFAULT_LAYERS = Object.fromEntries(LAYER_LIST.map(([k]) => [k, true]));
const DEFAULT_NOTES = {
  capital: 'Capital city.', fortress: 'Fortified frontier.', temple: 'Church of Ucliat temple.', dungeon: 'Dungeon entrance. Lost Magic relics are said to lie within.',
  ruins: 'Ancient ruins.', relic: 'Relic site: Lost Magic artefacts (appraisal required).', lumenari: 'Lumenari manifestation: cracked stone humanoids with glowing cracks; unstable mana.',
  breach: 'Doomsday underworld breach point. Monster flood zone.', crimson: 'Hidden Crimson Sun Order laboratory.', knights: 'Church Knights garrison.',
  summoning: 'Summoning circle.', monster: 'Monster lair.', military: 'Military position.',
};
const LORE_TAGS = [['church', 'Church of Ucliat presence'], ['appraisal', 'Relic appraisal site'], ['orderLab', 'Crimson Sun Order laboratory'], ['summoningSite', 'Summoning site'], ['garrison', 'Church Knights garrison'], ['hidden', 'Hidden / secret']];

// ------------------------------------------------------------------ history (undo/redo)
const history = {
  undo: [], redo: [], limit: 50,
  push(label) { this.undo.push({ label, snap: structuredClone(app.P) }); if (this.undo.length > this.limit) this.undo.shift(); this.redo = []; updateUndoButtons(); },
  doUndo() { const e = this.undo.pop(); if (!e) return; this.redo.push({ label: e.label, snap: structuredClone(app.P) }); restore(e.snap); toast(`Undid: ${e.label}`); },
  doRedo() { const e = this.redo.pop(); if (!e) return; this.undo.push({ label: e.label, snap: structuredClone(app.P) }); restore(e.snap); toast(`Redid: ${e.label}`); },
  clear() { this.undo = []; this.redo = []; updateUndoButtons(); },
};
app.history = history;
function restore(P) { app.P = P; app.sel = []; app.draft = null; refreshStyle(); rebuildAll(); renderPanels(); updateUndoButtons(); }
function updateUndoButtons() { $('#btnUndo').disabled = !history.undo.length; $('#btnRedo').disabled = !history.redo.length; $('#btnUndo').dataset.tip = history.undo.length ? `Undo “${history.undo.at(-1).label}” (Ctrl+Z)` : 'Undo (Ctrl+Z)'; }

// ------------------------------------------------------------------ world lifecycle
function showLoading(t = 'Forging Kremantin…') { const l = $('#loading'); l.textContent = t; l.classList.remove('hidden'); }
function hideLoading() { $('#loading').classList.add('hidden'); }

function newWorld(S, { keepStyle = true, overlays = null, style = null } = {}) {
  showLoading(S.lore ? 'Forging Kremantin…' : 'Shaping a new world…');
  return new Promise((resolve) => setTimeout(() => {
    try {
      const t0 = performance.now();
      const { mesh, P } = generateWorld(S);
      P.style = keepStyle && app.P?.style ? { ...app.P.style } : defaultStyle('parchment');
      if (style && STYLE_PRESETS[style]) P.style = { ...defaultStyle(style) };
      P.view = { layers: { ...DEFAULT_LAYERS, ...(app.P?.view?.layers || {}) }, overlays: overlays ? Object.fromEntries(overlays.map((o) => [o, true])) : { ...(app.P?.view?.overlays || {}) } };
      setProject(mesh, P);
      history.clear(); fitView();
      if ($('#styleSelect')) $('#styleSelect').value = P.style.preset;
      status(`Generated ${S.lore ? 'Kremantin (lore mode)' : 'freeform world'} · seed “${S.seed}” · ${mesh.n} cells in ${Math.round(performance.now() - t0)} ms`);
    } catch (err) { console.error(err); toast('Generation failed: ' + err.message, true); }
    hideLoading(); resolve();
  }, 30));
}
app.newWorld = newWorld;
function setProject(mesh, P) {
  app.mesh = mesh; app.P = P; app.sel = []; app.draft = null;
  if (!P.style) P.style = defaultStyle();
  if (!P.view) P.view = { layers: { ...DEFAULT_LAYERS }, overlays: {} };
  P.view.layers = { ...DEFAULT_LAYERS, ...P.view.layers };
  app.assets.setCustom(P.customAssets);
  refreshStyle(); rebuildAll(); renderPanels(); updateSeed();
}
app.setProject = setProject;
function refreshStyle() { app.ES = effectiveStyle(app.P.style); }
function rebuildAll() { app.D = buildDerived(app.mesh, app.P, app.ES); contentChanged(); }
function zonesChanged() { buildZones(app.mesh, app.P, app.D); contentChanged(); }
function contentChanged() { app.cacheDirty = true; scheduleMinimap(); scheduleAutosave(); requestRender(); }

// ------------------------------------------------------------------ rendering
const cv = $('#map'), ctx = cv.getContext('2d');
let dpr = 1, rafPending = false;
function resize() {
  const r = cv.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
  app.cw = r.width; app.ch = r.height; requestRender();
}
function requestRender() { if (!rafPending) { rafPending = true; requestAnimationFrame(draw); } }
function visibleRect() { const { x, y, k } = app.view; return { x0: -x / k, y0: -y / k, x1: (app.cw - x) / k, y1: (app.ch - y) / k }; }
function buildCache() {
  const { mesh } = app, s = Math.min(2, 4096 / mesh.W);
  if (!app.cache) app.cache = document.createElement('canvas');
  app.cache.width = Math.round(mesh.W * s); app.cache.height = Math.round(mesh.H * s);
  const c2 = app.cache.getContext('2d'); c2.setTransform(s, 0, 0, s, 0, 0);
  renderMap(new CanvasPainter(c2, s, app.assets, app.ES), mesh, app.P, app.D, app.ES, { layers: app.P.view.layers, overlays: app.P.view.overlays });
  app.cacheDirty = false;
}
function draw() {
  rafPending = false;
  if (!app.D) return;
  const { k, x, y } = app.view, mesh = app.mesh;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0b0e11'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 24 * dpr; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, mesh.W, mesh.H); ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  const now = performance.now(), interacting = now < app.interactingUntil && !app.painting;
  const t0 = performance.now();
  if (interacting) {
    if (app.cacheDirty || !app.cache) buildCache();
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(app.cache, 0, 0, mesh.W, mesh.H);
    setTimeout(requestRender, app.interactingUntil - now + 5);
  } else {
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, mesh.W, mesh.H); ctx.clip();
    const pt = new CanvasPainter(ctx, dpr * k, app.assets, app.ES); pt.pool = app.pool;
    renderMap(pt, mesh, app.P, app.D, app.ES, { screen: true, view: visibleRect(), layers: app.P.view.layers, overlays: app.P.view.overlays });
    app.pool = pt.pool; ctx.restore();
  }
  app.lastRenderMs = performance.now() - t0;
  drawUI();
  drawMinimapFrame();
}
function interact(ms = 160) { app.interactingUntil = performance.now() + ms; requestRender(); }

function drawUI() {
  const k = app.view.k, px = 1 / k;
  ctx.save();
  for (const ref of app.sel) {
    const o = getItem(ref);
    ctx.strokeStyle = '#f0d48a'; ctx.lineWidth = 1.6 * px; ctx.setLineDash([4 * px, 3 * px]);
    if (ref.type === 'cell') { const poly = app.mesh.polys[ref.cell]; ctx.beginPath(); for (let i = 0; i < poly.length; i += 2) ctx[i ? 'lineTo' : 'moveTo'](poly[i], poly[i + 1]); ctx.closePath(); ctx.stroke(); continue; }
    if (!o) continue;
    if (o.pts) { const p = smoothLine(o.pts, 2); ctx.lineWidth = 4 * px; ctx.strokeStyle = 'rgba(240,212,138,.55)'; ctx.setLineDash([]); ctx.beginPath(); for (let i = 0; i < p.length; i += 2) ctx[i ? 'lineTo' : 'moveTo'](p[i], p[i + 1]); ctx.stroke(); continue; }
    const r = itemRadius(ref, o) + 3 * px;
    if (ref.type === 'label') { const b = labelBox(o); ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(((o.rot || 0) * Math.PI) / 180); ctx.strokeRect(-b.w / 2 - 3 * px, -b.h / 2 - 2 * px, b.w + 6 * px, b.h + 4 * px); ctx.restore(); }
    else { ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.setLineDash([]);
  if (app.mouseW && ['raise', 'lower', 'smooth', 'biome', 'zone'].includes(app.tool)) {
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.2 * px; ctx.beginPath(); ctx.arc(app.mouseW.x, app.mouseW.y, opts.brush, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1 * px; ctx.beginPath(); ctx.arc(app.mouseW.x, app.mouseW.y, opts.brush + 1.2 * px, 0, Math.PI * 2); ctx.stroke();
  }
  const drawPts = (pts, extra, color) => { if (!pts.length) return; ctx.strokeStyle = color; ctx.lineWidth = 2 * px; ctx.setLineDash([6 * px, 4 * px]); ctx.beginPath(); pts.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y)); if (extra) ctx.lineTo(extra.x, extra.y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = color; for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(x, y, 2.5 * px, 0, Math.PI * 2); ctx.fill(); } };
  if (app.draft) drawPts(app.draft.pts, app.mouseW, app.tool === 'river' ? '#6fc3ff' : '#f0d48a');
  if (app.stroke) { ctx.strokeStyle = opts.drawColor; ctx.lineWidth = opts.drawWidth; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); app.stroke.pts.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y)); ctx.stroke(); }
  if (app.box) { const b = app.box; ctx.strokeStyle = '#f0d48a'; ctx.fillStyle = 'rgba(240,212,138,.1)'; ctx.lineWidth = px; ctx.setLineDash([4 * px, 3 * px]); ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.setLineDash([]); }
  ctx.restore();
}

// ------------------------------------------------------------------ minimap
const mm = $('#minimap'), mctx = mm.getContext('2d');
let mmTimer = null;
function scheduleMinimap() { clearTimeout(mmTimer); mmTimer = setTimeout(buildMinimap, 350); }
function buildMinimap() {
  if (!app.D) return;
  const W = app.mesh.W, H = app.mesh.H, cssW = 220, cssH = Math.round((cssW * H) / W), r = window.devicePixelRatio || 1;
  mm.style.height = cssH + 'px'; mm.width = cssW * r; mm.height = cssH * r;
  if (!app.mmBase) app.mmBase = document.createElement('canvas');
  app.mmBase.width = mm.width; app.mmBase.height = mm.height;
  const c = app.mmBase.getContext('2d'), s = mm.width / W; c.setTransform(s, 0, 0, s, 0, 0);
  renderMap(new CanvasPainter(c, s, app.assets, app.ES), app.mesh, app.P, app.D, app.ES, { screen: true, layers: { ...app.P.view.layers, labels: false, relief: false, decor: false }, overlays: app.P.view.overlays });
  drawMinimapFrame();
}
function drawMinimapFrame() {
  if (!app.mmBase || !app.mesh) return;
  mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.drawImage(app.mmBase, 0, 0);
  const s = mm.width / app.mesh.W, v = visibleRect();
  mctx.strokeStyle = '#f0d48a'; mctx.lineWidth = 2; mctx.strokeRect(v.x0 * s, v.y0 * s, (v.x1 - v.x0) * s, (v.y1 - v.y0) * s);
}
function minimapNav(e) {
  const r = mm.getBoundingClientRect(), wx = ((e.clientX - r.left) / r.width) * app.mesh.W, wy = ((e.clientY - r.top) / r.height) * app.mesh.H;
  app.view.x = app.cw / 2 - wx * app.view.k; app.view.y = app.ch / 2 - wy * app.view.k; interact(); updateZoom();
}
mm.addEventListener('pointerdown', (e) => { mm.setPointerCapture(e.pointerId); minimapNav(e); app.mmDrag = true; });
mm.addEventListener('pointermove', (e) => { if (app.mmDrag) minimapNav(e); });
mm.addEventListener('pointerup', () => (app.mmDrag = false));

// ------------------------------------------------------------------ view helpers
function fitView() {
  const { W, H } = app.mesh, k = Math.min(app.cw / W, app.ch / H) * 0.96;
  app.view = { k, x: (app.cw - W * k) / 2, y: (app.ch - H * k) / 2 }; updateZoom(); requestRender();
}
app.fitView = fitView;
function zoomAt(sx, sy, f) {
  const v = app.view, nk = Math.max(0.15, Math.min(40, v.k * f)); f = nk / v.k;
  v.x = sx - (sx - v.x) * f; v.y = sy - (sy - v.y) * f; v.k = nk; interact(); updateZoom();
}
function toWorld(e) { const r = cv.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top; return { x: (sx - app.view.x) / app.view.k, y: (sy - app.view.y) / app.view.k, sx, sy }; }
function updateZoom() { $('#stZoom').textContent = `Zoom ${Math.round(app.view.k * 100)}%`; }
function updateSeed() { const S = app.P.settings; $('#stSeed').textContent = `Seed “${S.seed}” · ${app.mesh.n} cells · ${S.lore ? 'lore mode' : 'freeform'}`; }

// ------------------------------------------------------------------ items & hit testing
const COLL = { feature: 'features', label: 'labels', stamp: 'stamps', line: 'lines', river: 'rivers', drawing: 'drawings' };
function getItem(ref) { return ref && COLL[ref.type] ? app.P[COLL[ref.type]].find((o) => o.id === ref.id) : null; }
function itemRadius(ref, o) {
  if (ref.type === 'feature') { const K = FEATURE_KINDS[o.kind]; return ((K?.size || 12) * (o.size || 1) * (app.ES.iconScale || 1)) / 2; }
  if (ref.type === 'stamp') return o.size / 2;
  return 6;
}
const measureCtx = document.createElement('canvas').getContext('2d');
function labelBox(lb) {
  const fam = lb.font === 'title' ? app.ES.titleFamily : app.ES.fontFamily;
  measureCtx.font = `${lb.italic ? 'italic ' : ''}${lb.size || 14}px ${fam}`; measureCtx.letterSpacing = (lb.spacing || 0) + 'px';
  return { w: measureCtx.measureText(lb.text || '').width, h: (lb.size || 14) * 1.15 };
}
function distToPolyline(x, y, p) {
  let best = Infinity;
  for (let i = 0; i < p.length - 2; i += 2) {
    const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}
function hitTest(w) {
  const P = app.P, L = P.view.layers, tol = 6 / app.view.k;
  for (let i = P.features.length - 1; i >= 0; i--) {
    const f = P.features[i], K = FEATURE_KINDS[f.kind]; if (!K) continue;
    if (K.cat === 'settlement' ? !L.settlements : !L.markers) continue;
    const r = itemRadius({ type: 'feature' }, f) + tol; if (Math.abs(w.x - f.x) < r && Math.abs(w.y - f.y) < r) return { type: 'feature', id: f.id };
  }
  if (L.labels) for (let i = P.labels.length - 1; i >= 0; i--) {
    const lb = P.labels[i], b = labelBox(lb), a = (-(lb.rot || 0) * Math.PI) / 180;
    const dx = w.x - lb.x, dy = w.y - lb.y, rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(rx) < b.w / 2 + tol && Math.abs(ry) < b.h / 2 + tol) return { type: 'label', id: lb.id };
  }
  if (L.stamps) for (let i = P.stamps.length - 1; i >= 0; i--) { const s = P.stamps[i]; if (Math.hypot(w.x - s.x, w.y - s.y) < s.size / 2 + tol) return { type: 'stamp', id: s.id }; }
  if (L.drawings) for (let i = P.drawings.length - 1; i >= 0; i--) { const d = P.drawings[i]; if (distToPolyline(w.x, w.y, smoothLine(d.pts, 1)) < tol + (d.width || 2) / 2) return { type: 'drawing', id: d.id }; }
  if (L.roads) for (let i = P.lines.length - 1; i >= 0; i--) { const l = P.lines[i]; if (distToPolyline(w.x, w.y, smoothLine(l.pts, l.kind === 'sea' || l.kind === 'border' ? 3 : 2)) < tol + 1) return { type: 'line', id: l.id }; }
  if (L.rivers) for (let i = P.rivers.length - 1; i >= 0; i--) { const r = P.rivers[i]; if (distToPolyline(w.x, w.y, smoothLine(r.pts, 2)) < tol + 1) return { type: 'river', id: r.id }; }
  return null;
}
app.hitTest = hitTest;
function deleteRefs(refs) {
  refs = refs.filter((r) => r.type !== 'cell'); if (!refs.length) return;
  history.push(refs.length > 1 ? `Delete ${refs.length} items` : 'Delete');
  for (const r of refs) { const arr = app.P[COLL[r.type]]; const i = arr.findIndex((o) => o.id === r.id); if (i >= 0) arr.splice(i, 1); }
  app.sel = []; contentChanged(); renderInspector(); toast(`Deleted ${refs.length} item${refs.length > 1 ? 's' : ''}`);
}
function moveRef(ref, dx, dy) {
  const o = getItem(ref); if (!o) return;
  if (o.pts) o.pts = o.pts.map(([x, y]) => [+(x + dx).toFixed(1), +(y + dy).toFixed(1)]);
  else { o.x = +(o.x + dx).toFixed(1); o.y = +(o.y + dy).toFixed(1); }
}
function select(refs, { inspect = true } = {}) { app.sel = refs; if (inspect) showTab('inspector'); renderInspector(); requestRender(); }

// ------------------------------------------------------------------ brushes
function cellsInRadius(w, r) {
  const { px, py, n } = app.mesh, out = [], r2 = r * r;
  for (let i = 0; i < n; i++) { const dx = px[i] - w.x, dy = py[i] - w.y, d2 = dx * dx + dy * dy; if (d2 < r2) { const t = 1 - Math.sqrt(d2) / r; out.push([i, t * t * (3 - 2 * t)]); } }
  if (!out.length) { const i = findCell(app.mesh, w.x, w.y); out.push([i, 1]); }
  return out;
}
function terrainBrush(w, mode) {
  const c = app.P.cells, m = app.mesh, s = opts.strength;
  for (const [i, f] of cellsInRadius(w, opts.brush)) {
    if (m.border[i]) continue;
    if (mode === 'raise') c.h[i] = Math.min(1.2, c.h[i] + 0.05 * s * f + (c.h[i] <= 0 && f > 0.3 ? 0.02 * s : 0));
    else if (mode === 'lower') c.h[i] = Math.max(-1, c.h[i] - 0.05 * s * f);
    else { let a = 0; for (const j of m.nbr[i]) a += c.h[j]; a /= m.nbr[i].length; c.h[i] += (a - c.h[i]) * Math.min(1, s * f * 0.8); }
    if (c.h[i] > 0 && c.h[i] < 0.005) c.h[i] = 0.005;
  }
  computeClimate(m, app.P); assignBiomes(m, app.P);
  app.D = buildDerived(m, app.P, app.ES); contentChanged();
}
function biomeBrush(w) {
  const c = app.P.cells, m = app.mesh, auto = opts.biome === 'auto', id = B[opts.biome];
  for (const [i, f] of cellsInRadius(w, opts.brush)) {
    if (f < 0.05 || m.border[i]) continue;
    if (auto) { c.lock[i] = 0; if (c.lake[i] === 2) c.lake[i] = 0; c.biome[i] = biomeFor(app.P, i); continue; }
    c.lock[i] = 1; c.biome[i] = id;
    if (id === B.ocean) { c.h[i] = Math.min(c.h[i], -0.05); c.lake[i] = 0; }
    else if (id === B.lake) { if (c.h[i] <= 0) c.h[i] = 0.02; c.lake[i] = 2; }
    else { if (c.h[i] <= 0) c.h[i] = 0.03; c.lake[i] = 0; if (id === B.mountain || id === B.snowpeak) c.h[i] = Math.max(c.h[i], 0.65); if (id === B.hills) c.h[i] = Math.max(c.h[i], 0.42); }
  }
  app.D = buildDerived(m, app.P, app.ES); contentChanged();
}
function zoneBrush(w) {
  const c = app.P.cells, t = opts.zoneTarget;
  const numeric = ['known', 'threat', 'mana'].includes(t);
  for (const [i, f] of cellsInRadius(w, opts.brush)) {
    if (numeric) { const a = c[t][i]; c[t][i] = a + (opts.zoneAmount - a) * Math.min(1, f * opts.strength * 1.2); continue; }
    if (isWater(app.P, i) || f < 0.05) continue;
    c[t][i] = +opts.zoneValue;
  }
  if (t === 'state') for (const ft of app.P.features) ft.state = c.state[ft.cell] ?? ft.state;
  zonesChanged();
}

// ------------------------------------------------------------------ tools
const TOOL_ICONS = {
  select: '<path d="M5 3l14 8-6 2-2 6z"/>', pan: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  raise: '<path d="M3 20l6-9 4 5 3-4 5 8z"/><path d="M12 9V2M9 5l3-3 3 3"/>', lower: '<path d="M3 21l6-9 4 5 3-4 5 8z"/><path d="M12 2v7M9 6l3 3 3-3"/>',
  smooth: '<path d="M3 14c3-6 6 2 9-2s6-4 9 0"/><path d="M3 19h18"/>', biome: '<path d="M12 21v-6"/><path d="M12 3c-4 0-6 3-6 6s3 6 6 6 6-3 6-6-2-6-6-6z"/>',
  zone: '<path d="M4 4h7v7H4zM13 13h7v7h-7z"/><path d="M13 4h7v7h-7zM4 13h7v7H4z" stroke-dasharray="2 2"/>', place: '<path d="M4 20V10l8-6 8 6v10z"/><path d="M10 20v-5h4v5"/>',
  route: '<path d="M4 20c4-6 2-10 8-12s6-4 8-6" stroke-dasharray="3 2.5"/><circle cx="4" cy="20" r="1.5"/><circle cx="20" cy="2.5" r="1.5"/>', river: '<path d="M5 3c4 4-2 7 2 11s-1 7 3 7M14 3c3 4-1 6 2 10"/>',
  label: '<path d="M5 5h14M12 5v15M9 20h6"/>', draw: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
  stamp: '<path d="M9 3h6v5l-2 3h5v4H6v-4h5L9 8z"/><path d="M5 20h14"/>', erase: '<path d="M8 20h12M4 15l9-9 6 6-8 8H8z"/><path d="M9 10l6 6"/>',
};
const TOOLS = [
  ['select', 'Select & move', 'V', 'Click a feature to inspect & edit it; drag to move; Shift+drag for box selection; click empty land to inspect the cell.'],
  ['pan', 'Pan', 'H', 'Drag to pan (also: middle/right mouse or hold Space).'],
  ['raise', 'Raise terrain', 'R', 'Paint to raise land (creates islands from sea). [ ] change brush size.'],
  ['lower', 'Lower terrain', 'L', 'Paint to lower land (carves bays, seas and lakes).'],
  ['smooth', 'Smooth terrain', 'N', 'Paint to soften terrain.'],
  ['biome', 'Paint biome', 'B', 'Paint biomes: forests, jungles, mountains, lakes, ocean… Painted cells are locked.'],
  ['zone', 'Paint zones', 'Z', 'Paint states/kingdoms, religion, race zones, the known world, Doomsday threat or mana density.'],
  ['place', 'Place settlement / marker', 'P', 'Click to place a capital, city, town, village, fortress, temple, dungeon or lore marker.'],
  ['route', 'Draw road / route / border', 'O', 'Click points; Enter or double-click to finish, Esc to cancel, Backspace to undo a point.'],
  ['river', 'Draw river', 'I', 'Click points from source to mouth; Enter or double-click to finish.'],
  ['label', 'Text label', 'T', 'Click to place a text label, then edit it in the Inspector.'],
  ['draw', 'Freehand draw', 'D', 'Drag to draw freehand lines / annotations.'],
  ['stamp', 'Stamp asset', 'A', 'Click to stamp the selected asset (pick one in the Assets tab).'],
  ['erase', 'Erase', 'X', 'Click any feature, label, stamp, road, river or drawing to delete it.'],
];
function setTool(t) {
  if (app.draft && t !== app.tool) finishDraft();
  app.tool = t;
  $$('#tools button').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  const T = TOOLS.find((x) => x[0] === t);
  $('#stTool').textContent = T[1];
  status(T[3]);
  cv.style.cursor = t === 'pan' ? 'grab' : t === 'select' ? 'default' : 'crosshair';
  renderToolOptions(); requestRender();
}
app.setTool = setTool;
function renderTools() {
  $('#tools').innerHTML = TOOLS.map(([id, name, key, hint]) => `<button data-tool="${id}" data-tip="${esc(name)} (${key}) — ${esc(hint)}"><svg viewBox="0 0 24 24">${TOOL_ICONS[id]}</svg><span class="key">${key}</span></button>`).join('');
  $$('#tools button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
}

function placeFeature(w) {
  const kind = opts.placeKind, cell = findCell(app.mesh, w.x, w.y), c = app.P.cells;
  history.push(`Place ${FEATURE_KINDS[kind].label}`);
  const f = { id: uid(app.P), kind, x: +w.x.toFixed(1), y: +w.y.toFixed(1), cell, name: app.names.forKind(kind), notes: DEFAULT_NOTES[kind] || '', state: c.state[cell] };
  if (['capital', 'city', 'town', 'village'].includes(kind)) f.pop = { capital: 200000, city: 40000, town: 6000, village: 400 }[kind];
  if (kind === 'temple') f.church = true;
  if (isWater(app.P, cell) && FEATURE_KINDS[kind].cat === 'settlement') toast('Note: placed on water — drag it onto land if that was a mistake.');
  app.P.features.push(f); contentChanged(); select([{ type: 'feature', id: f.id }]);
  status(`Placed ${FEATURE_KINDS[kind].label} “${f.name}” — rename or add lore notes in the Inspector.`);
}
function addDraftPoint(w) {
  const cell = findCell(app.mesh, w.x, w.y);
  if (!app.draft) app.draft = { pts: [], lastCell: -1 };
  const d = app.draft;
  if (app.tool === 'route' && opts.autoPath && d.pts.length && ['road', 'trade', 'path', 'sea'].includes(opts.routeKind)) {
    const path = findPath(app.mesh, app.P, d.lastCell, cell, opts.routeKind === 'sea' ? 'sea' : 'land');
    if (path && path.length > 1) { for (const i of path.slice(1, -1)) d.pts.push([+app.mesh.px[i].toFixed(1), +app.mesh.py[i].toFixed(1)]); }
  }
  d.pts.push([+w.x.toFixed(1), +w.y.toFixed(1)]); d.lastCell = cell;
  status(`${d.pts.length} point(s). Enter / double-click to finish, Esc to cancel, Backspace to remove last point.`);
  requestRender();
}
function finishDraft() {
  const d = app.draft; app.draft = null;
  if (!d || d.pts.length < 2) { requestRender(); return; }
  if (app.tool === 'river') {
    history.push('Draw river');
    const n = d.pts.length, r = { id: uid(app.P), pts: d.pts, w: d.pts.map((_, i) => +(0.6 + (i / (n - 1)) * 1.6).toFixed(2)), auto: false, name: `River ${app.names.word()}`, notes: '' };
    app.P.rivers.push(r); select([{ type: 'river', id: r.id }]);
  } else {
    history.push(`Draw ${opts.routeKind}`);
    const l = { id: uid(app.P), kind: opts.routeKind, pts: d.pts, name: '', notes: '' };
    app.P.lines.push(l); select([{ type: 'line', id: l.id }]);
  }
  contentChanged(); toast('Line added — edit it in the Inspector.');
}
function simplify(pts, eps) { // Ramer–Douglas–Peucker
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = distToPolyline(pts[i][0], pts[i][1], [pts[a][0], pts[a][1], pts[b][0], pts[b][1]]); if (d > md) { md = d; mi = i; } }
    if (md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// pointer handling
const pointers = new Map();
let panStart = null, dragState = null, spaceDown = false, pinch = null;
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('pointerdown', (e) => {
  cv.focus(); try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic */ } pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  hideMapTip();
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: app.view.k }; panStart = null; app.painting = false; return; }
  const w = toWorld(e);
  if (e.button === 1 || e.button === 2 || spaceDown || app.tool === 'pan' || (e.pointerType === 'touch' && app.tool === 'select' && !hitTest(w))) {
    panStart = { sx: e.clientX, sy: e.clientY, x: app.view.x, y: app.view.y }; cv.style.cursor = 'grabbing'; return;
  }
  if (e.button !== 0) return;
  const t = app.tool;
  if (t === 'select') {
    const hit = hitTest(w);
    if (hit) {
      const inSel = app.sel.some((r) => r.type === hit.type && r.id === hit.id);
      if (e.shiftKey) select(inSel ? app.sel.filter((r) => !(r.type === hit.type && r.id === hit.id)) : [...app.sel, hit]);
      else if (!inSel) select([hit]);
      dragState = { last: w, moved: false };
    } else if (e.shiftKey) { app.box = { x0: w.x, y0: w.y, x1: w.x, y1: w.y, ox: w.x, oy: w.y }; }
    else { const cell = findCell(app.mesh, w.x, w.y); select([{ type: 'cell', cell }]); }
  } else if (['raise', 'lower', 'smooth'].includes(t)) { history.push({ raise: 'Raise terrain', lower: 'Lower terrain', smooth: 'Smooth terrain' }[t]); app.painting = true; terrainBrush(w, t); }
  else if (t === 'biome') { history.push('Paint biome'); app.painting = true; biomeBrush(w); }
  else if (t === 'zone') { history.push(`Paint ${opts.zoneTarget}`); app.painting = true; ensureZoneOverlay(); zoneBrush(w); }
  else if (t === 'place') placeFeature(w);
  else if (t === 'route' || t === 'river') addDraftPoint(w);
  else if (t === 'label') {
    history.push('Add label');
    const lb = { id: uid(app.P), kind: 'custom', x: +w.x.toFixed(1), y: +w.y.toFixed(1), text: 'New Label', size: opts.labelSize, font: opts.labelFont, spacing: 1, rot: 0, italic: false };
    app.P.labels.push(lb); contentChanged(); select([{ type: 'label', id: lb.id }]);
    setTimeout(() => { const inp = $('#tab-inspector [data-f="text"]'); if (inp) { inp.focus(); inp.select(); } }, 30);
  } else if (t === 'draw') { app.stroke = { pts: [[w.x, w.y]] }; }
  else if (t === 'stamp') {
    history.push('Stamp');
    const s = { id: uid(app.P), asset: opts.stamp, x: +w.x.toFixed(1), y: +w.y.toFixed(1), size: opts.stampSize, rot: opts.stampRot, opacity: 1, notes: '' };
    app.P.stamps.push(s); contentChanged(); select([{ type: 'stamp', id: s.id }], { inspect: false });
    status(`Stamped “${ASSET_MAP[s.asset]?.name || 'custom asset'}”. Select it to scale/rotate (Q/E rotate, Alt+wheel scale).`);
  } else if (t === 'erase') { const hit = hitTest(w); if (hit) deleteRefs([hit]); else status('Nothing to erase here.'); }
});
cv.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const w = toWorld(e); app.mouseW = w;
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y), r = cv.getBoundingClientRect();
    zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, (pinch.k * (d / pinch.d)) / app.view.k); return;
  }
  if (panStart) { app.view.x = panStart.x + e.clientX - panStart.sx; app.view.y = panStart.y + e.clientY - panStart.sy; interact(); return; }
  updateCellStatus(w);
  const t = app.tool, down = e.buttons & 1;
  if (down && app.painting) {
    const now = performance.now(); if (app.lastPaint && now - app.lastPaint < 30) return; app.lastPaint = now;
    if (['raise', 'lower', 'smooth'].includes(t)) terrainBrush(w, t); else if (t === 'biome') biomeBrush(w); else if (t === 'zone') zoneBrush(w);
    return;
  }
  if (down && dragState && app.sel.length) {
    const dx = w.x - dragState.last.x, dy = w.y - dragState.last.y;
    if (!dragState.moved) { if (Math.hypot(dx, dy) * app.view.k < 3) return; history.push('Move'); dragState.moved = true; }
    for (const r of app.sel) moveRef(r, dx, dy);
    dragState.last = w; contentChanged(); return;
  }
  if (down && app.box) { const b = app.box; b.x0 = Math.min(b.ox, w.x); b.x1 = Math.max(b.ox, w.x); b.y0 = Math.min(b.oy, w.y); b.y1 = Math.max(b.oy, w.y); requestRender(); return; }
  if (down && app.stroke) { const last = app.stroke.pts.at(-1); if (Math.hypot(w.x - last[0], w.y - last[1]) > 1.5 / app.view.k) { app.stroke.pts.push([w.x, w.y]); requestRender(); } return; }
  if (!down) { showMapTip(e, w); if (['raise', 'lower', 'smooth', 'biome', 'zone', 'route', 'river'].includes(t)) requestRender(); }
});
function endPointer(e) {
  pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null;
  if (panStart) { panStart = null; cv.style.cursor = app.tool === 'pan' ? 'grab' : app.tool === 'select' ? 'default' : 'crosshair'; interact(1); return; }
  if (app.painting) {
    app.painting = false;
    if (['raise', 'lower', 'smooth', 'biome'].includes(app.tool)) { recomputeEnvironment(app.mesh, app.P); app.D = buildDerived(app.mesh, app.P, app.ES); contentChanged(); status('Terrain updated — climate, rivers, lakes and biomes recalculated.'); }
    else renderLayersPanel();
    return;
  }
  if (dragState) {
    if (dragState.moved) { for (const r of app.sel) { const o = getItem(r); if (r.type === 'feature' && o) { o.cell = findCell(app.mesh, o.x, o.y); o.state = app.P.cells.state[o.cell]; } } renderInspector(); }
    dragState = null;
  }
  if (app.box) {
    const b = app.box, refs = [];
    const inB = (x, y) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
    app.P.features.forEach((f) => inB(f.x, f.y) && refs.push({ type: 'feature', id: f.id }));
    app.P.labels.forEach((f) => inB(f.x, f.y) && refs.push({ type: 'label', id: f.id }));
    app.P.stamps.forEach((f) => inB(f.x, f.y) && refs.push({ type: 'stamp', id: f.id }));
    app.box = null; select(refs); status(`${refs.length} item(s) selected. Drag to move together, Delete to remove.`);
  }
  if (app.stroke) {
    const pts = simplify(app.stroke.pts, 0.6 / app.view.k).map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]); app.stroke = null;
    if (pts.length >= 2) { history.push('Draw'); const d = { id: uid(app.P), pts, color: opts.drawColor, width: opts.drawWidth, opacity: 1, fill: opts.drawFill, dash: opts.drawDash, notes: '' }; app.P.drawings.push(d); contentChanged(); }
    requestRender();
  }
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('pointerleave', () => { app.mouseW = null; hideMapTip(); requestRender(); });
cv.addEventListener('dblclick', (e) => { if (app.draft) { app.draft.pts.pop(); finishDraft(); } else if (app.tool === 'select') { const h = hitTest(toWorld(e)); if (h) showTab('inspector'); } });
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.altKey && app.sel.length) {
    if (history.undo.at(-1)?.label !== 'Scale') history.push('Scale');
    const f = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    for (const r of app.sel) { const o = getItem(r); if (!o) continue; if (r.type === 'stamp') o.size = Math.max(4, o.size * f); else if (r.type === 'label') o.size = Math.max(4, (o.size || 14) * f); else if (r.type === 'feature') o.size = Math.max(0.3, (o.size || 1) * f); }
    contentChanged(); renderInspector(); return;
  }
  const r = cv.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
}, { passive: false });

function ensureZoneOverlay() {
  const map = { state: 'political', religion: 'religious', race: 'races', known: 'heroview', threat: 'doomsday', mana: 'mana' };
  const ov = map[opts.zoneTarget];
  if (ov && !app.P.view.overlays[ov]) { app.P.view.overlays[ov] = true; renderLayersPanel(); contentChanged(); toast(`Showing the ${OVERLAY_LIST.find((o) => o[0] === ov)[1]} overlay while you paint.`); }
}

// ------------------------------------------------------------------ status, tips, toast
function status(msg) { $('#stMsg').textContent = msg; }
let toastTimer = null;
function toast(msg, err = false) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', err); t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), err ? 5000 : 2600); }
function updateCellStatus(w) {
  if (!app.mesh || w.x < 0 || w.y < 0 || w.x > app.mesh.W || w.y > app.mesh.H) { $('#stCell').textContent = ''; $('#stCoords').textContent = ''; return; }
  const i = findCell(app.mesh, w.x, w.y, app.lastCell || 0); app.lastCell = i;
  const c = app.P.cells, reg = c.region[i] !== REGION_NONE ? app.P.regions[c.region[i]]?.name : '';
  const elev = c.h[i] > 0 ? `${Math.round(c.h[i] * 4200)} m` : `depth ${Math.round(-c.h[i] * 3000)} m`;
  $('#stCell').textContent = `${BIOMES[c.biome[i]].name} · ${elev}${reg ? ' · ' + reg : ''}${c.state[i] ? ' · ' + (app.P.states[c.state[i]]?.name || '') : ''}`;
  $('#stCoords').textContent = `x ${Math.round(w.x)}, y ${Math.round(w.y)}`;
}
const mapTip = $('#mapTip');
function showMapTip(e, w) {
  if (app.tool !== 'select' && app.tool !== 'erase') return hideMapTip();
  const h = hitTest(w); if (!h) return hideMapTip();
  const o = getItem(h); if (!o) return hideMapTip();
  let html = '';
  if (h.type === 'feature') html = `<b>${esc(o.name)}</b><br><i>${FEATURE_KINDS[o.kind]?.label}${o.pop ? ' · pop. ' + o.pop.toLocaleString() : ''}${o.state ? ' · ' + esc(app.P.states[o.state]?.name || '') : ''}</i>${o.notes ? '<br>' + esc(o.notes.slice(0, 140)) + (o.notes.length > 140 ? '…' : '') : ''}`;
  else if (h.type === 'river') html = `<b>${esc(o.name || 'River')}</b><br><i>River${o.auto ? ' (generated)' : ''}</i>`;
  else if (h.type === 'line') html = `<b>${esc(o.name || o.kind)}</b><br><i>${o.kind}</i>`;
  else if (h.type === 'stamp') html = `<b>${esc(ASSET_MAP[o.asset]?.name || 'Custom asset')}</b>${o.notes ? '<br>' + esc(o.notes.slice(0, 120)) : ''}`;
  else if (h.type === 'label') html = `<b>${esc(o.text)}</b><br><i>Label — click to edit</i>`;
  else html = '<i>Drawing</i>';
  mapTip.innerHTML = html + (app.tool === 'erase' ? '<br><i>Click to delete</i>' : '');
  const r = cv.getBoundingClientRect(); mapTip.style.left = Math.min(e.clientX - r.left + 14, r.width - 270) + 'px'; mapTip.style.top = e.clientY - r.top + 14 + 'px'; mapTip.hidden = false;
}
function hideMapTip() { mapTip.hidden = true; }
const uiTip = $('#uiTip'); let tipTimer = null, tipEl = null;
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest ? e.target.closest('[data-tip]') : null; if (t === tipEl) return; tipEl = t; clearTimeout(tipTimer); uiTip.hidden = true;
  if (!t) return;
  tipTimer = setTimeout(() => { const r = t.getBoundingClientRect(); uiTip.textContent = t.dataset.tip; uiTip.hidden = false; const tw = uiTip.offsetWidth; uiTip.style.left = Math.max(4, Math.min(window.innerWidth - tw - 4, r.left + r.width / 2 - tw / 2)) + 'px'; uiTip.style.top = (r.bottom + 6 + 40 > window.innerHeight ? r.top - uiTip.offsetHeight - 6 : r.bottom + 6) + 'px'; }, 450);
});
document.addEventListener('mousedown', () => { clearTimeout(tipTimer); uiTip.hidden = true; });

// ------------------------------------------------------------------ panel helpers
const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(2)) : v);
function rangeRow(label, key, min, max, step, val, tip = '') { return `<div class="row" ${tip ? `data-tip="${esc(tip)}"` : ''}><label>${label}</label><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${val}"><span class="val">${fmt(val)}</span></div>`; }
/** Two-way bind inputs with [data-k] inside root to obj. onChange(key, value, isFinal). */
function bind(root, obj, onChange) {
  $$('[data-k]', root).forEach((inp) => {
    const k = inp.dataset.k;
    if (inp.type === 'checkbox') inp.checked = !!obj[k]; else if (obj[k] !== undefined && inp.type !== 'file') inp.value = obj[k];
    const read = () => (inp.type === 'checkbox' ? inp.checked : inp.type === 'range' || inp.type === 'number' ? +inp.value : inp.value);
    const val = inp.parentElement.querySelector('.val');
    inp.addEventListener('input', () => { obj[k] = read(); if (val) val.textContent = fmt(obj[k]); onChange && onChange(k, obj[k], false); });
    inp.addEventListener('change', () => { obj[k] = read(); onChange && onChange(k, obj[k], true); });
  });
}
function showTab(name) { $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name)); $$('.tabpanel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name)); if (window.innerWidth <= 1150 && name === 'inspector' && app.sel.length) document.body.classList.add('panel-open'); }
app.showTab = showTab;
$$('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
function iconURL(id, pal = ICON_PALETTES.parchment) { const c = app.P?.customAssets?.find((a) => a.id === id); return c ? c.dataUrl : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(assetSvg(id, pal)); }
function renderPanels() { renderToolOptions(); renderInspector(); renderLayersPanel(); renderStylePanel(); renderAssetsPanel(); renderWorldPanel(); }

// ------------------------------------------------------------------ tool options panel
function renderToolOptions() {
  const box = $('#toolOptions'), t = app.tool, T = TOOLS.find((x) => x[0] === t);
  if (!app.P) return;
  let html = `<h3>${T[1]}</h3><p class="hint">${T[3]}</p>`;
  const brushRows = rangeRow('Brush size', 'brush', 4, 160, 1, opts.brush, '[ and ] keys') + rangeRow('Strength', 'strength', 0.05, 1, 0.05, opts.strength);
  if (['raise', 'lower', 'smooth'].includes(t)) html += brushRows;
  if (t === 'biome') html += brushRows + `<div class="field"><label>Biome</label><select data-k="biome"><option value="auto">Auto (unlock — follow climate)</option>${BIOMES.map((b) => `<option value="${b.key}">${b.name}</option>`).join('')}</select></div><p class="hint">Mountains/hills also raise elevation. Painting land on sea creates land; “Ocean”/“Lake” creates water.</p>`;
  if (t === 'zone') {
    const tgt = opts.zoneTarget, P = app.P;
    html += brushRows + `<div class="field"><label>Paint</label><select data-k="zoneTarget"><option value="state">Political state / kingdom</option><option value="religion">Religion</option><option value="race">Race zone</option><option value="known">Hero's View: known world</option><option value="threat">Doomsday threat</option><option value="mana">Mana density</option></select></div>`;
    if (['state', 'religion', 'race'].includes(tgt)) {
      const list = tgt === 'state' ? P.states : tgt === 'religion' ? P.religions : P.races;
      html += `<div class="field"><label>Value</label><select data-k="zoneValue">${list.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>`;
      if (tgt === 'state') html += `<div class="btnrow"><button id="newState">+ New state</button></div>`;
    } else html += rangeRow(tgt === 'known' ? 'Known ↔ unexplored' : 'Target value', 'zoneAmount', 0, 1, 0.05, opts.zoneAmount);
  }
  if (t === 'place') html += `<div class="kindgrid">${Object.entries(FEATURE_KINDS).map(([k, K]) => `<button data-kind="${k}" class="${opts.placeKind === k ? 'active' : ''}" data-tip="${K.label}"><img src="${iconURL(K.icon)}" alt="">${K.label.replace(' entrance', '').replace(' marker', '')}</button>`).join('')}</div><p class="hint">Names are generated in Algon style; edit them in the Inspector.</p>`;
  if (t === 'route') html += `<div class="field"><label>Kind</label><select data-k="routeKind"><option value="road">Road</option><option value="trade">Trade route (main road)</option><option value="path">Path / track</option><option value="sea">Sea lane</option><option value="border">Border line</option><option value="wall">Wall / fortified line</option><option value="front">Military front</option></select></div><div class="row"><label>Follow terrain</label><input type="checkbox" data-k="autoPath"><span class="hint">auto-route around mountains & water</span></div>`;
  if (t === 'draw') html += `<div class="row"><label>Colour</label><input type="color" data-k="drawColor"></div>` + rangeRow('Width', 'drawWidth', 0.5, 12, 0.5, opts.drawWidth) + `<div class="row"><label>Fill shape</label><input type="checkbox" data-k="drawFill"></div><div class="row"><label>Dashed</label><input type="checkbox" data-k="drawDash"></div>`;
  if (t === 'label') html += rangeRow('Size', 'labelSize', 6, 60, 1, opts.labelSize) + `<div class="field"><label>Font</label><select data-k="labelFont"><option value="serif">Serif</option><option value="title">Title capitals</option><option value="script">Script</option><option value="sans">Sans</option></select></div>`;
  if (t === 'stamp') html += `<div class="row"><label>Asset</label><img src="${iconURL(opts.stamp)}" style="width:42px;height:42px;background:#e8dcbb22;border-radius:6px"><span class="hint">${esc(ASSET_MAP[opts.stamp]?.name || app.P.customAssets.find((a) => a.id === opts.stamp)?.name || '')}</span></div><div class="btnrow"><button id="pickAsset">Choose asset…</button></div>` + rangeRow('Size', 'stampSize', 6, 160, 1, opts.stampSize) + rangeRow('Rotation', 'stampRot', -180, 180, 5, opts.stampRot);
  if (t === 'select') html += `<p class="hint"><kbd>Delete</kbd> removes the selection · <kbd>Q</kbd>/<kbd>E</kbd> rotate · <kbd>Alt</kbd>+wheel scales · arrows nudge.</p>`;
  box.innerHTML = html;
  bind(box, opts, (k, v, fin) => { if (k === 'zoneTarget' && fin) { opts.zoneValue = 1; renderToolOptions(); ensureZoneOverlay(); } requestRender(); });
  $$('[data-kind]', box).forEach((b) => b.addEventListener('click', () => { opts.placeKind = b.dataset.kind; $$('[data-kind]', box).forEach((x) => x.classList.toggle('active', x === b)); }));
  $('#newState', box)?.addEventListener('click', () => {
    history.push('New state'); const id = app.P.states.length;
    const pal = ['#a8433a', '#3a8f5a', '#8f7a3a', '#7a3a8f', '#3a8f8f', '#8f3a6a', '#5a6a8f'];
    app.P.states.push({ id, name: app.names.state(), color: pal[id % pal.length], notes: '', ruler: '' }); opts.zoneValue = id; renderToolOptions(); renderLayersPanel(); toast('New state created — paint its territory.');
  });
  $('#pickAsset', box)?.addEventListener('click', () => showTab('assets'));
}

// ------------------------------------------------------------------ inspector
function renderInspector() {
  const box = $('#tab-inspector'), P = app.P; if (!P) return;
  const sel = app.sel;
  if (!sel.length) { box.innerHTML = `<h3>Inspector</h3><p class="hint">Click any settlement, marker, label, stamp, road, river or piece of land with the <b>Select</b> tool (V) to see and edit its details and lore notes.</p><h4>This map</h4>${mapSummary()}`; return; }
  if (sel.length > 1) {
    box.innerHTML = `<h3>${sel.length} items selected</h3><p class="hint">Drag any of them to move them together.</p><div class="btnrow"><button class="danger" id="delSel">Delete all</button></div>`;
    $('#delSel').onclick = () => deleteRefs(sel); return;
  }
  const ref = sel[0];
  if (ref.type === 'cell') return renderCellInspector(box, ref.cell);
  const o = getItem(ref); if (!o) { box.innerHTML = '<p class="hint">Item no longer exists.</p>'; return; }
  let html = '';
  if (ref.type === 'feature') {
    const K = FEATURE_KINDS[o.kind];
    html = `<h3><img src="${iconURL(K.icon)}" style="width:22px;vertical-align:-5px"><span class="ttl"> ${esc(o.name)}</span></h3>
      <div class="field"><label>Name</label><div class="row"><input type="text" data-k="name" class="grow"><button id="rename" data-tip="Generate a new Algon-style name">🎲</button></div></div>
      <div class="field"><label>Type</label><select data-k="kind">${Object.entries(FEATURE_KINDS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></div>
      ${K.cat === 'settlement' && o.kind !== 'dungeon' ? `<div class="row"><label>Population</label><input type="number" data-k="pop" min="0" step="10"></div>` : ''}
      <div class="row"><label>State</label><span>${o.state ? `<span class="swatch" style="background:${P.states[o.state]?.color}"></span> ${esc(P.states[o.state]?.name || '')}` : 'Unclaimed'}</span></div>
      ${rangeRow('Icon size', 'size', 0.3, 3, 0.05, o.size || 1)}
      <div class="row"><label>Hide name</label><input type="checkbox" data-k="hideName"></div>
      <h4>Lore tags</h4>${LORE_TAGS.map(([k, l]) => `<div class="row"><label style="flex:1">${l}</label><input type="checkbox" data-k="${k}"></div>`).join('')}
      <h4>Lore notes</h4><textarea data-k="notes" rows="7" placeholder="Paste lore snippets, chapter references, NPCs, rumours…"></textarea>
      <p class="hint">Position ${Math.round(o.x)}, ${Math.round(o.y)} · ${BIOMES[P.cells.biome[o.cell]]?.name || ''}</p>`;
  } else if (ref.type === 'label') {
    html = `<h3><span class="ttl">Label</span></h3><div class="field"><label>Text</label><input type="text" data-k="text" data-f="text"></div>
      ${rangeRow('Size', 'size', 4, 80, 1, o.size || 14)}${rangeRow('Letter spacing', 'spacing', 0, 20, 0.5, o.spacing || 0)}${rangeRow('Rotation', 'rot', -180, 180, 1, o.rot || 0)}
      <div class="field"><label>Font</label><select data-k="font"><option value="serif">Serif</option><option value="title">Title capitals</option><option value="script">Script</option><option value="sans">Sans</option></select></div>
      <div class="row"><label>Italic</label><input type="checkbox" data-k="italic"><label style="flex:0 0 40px">Bold</label><input type="checkbox" data-k="bold"></div>
      <div class="row"><label>Colour</label><input type="color" data-k="color" value="${o.color || '#2e2112'}"><button id="clearColor">Style default</button></div>
      <h4>Notes</h4><textarea data-k="notes" rows="4"></textarea>`;
  } else if (ref.type === 'stamp') {
    html = `<h3><img src="${iconURL(o.asset)}" style="width:24px;vertical-align:-6px"><span class="ttl"> ${esc(ASSET_MAP[o.asset]?.name || 'Custom asset')}</span></h3>
      ${rangeRow('Size', 'size', 4, 200, 1, o.size)}${rangeRow('Rotation', 'rot', -180, 180, 1, o.rot || 0)}${rangeRow('Opacity', 'opacity', 0.1, 1, 0.05, o.opacity ?? 1)}
      <h4>Notes</h4><textarea data-k="notes" rows="5" placeholder="Lore notes"></textarea>`;
  } else if (ref.type === 'line') {
    html = `<h3><span class="ttl">${esc(o.name || 'Route')}</span></h3><div class="field"><label>Name</label><input type="text" data-k="name"></div>
      <div class="field"><label>Kind</label><select data-k="kind"><option value="road">Road</option><option value="trade">Trade route</option><option value="path">Path</option><option value="sea">Sea lane</option><option value="border">Border line</option><option value="wall">Wall</option><option value="front">Military front</option></select></div>
      ${rangeRow('Width', 'width', 0.3, 8, 0.1, o.width || 1.2)}<div class="row"><label>Colour</label><input type="color" data-k="color" value="${o.color || '#6b4a2b'}"></div>
      <h4>Notes</h4><textarea data-k="notes" rows="5"></textarea><p class="hint">${o.pts.length} points</p>`;
  } else if (ref.type === 'river') {
    html = `<h3><span class="ttl">${esc(o.name || 'River')}</span></h3><div class="field"><label>Name</label><div class="row"><input type="text" data-k="name" class="grow"><button id="rename">🎲</button></div></div>
      ${rangeRow('Width ×', 'widthScale', 0.2, 4, 0.1, o.widthScale || 1)}<h4>Notes</h4><textarea data-k="notes" rows="5"></textarea>
      <p class="hint">${o.auto ? 'Generated from terrain flow (regenerates if you reshape terrain).' : 'Hand-drawn river.'}</p>`;
  } else if (ref.type === 'drawing') {
    html = `<h3><span class="ttl">Drawing</span></h3><div class="row"><label>Colour</label><input type="color" data-k="color"></div>${rangeRow('Width', 'width', 0.5, 14, 0.5, o.width || 2)}${rangeRow('Opacity', 'opacity', 0.1, 1, 0.05, o.opacity ?? 1)}
      <div class="row"><label>Fill</label><input type="checkbox" data-k="fill"><label style="flex:0 0 50px">Dashed</label><input type="checkbox" data-k="dash"></div><h4>Notes</h4><textarea data-k="notes" rows="4"></textarea>`;
  }
  html += `<div class="btnrow"><button class="danger" id="delSel">Delete</button></div>`;
  box.innerHTML = html;
  let pending = true;
  box.onfocusin = () => (pending = true);
  bind(box, o, (k, v, fin) => {
    if (pending) { history.push('Edit ' + ref.type); pending = false; }
    if (ref.type === 'feature' && k === 'kind' && fin) renderInspector();
    if ((k === 'name' || k === 'text') && $('.ttl', box) && ref.type !== 'label') $('.ttl', box).textContent = ' ' + v;
    contentChanged();
  });
  $('#delSel').onclick = () => deleteRefs([ref]);
  $('#rename', box)?.addEventListener('click', () => { history.push('Rename'); o.name = ref.type === 'river' ? `River ${app.names.word()}` : app.names.forKind(o.kind); contentChanged(); renderInspector(); });
  $('#clearColor', box)?.addEventListener('click', () => { history.push('Edit label'); delete o.color; contentChanged(); renderInspector(); });
}
function renderCellInspector(box, i) {
  const P = app.P, c = P.cells, b = BIOMES[c.biome[i]];
  const reg = c.region[i] !== REGION_NONE ? P.regions[c.region[i]] : null, st = P.states[c.state[i]], rel = P.religions[c.religion[i]], race = P.races[c.race[i]];
  const temp = Math.round(c.t[i] * 38 - 8);
  box.innerHTML = `<h3>${b.name}${c.lock[i] ? ' <span class="badge">painted</span>' : ''}</h3>
    <div class="row"><label>Elevation</label><span>${c.h[i] > 0 ? Math.round(c.h[i] * 4200) + ' m' : 'depth ' + Math.round(-c.h[i] * 3000) + ' m'}</span></div>
    <div class="row"><label>Temperature</label><span>${temp} °C (avg)</span></div><div class="row"><label>Moisture</label><span>${Math.round(Math.max(0, Math.min(1, c.m[i])) * 100)}%</span></div>
    <div class="row"><label>Mana density</label><span>${Math.round(c.mana[i] * 100)}%</span></div><div class="row"><label>Doomsday threat</label><span>${Math.round(c.threat[i] * 100)}%</span></div>
    <div class="row"><label>Known to heroes</label><span>${Math.round(c.known[i] * 100)}%</span></div>
    ${reg ? `<h4>Region</h4><div class="field"><input type="text" data-r="name" value="${esc(reg.name)}"></div><textarea data-r="notes" rows="4" placeholder="Region lore notes">${esc(reg.notes || '')}</textarea>` : ''}
    <h4>State</h4>${c.state[i] && st ? `<div class="row"><input type="color" data-s="color" value="${st.color}"><input type="text" data-s="name" value="${esc(st.name)}" class="grow"></div><div class="field"><label>Ruler</label><input type="text" data-s="ruler" value="${esc(st.ruler || '')}"></div><textarea data-s="notes" rows="3" placeholder="State lore notes">${esc(st.notes || '')}</textarea>` : '<p class="hint">Unclaimed land. Use Paint zones (Z) to assign it to a state.</p>'}
    <h4>Faith & people</h4><div class="row"><label>Religion</label><span><span class="swatch" style="background:${rel?.color}"></span> ${esc(rel?.name || '')}</span></div>
    <div class="row"><label>Race</label><span><span class="swatch" style="background:${race?.color}"></span> ${esc(race?.name || '')}</span></div>
    <p class="hint">Cell #${i}. Edit the state, religion and race lists in the Layers tab.</p>`;
  let pending = true;
  box.onfocusin = () => (pending = true);
  const edit = (obj, k, v, zone) => { if (pending) { history.push('Edit lore'); pending = false; } obj[k] = v; if (zone) { app.D.overlays = {}; buildZones(app.mesh, P, app.D); } contentChanged(); };
  $$('[data-r]', box).forEach((inp) => inp.addEventListener('input', () => edit(reg, inp.dataset.r, inp.value)));
  $$('[data-s]', box).forEach((inp) => inp.addEventListener('input', () => edit(st, inp.dataset.s, inp.value, inp.dataset.s === 'name' || inp.dataset.s === 'color')));
}
function mapSummary() {
  const P = app.P, counts = {};
  P.features.forEach((f) => (counts[f.kind] = (counts[f.kind] || 0) + 1));
  let land = 0; for (let i = 0; i < app.mesh.n; i++) if (P.cells.h[i] > 0) land++;
  return `<div class="hint">${Math.round((land / app.mesh.n) * 100)}% land · ${P.rivers.length} rivers · ${P.lines.length} routes · ${P.states.length - 1} states</div>
    <div class="chips">${Object.entries(counts).map(([k, v]) => `<span class="badge">${FEATURE_KINDS[k]?.label || k}: ${v}</span>`).join('')}</div>
    ${P.settings.lore ? `<h4>Lore template</h4><p class="lore-note">Kremantin, primary continent of Aleria. Elysandria at the centre; Menfor’s cold wastes to the north; wild jungles south; a storm-shrouded south-east; frozen lands north-east; unexplored, shadowed edges.</p>` : ''}`;
}

// ------------------------------------------------------------------ layers panel
function renderLayersPanel() {
  const box = $('#tab-layers'), P = app.P; if (!P) return;
  const L = P.view.layers, O = P.view.overlays;
  const legend = (title, list, key, start) => `<h4>${title}</h4>${list.slice(start).map((s, j) => `<div class="legend-row"><input type="color" data-leg="${key}" data-i="${j + start}" data-f="color" value="${s.color}"><input type="text" data-leg="${key}" data-i="${j + start}" data-f="name" value="${esc(s.name)}"></div>`).join('')}`;
  box.innerHTML = `<h3>Layers</h3>${LAYER_LIST.map(([k, l]) => `<label class="layer-row"><input type="checkbox" data-layer="${k}" ${L[k] ? 'checked' : ''}> ${l}</label>`).join('')}
    <h3 style="margin-top:14px">Lore overlays</h3>${OVERLAY_LIST.map(([k, l]) => `<label class="layer-row"><input type="checkbox" data-ov="${k}" ${O[k] ? 'checked' : ''}> ${l}${k === 'heroview' ? ' <kbd>F</kbd>' : k === 'grid' ? ' <kbd>G</kbd>' : ''}</label>`).join('')}
    ${rangeRow('Overlay opacity', 'overlayOpacity', 0.1, 1, 0.05, P.style.overlayOpacity ?? 0.55)}
    ${legend('States / kingdoms', P.states, 'states', 1)}${legend('Religions', P.religions, 'religions', 1)}${legend('Races', P.races, 'races', 1)}
    <p class="hint">Names & colours here feed the overlays, inspector and exports. Paint zones with the Z tool.</p>`;
  $$('[data-layer]', box).forEach((cb) => cb.addEventListener('change', () => { L[cb.dataset.layer] = cb.checked; contentChanged(); }));
  $$('[data-ov]', box).forEach((cb) => cb.addEventListener('change', () => { O[cb.dataset.ov] = cb.checked; contentChanged(); }));
  bind(box, P.style, () => { refreshStyle(); contentChanged(); });
  let pending = true; box.onfocusin = () => (pending = true);
  $$('[data-leg]', box).forEach((inp) => inp.addEventListener('input', () => {
    if (pending) { history.push('Edit legend'); pending = false; }
    P[inp.dataset.leg][+inp.dataset.i][inp.dataset.f] = inp.value; app.D.overlays = {}; buildZones(app.mesh, P, app.D); contentChanged();
  }));
}

// ------------------------------------------------------------------ style panel
function renderStylePanel() {
  const box = $('#tab-style'), st = app.P.style;
  box.innerHTML = `<h3>Map style</h3><div class="chips">${Object.entries(STYLE_PRESETS).map(([k, p]) => `<button data-preset="${k}" class="${st.preset === k ? 'active' : ''}">${p.name}</button>`).join('')}</div>
    <h4>Colours</h4>
    <div class="row"><label>Land tint</label><input type="color" data-k="landTint"><input type="range" data-k="tint" min="0" max="1" step="0.05"><span class="val">${fmt(st.tint)}</span></div>
    <div class="row"><label>Water</label><input type="color" data-k="water"></div>
    <div class="row"><label>Borders</label><input type="color" data-k="border"></div>
    <div class="row"><label>Coastline</label><input type="color" data-k="coast"></div>
    <div class="row"><label>Text</label><input type="color" data-k="text"></div>
    <h4>Texture & effects</h4>
    ${rangeRow('Paper texture', 'paperTexture', 0, 1, 0.05, st.paperTexture)}${rangeRow('Vignette', 'vignette', 0, 1, 0.05, st.vignette)}${rangeRow('Hill shading', 'hillshade', 0, 1, 0.05, st.hillshade)}
    ${rangeRow('Relief density', 'reliefDensity', 0.1, 2, 0.1, st.reliefDensity ?? 1)}${rangeRow('Icon scale', 'iconScale', 0.4, 2.5, 0.05, st.iconScale ?? 1)}
    <div class="row"><label>Relief icons</label><input type="checkbox" data-k="relief"></div><div class="row"><label>Coast ripples</label><input type="checkbox" data-k="ripples"></div><div class="row"><label>Contour lines</label><input type="checkbox" data-k="contours"></div>
    <div class="field"><label>Label font</label><select data-k="font"><option value="serif">Old-style serif</option><option value="title">Title capitals</option><option value="sans">Clean sans</option><option value="script">Script</option></select></div>
    <div class="btnrow"><button id="resetStyle">Reset to preset</button></div>`;
  $$('[data-preset]', box).forEach((b) => b.addEventListener('click', () => applyPreset(b.dataset.preset)));
  const heavy = ['reliefDensity', 'tint', 'landTint', 'water', 'hillshade'];
  bind(box, st, (k, v, fin) => {
    if (!app.styleEditPending) { history.push('Style'); app.styleEditPending = true; setTimeout(() => (app.styleEditPending = false), 1500); }
    refreshStyle();
    if (heavy.includes(k)) { clearTimeout(app.styleTimer); app.styleTimer = setTimeout(rebuildAll, fin ? 0 : 120); }
    else contentChanged();
  });
  $('#resetStyle').onclick = () => applyPreset(st.preset);
}
function applyPreset(k) {
  history.push('Style preset'); app.P.style = { ...defaultStyle(k), overlayOpacity: app.P.style.overlayOpacity ?? 0.55 };
  $('#styleSelect').value = k; refreshStyle(); rebuildAll(); renderStylePanel(); status(`Style: ${STYLE_PRESETS[k].name}`);
}
app.applyPreset = applyPreset;

// ------------------------------------------------------------------ assets panel
function renderAssetsPanel() {
  const box = $('#tab-assets'), P = app.P;
  const cats = { settlement: 'Settlements', marker: 'Lore markers', nature: 'Nature', deco: 'Decoration' };
  let html = `<h3>Asset library</h3><p class="hint">Click an asset, then click the map to stamp it. Stamps can be moved, scaled (Alt+wheel or Inspector) and rotated (Q/E).</p>`;
  for (const [cat, title] of Object.entries(cats)) html += `<h4>${title}</h4><div class="assetgrid">${ASSETS.filter((a) => a.cat === cat).map((a) => `<button data-asset="${a.id}" class="${opts.stamp === a.id ? 'active' : ''}" data-tip="${esc(a.name)}"><img src="${iconURL(a.id)}" alt="">${esc(a.name.split(' (')[0])}</button>`).join('')}</div>`;
  html += `<h4>Your uploads</h4><div class="assetgrid">${P.customAssets.map((a) => `<button data-asset="${a.id}" class="${opts.stamp === a.id ? 'active' : ''}" data-tip="${esc(a.name)} (right-click to remove)"><img src="${a.dataUrl}" alt="">${esc(a.name.slice(0, 14))}</button>`).join('') || '<span class="hint">None yet.</span>'}</div>
    <div class="btnrow"><button id="uploadAsset">⬆ Upload image (PNG/SVG/JPG/WebP)</button><input type="file" id="assetFile" accept="image/png,image/svg+xml,image/jpeg,image/webp" hidden multiple></div><p class="hint">Uploads are embedded in the project file and exports.</p>`;
  box.innerHTML = html;
  $$('[data-asset]', box).forEach((b) => {
    b.addEventListener('click', () => { opts.stamp = b.dataset.asset; setTool('stamp'); renderAssetsPanel(); });
    b.addEventListener('contextmenu', (e) => { const id = b.dataset.asset; if (!id.startsWith('custom-')) return; e.preventDefault(); history.push('Remove asset'); P.customAssets = P.customAssets.filter((a) => a.id !== id); P.stamps = P.stamps.filter((s) => s.asset !== id); contentChanged(); renderAssetsPanel(); });
  });
  $('#uploadAsset').onclick = () => $('#assetFile').click();
  $('#assetFile').onchange = async (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      if (f.size > 4e6) { toast(`${f.name} is larger than 4 MB — skipped.`, true); continue; }
      const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
      history.push('Upload asset');
      const id = 'custom-' + uid(P); P.customAssets.push({ id, name: f.name.replace(/\.[^.]+$/, ''), dataUrl }); opts.stamp = id;
    }
    app.assets.setCustom(P.customAssets); renderAssetsPanel(); setTool('stamp'); toast('Asset uploaded — click the map to stamp it.');
  };
}

// ------------------------------------------------------------------ world (generation) panel
function renderWorldPanel() {
  const box = $('#tab-world'), S = { ...app.P.settings };
  box.innerHTML = `<h3>World generation</h3>
    <div class="field"><label>Seed</label><div class="row"><input type="text" data-k="seed" class="grow"><button id="diceSeed" data-tip="Random seed">🎲</button></div></div>
    <div class="row" data-tip="Forces the Kremantin layout: Elysandria centre, Menfor north, jungles south, storms south-east, frozen north-east, fog at the edges."><label>Lore mode</label><input type="checkbox" data-k="lore"><span class="hint">Kremantin template</span></div>
    <div class="field"><label>Map size (world units)</label><select data-k="size"><option value="1600x1000">1600 × 1000 (16:10)</option><option value="1920x1080">1920 × 1080 (16:9)</option><option value="1400x1400">1400 × 1400 (square)</option><option value="2000x1250">2000 × 1250 (large)</option><option value="2000x2000">2000 × 2000 (large square)</option></select></div>
    ${rangeRow('Cells', 'cells', 2000, 30000, 1000, S.cells, 'Voronoi resolution. More cells = finer detail, slower editing.')}
    <div class="field"><label>Landmass shape (freeform)</label><select data-k="shape"><option value="continent">Continent</option><option value="twin">Twin continents</option><option value="archipelago">Archipelago</option><option value="pangea">Pangea</option></select></div>
    ${rangeRow('Land', 'land', 0.15, 0.75, 0.01, S.land)}${rangeRow('Mountains', 'mountains', 0, 1, 0.05, S.mountains)}${rangeRow('Roughness', 'roughness', 0, 1, 0.05, S.roughness)}
    ${rangeRow('Temperature', 'temp', -1, 1, 0.05, S.temp)}${rangeRow('Moisture', 'moist', -1, 1, 0.05, S.moist)}${rangeRow('Rivers', 'rivers', 0, 1, 0.05, S.rivers)}
    ${rangeRow('Settlements', 'settlements', 0, 1, 0.05, S.settlements)}${rangeRow('States', 'states', 1, 12, 1, S.states, 'Freeform mode only')}
    <div class="field"><label>Custom place names (one per line, used first)</label><textarea data-k="customNames" rows="3" placeholder="e.g. names from the fandom wiki"></textarea><div class="btnrow"><button id="importNames">Import .txt / .json list</button><input type="file" id="namesFile" accept=".txt,.json,text/plain,application/json" hidden></div></div>
    <div class="btnrow"><button class="primary" id="genBtn">Generate</button><button id="genRandom">Random seed & generate</button><button id="repop" data-tip="Keep terrain edits, re-place settlements, states, markers, roads & labels">Re-place features</button></div>
    ${localStorage.getItem('aleria-autosave') ? '<div class="btnrow"><button id="restoreAuto">Restore last autosave</button></div>' : ''}
    <p class="hint">Generating replaces the current map and clears undo history — save first if you want to keep edits.</p>`;
  bind(box, S, () => {});
  $('#diceSeed').onclick = () => { S.seed = randomSeed(); $('[data-k="seed"]', box).value = S.seed; };
  $('#genBtn').onclick = () => newWorld({ ...S });
  $('#genRandom').onclick = () => { S.seed = randomSeed(); newWorld({ ...S }); };
  $('#repop').onclick = () => { history.push('Re-place features'); repopulate(app.mesh, app.P); rebuildAll(); renderPanels(); toast('Settlements, states, markers and roads re-placed.'); };
  $('#importNames').onclick = () => $('#namesFile').click();
  $('#namesFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return; const txt = await f.text(); let names = [];
    try { const j = JSON.parse(txt); names = Array.isArray(j) ? j.map((x) => (typeof x === 'string' ? x : x.name)).filter(Boolean) : Object.values(j).flat().filter((x) => typeof x === 'string'); } catch { names = txt.split(/\r?\n/).map((s) => s.trim()).filter(Boolean); }
    S.customNames = names.join('\n'); $('[data-k="customNames"]', box).value = S.customNames; toast(`Imported ${names.length} names — click Generate to use them.`);
  };
  $('#restoreAuto')?.addEventListener('click', () => { try { const { mesh, P } = io.deserializeProject(localStorage.getItem('aleria-autosave')); setProject(mesh, P); history.clear(); fitView(); toast('Autosave restored.'); } catch (err) { toast('Could not restore: ' + err.message, true); } });
}
const randomSeed = () => { const r = makeRng(String(Math.random())); return app.names.word().toLowerCase() + '-' + r.int(100, 999); };

// ------------------------------------------------------------------ save / load / export / share
let autosaveTimer = null;
function scheduleAutosave() { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(() => { try { localStorage.setItem('aleria-autosave', io.serializeProject(app.P)); } catch { /* quota exceeded: ignore */ } }, 2000); }
function saveProject() { io.download(io.serializeProject(app.P), `${io.slug(app.P.settings.seed)}.aleria.json`, 'application/json'); toast('Project saved as JSON.'); }
async function loadProjectText(text, name = 'project') {
  try { showLoading('Opening project…'); const { mesh, P } = io.deserializeProject(text); setProject(mesh, P); history.clear(); fitView(); $('#styleSelect').value = P.style.preset; toast(`Opened “${name}”.`); }
  catch (err) { console.error(err); toast('Could not open file: ' + err.message, true); }
  hideLoading();
}
app.loadProjectText = loadProjectText;
$('#fileLoad').addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; await loadProjectText(await f.text(), f.name); e.target.value = ''; });
function modal(html) { $('#modalBody').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; }
$('#modalClose').onclick = closeModal;
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

function openExport() {
  const { W, H } = app.mesh;
  modal(`<h2>Export map</h2><p class="hint">Exports use the current style, layers and overlays.</p>
    <div class="row"><label>PNG width</label><select id="pngW"><option value="1920">1920 px (HD)</option><option value="2560">2560 px (QHD)</option><option value="3840" selected>3840 px (4K)</option><option value="5120">5120 px (5K)</option><option value="7680">7680 px (8K)</option></select><button class="primary" id="doPng">Download PNG</button></div>
    <div class="row"><label>SVG</label><span class="grow hint">Vector, editable in Inkscape / Illustrator.</span><button id="doSvg">Download SVG</button></div>
    <div class="row"><label>PDF page</label><select id="pdfF"><option value="a4">A4</option><option value="a3" selected>A3</option><option value="a2">A2</option><option value="fit">Fit to map</option></select><button id="doPdf">Download PDF</button></div>
    <div class="row"><label>Project</label><span class="grow hint">Full editable project (.json).</span><button id="doJson">Save JSON</button></div>
    <div id="expMsg" class="hint"></div><p class="hint">Map aspect ${W}×${H}. 8K PNGs can take several seconds and a few hundred MB of memory.</p>`);
  const run = async (fn, label) => { const m = $('#expMsg'); m.textContent = `Rendering ${label}…`; await new Promise((r) => setTimeout(r, 30)); try { const r = await fn(); m.textContent = `${label} ready${r?.w ? ` (${r.w}×${r.h})` : ''}${r?.bytes ? ` · ${(r.bytes / 1e6).toFixed(1)} MB` : ''}.`; } catch (err) { console.error(err); m.textContent = `${label} failed: ${err.message}`; } };
  $('#doPng').onclick = () => run(() => io.exportPNG(app, +$('#pngW').value), 'PNG');
  $('#doSvg').onclick = () => run(() => io.exportSVG(app), 'SVG');
  $('#doPdf').onclick = () => run(() => io.exportPDF(app, 3840, $('#pdfF').value), 'PDF');
  $('#doJson').onclick = () => { saveProject(); $('#expMsg').textContent = 'JSON saved.'; };
}
function shareLinks() {
  const base = location.href.split('#')[0];
  const hash = io.settingsToHash(app.P.settings, app.P.style.preset, app.P.view.overlays);
  return { link: base + hash, embed: `<iframe src="${base + hash}&embed=1" width="960" height="600" style="border:0;border-radius:8px" loading="lazy" title="Aleria map — ${esc(app.P.settings.seed)}"></iframe>` };
}
app.shareLinks = shareLinks;
function openShare() {
  const { link, embed } = shareLinks();
  modal(`<h2>Share</h2><p class="hint">The link rebuilds this map from its <b>seed and settings</b> (plus style & overlays). Hand edits are not in the link — share the saved <b>.json</b> project for those.</p>
    <div class="field"><label>Link</label><textarea class="code" id="shLink" rows="3" readonly>${esc(link)}</textarea><div class="btnrow"><button data-copy="shLink">Copy link</button></div></div>
    <div class="field"><label>Embed (read-only, pan & zoom)</label><textarea class="code" id="shEmbed" rows="4" readonly>${esc(embed)}</textarea><div class="btnrow"><button data-copy="shEmbed">Copy embed code</button></div></div>
    <p class="hint">Hosting: this site is static — see README for GitHub Pages steps.</p>`);
  $$('[data-copy]').forEach((b) => (b.onclick = async () => { const ta = $('#' + b.dataset.copy); ta.select(); try { await navigator.clipboard.writeText(ta.value); } catch { document.execCommand('copy'); } b.textContent = 'Copied ✓'; }));
}
function openHelp() {
  const keys = [['V H R L N B Z P O I T D A X', 'Tools: select, pan, raise, lower, smooth, biome, zones, place, route, river, text, draw, stamp, erase'], ['Space + drag / middle / right drag', 'Pan'], ['Wheel, + / −, 0', 'Zoom, fit map'], ['[ and ]', 'Brush size'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Delete', 'Delete selection'], ['Q / E, Alt+wheel, arrows', 'Rotate, scale, nudge selection'], ['Enter / double-click, Esc, Backspace', 'Finish, cancel, remove last point (route/river)'], ['F / G / M', "Toggle Hero's View, cell grid, minimap"], ['Ctrl+S / Ctrl+O / Ctrl+E', 'Save, open, export'], ['Shift+G', 'New random map'], ['?', 'This help']];
  modal(`<h2>Aleria Map Generator — help</h2>
    <p>Generate Kremantin (lore mode) or a freeform world, then edit everything: terrain, biomes, settlements, borders, roads, labels, stamps and lore notes. Your work autosaves in this browser; use <b>Save</b> for a portable project file.</p>
    <table>${keys.map(([k, d]) => `<tr><td>${k.split(' / ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' / ')}</td><td>${d}</td></tr>`).join('')}</table>
    <h4>Tips</h4><ul class="hint"><li>Select a piece of land to see its biome, climate, region and state, and to edit region/state lore.</li><li>Paint zones (Z) to redraw kingdoms, religions, race zones, the known world (Hero's View), threat and mana.</li><li>Overlays live in the Layers tab; their legends there are editable.</li><li>Unofficial fan tool. Lore placements are defaults you can change.</li></ul>`);
}

// ------------------------------------------------------------------ keyboard
window.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag)) { if (e.key === 'Escape') e.target.blur(); return; }
  const k = e.key, ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? history.doRedo() : history.doUndo(); return; }
  if (ctrl && k.toLowerCase() === 'y') { e.preventDefault(); history.doRedo(); return; }
  if (ctrl && k.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
  if (ctrl && k.toLowerCase() === 'o') { e.preventDefault(); $('#fileLoad').click(); return; }
  if (ctrl && k.toLowerCase() === 'e') { e.preventDefault(); openExport(); return; }
  if (ctrl) return;
  if (k === ' ') { spaceDown = true; cv.style.cursor = 'grab'; e.preventDefault(); return; }
  if (k === 'Escape') { if (app.draft) { app.draft = null; status('Cancelled.'); } else if (!$('#modal').hidden) closeModal(); else { app.sel = []; renderInspector(); } requestRender(); return; }
  if (k === 'Enter' && app.draft) { finishDraft(); return; }
  if ((k === 'Backspace' || k === 'Delete') && app.draft) { app.draft.pts.pop(); if (!app.draft.pts.length) app.draft = null; requestRender(); return; }
  if ((k === 'Delete' || k === 'Backspace') && app.sel.length) { e.preventDefault(); deleteRefs(app.sel); return; }
  if (k.startsWith('Arrow') && app.sel.some((r) => r.type !== 'cell')) {
    e.preventDefault(); const d = (e.shiftKey ? 20 : 4) / app.view.k; if (history.undo.at(-1)?.label !== 'Nudge') history.push('Nudge');
    app.sel.forEach((r) => moveRef(r, k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0)); contentChanged(); return;
  }
  if ((k === 'q' || k === 'e') && app.sel.some((r) => r.type === 'stamp' || r.type === 'label')) {
    history.push('Rotate'); app.sel.forEach((r) => { const o = getItem(r); if (o && (r.type === 'stamp' || r.type === 'label')) o.rot = (((o.rot || 0) + (k === 'q' ? -15 : 15) + 540) % 360) - 180; }); contentChanged(); renderInspector(); return;
  }
  if (k === '[' || k === ']') { opts.brush = Math.max(4, Math.min(160, opts.brush * (k === ']' ? 1.2 : 1 / 1.2))); renderToolOptions(); requestRender(); status(`Brush size ${Math.round(opts.brush)}`); return; }
  if (k === '+' || k === '=') { zoomAt(app.cw / 2, app.ch / 2, 1.25); return; }
  if (k === '-' || k === '_') { zoomAt(app.cw / 2, app.ch / 2, 0.8); return; }
  if (k === '0') { fitView(); return; }
  if (k === '?') { openHelp(); return; }
  if (k === 'G' && e.shiftKey) { newWorld({ ...app.P.settings, seed: randomSeed() }); return; }
  const lower = k.toLowerCase();
  if (lower === 'f') { app.P.view.overlays.heroview = !app.P.view.overlays.heroview; renderLayersPanel(); contentChanged(); status(`Hero's View ${app.P.view.overlays.heroview ? 'on' : 'off'}`); return; }
  if (lower === 'g') { app.P.view.overlays.grid = !app.P.view.overlays.grid; renderLayersPanel(); contentChanged(); return; }
  if (lower === 'm') { $('#minimapWrap').classList.toggle('hidden'); return; }
  const tool = TOOLS.find((t) => t[2].toLowerCase() === lower);
  if (tool) setTool(tool[0]);
});
window.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceDown = false; setTool(app.tool); } });

// ------------------------------------------------------------------ top bar wiring
$('#styleSelect').innerHTML = Object.entries(STYLE_PRESETS).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('');
$('#styleSelect').addEventListener('change', (e) => applyPreset(e.target.value));
$('#btnNew').onclick = () => newWorld({ ...app.P.settings, seed: randomSeed() });
$('#btnUndo').onclick = () => history.doUndo();
$('#btnRedo').onclick = () => history.doRedo();
$('#btnSave').onclick = saveProject;
$('#btnLoad').onclick = () => $('#fileLoad').click();
$('#btnExport').onclick = openExport;
$('#btnShare').onclick = openShare;
$('#btnHelp').onclick = openHelp;
$('#btnPanel').onclick = () => document.body.classList.toggle('panel-open');
$('#zoomIn').onclick = () => zoomAt(app.cw / 2, app.ch / 2, 1.3);
$('#zoomOut').onclick = () => zoomAt(app.cw / 2, app.ch / 2, 1 / 1.3);
$('#zoomFit').onclick = fitView;
window.addEventListener('resize', resize);
window.addEventListener('hashchange', () => { const h = io.hashToSettings(location.hash); if (h && h.settings.seed !== app.P?.settings.seed) newWorld(h.settings, { style: h.style, overlays: h.overlays }); });

// ------------------------------------------------------------------ boot
async function boot() {
  app.assets = new AssetStore(() => { app.cacheDirty = true; scheduleMinimap(); requestRender(); });
  renderTools(); resize();
  const h = io.hashToSettings(location.hash);
  if (h?.embed) document.body.classList.add('embed');
  resize();
  await app.assets.preload(ICON_PALETTES.parchment, 'parchment');
  const S = h ? h.settings : { ...DEFAULT_SETTINGS };
  await newWorld(S, { keepStyle: false, style: h?.style, overlays: h?.overlays });
  setTool('select'); fitView();
  status(S.lore ? 'Welcome to Kremantin. Click anything to inspect it · press ? for shortcuts.' : 'World generated. Press ? for shortcuts.');
  app.ready = true;
}
boot().catch((err) => { console.error(err); toast('Startup failed: ' + err.message, true); });

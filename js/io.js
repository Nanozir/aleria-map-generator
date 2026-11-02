// Save / load / export / share helpers.
import { buildMesh, emptyProject, ensureDerived, computeClimate, SAVED_CELL_KEYS, DEFAULT_SETTINGS } from './generator.js';
import { CanvasPainter, SvgPainter } from './painter.js';
import { renderMap } from './render.js';

const round = (v, d) => { const f = 10 ** d; return Math.round(v * f) / f; };

export function serializeProject(P) {
  const cells = {};
  for (const k of SAVED_CELL_KEYS) {
    const a = P.cells[k];
    cells[k] = a instanceof Float32Array ? Array.from(a, (v) => round(v, 4)) : Array.from(a);
  }
  const { cells: _c, nameState, riverThreshold, ...rest } = P;
  return JSON.stringify({ ...rest, cells, savedAt: new Date().toISOString() });
}

export function deserializeProject(text) {
  const data = typeof text === 'string' ? JSON.parse(text) : text;
  if (data.app !== 'aleria-map-generator') throw new Error('Not an Aleria Map Generator project file.');
  const S = { ...DEFAULT_SETTINGS, ...data.settings };
  const [W, H] = S.size.split('x').map(Number);
  const mesh = buildMesh(S.seed, W, H, S.cells);
  const P = emptyProject(S, mesh);
  for (const k of SAVED_CELL_KEYS) {
    const src = data.cells?.[k];
    if (!src) continue;
    if (src.length !== mesh.n) throw new Error(`Cell count mismatch for "${k}" (${src.length} vs ${mesh.n}).`);
    P.cells[k].set(src);
  }
  for (const key of ['rivers', 'features', 'lines', 'labels', 'stamps', 'drawings', 'states', 'religions', 'races', 'regions', 'customAssets', 'style', 'view', 'nextId']) if (data[key] !== undefined) P[key] = data[key];
  ensureDerived(mesh, P);
  computeClimate(mesh, P);
  return { mesh, P };
}

export function download(blobOrText, filename, type = 'application/octet-stream') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';

/** Render the full map to an offscreen canvas of the given pixel width. */
export async function renderToCanvas(app, width) {
  const { mesh, P, D, ES, assets } = app;
  await assets.preload(ES.iconPalette, ES.palette);
  const k = width / mesh.W, cv = document.createElement('canvas');
  cv.width = Math.round(width); cv.height = Math.round(mesh.H * k);
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('Canvas too large for this browser.');
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const pt = new CanvasPainter(ctx, k, assets, ES);
  renderMap(pt, mesh, P, D, ES, { layers: P.view.layers, overlays: P.view.overlays });
  return cv;
}

export async function exportPNG(app, width) {
  const cv = await renderToCanvas(app, width);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed (canvas too large?).');
  download(blob, `${slug(app.P.settings.seed)}-${cv.width}x${cv.height}.png`);
  return { w: cv.width, h: cv.height, bytes: blob.size };
}

export function buildSVG(app) {
  const { mesh, P, D, ES } = app;
  const pt = new SvgPainter(mesh.W, mesh.H, ES, P.customAssets);
  renderMap(pt, mesh, P, D, ES, { layers: P.view.layers, overlays: P.view.overlays });
  return pt.toString();
}
export function exportSVG(app) {
  const svg = buildSVG(app);
  download(svg, `${slug(app.P.settings.seed)}.svg`, 'image/svg+xml');
  return { bytes: svg.length };
}

export async function exportPDF(app, width = 3840, format = 'a3') {
  const J = window.jspdf?.jsPDF;
  if (!J) throw new Error('PDF library not loaded.');
  const cv = await renderToCanvas(app, width);
  const img = cv.toDataURL('image/jpeg', 0.92);
  const landscape = cv.width >= cv.height;
  const doc = new J({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: format === 'fit' ? [cv.width * 0.24, cv.height * 0.24] : format });
  const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
  const m = format === 'fit' ? 0 : 24, s = Math.min((pw - 2 * m) / cv.width, (ph - 2 * m) / cv.height);
  const w = cv.width * s, h = cv.height * s;
  doc.addImage(img, 'JPEG', (pw - w) / 2, (ph - h) / 2, w, h);
  doc.setProperties({ title: `Aleria Map – ${app.P.settings.seed}`, creator: 'Aleria Map Generator' });
  const blob = doc.output('blob');
  download(blob, `${slug(app.P.settings.seed)}.pdf`);
  return { bytes: blob.size };
}

// ---- share links: seed + settings + style + overlays in the URL hash
const KEYMAP = { seed: 'seed', lore: 'lore', size: 'size', cells: 'cells', shape: 'shape', land: 'land', mountains: 'mtn', roughness: 'rough', temp: 'temp', moist: 'moist', rivers: 'rivers', settlements: 'dens', states: 'states' };
export function settingsToHash(S, style, overlays) {
  const q = new URLSearchParams();
  for (const [k, short] of Object.entries(KEYMAP)) { let v = S[k]; if (typeof v === 'boolean') v = v ? 1 : 0; q.set(short, v); }
  if (style) q.set('style', style);
  const ov = Object.entries(overlays || {}).filter(([, v]) => v).map(([k]) => k);
  if (ov.length) q.set('ov', ov.join(','));
  return '#' + q.toString();
}
export function hashToSettings(hash) {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  if (!q.has('seed')) return null;
  const S = { ...DEFAULT_SETTINGS };
  for (const [k, short] of Object.entries(KEYMAP)) {
    if (!q.has(short)) continue;
    const v = q.get(short), def = DEFAULT_SETTINGS[k];
    S[k] = typeof def === 'boolean' ? v === '1' || v === 'true' : typeof def === 'number' ? (isFinite(+v) ? +v : def) : v;
  }
  S.cells = Math.max(1000, Math.min(40000, S.cells));
  if (!/^\d{3,4}x\d{3,4}$/.test(S.size)) S.size = DEFAULT_SETTINGS.size;
  return { settings: S, style: q.get('style'), overlays: (q.get('ov') || '').split(',').filter(Boolean), embed: q.get('embed') === '1' };
}

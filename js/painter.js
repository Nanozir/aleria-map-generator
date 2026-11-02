// Two drawing back-ends with the same small API: CanvasPainter (screen, PNG, PDF)
// and SvgPainter (vector SVG export). The renderer only talks to this API.
// Geometry is in world units; rings/lines are flat [x0,y0,x1,y1,...] arrays.
import { assetMarkup } from './assets.js';
import { makeRng } from './rng.js';

let paperTile = null;
/** Tileable value noise: lattice hashed modulo `period` so the texture repeats seamlessly. */
function tileValueNoise(rng, period) {
  const g = new Float32Array(period * period).map(() => rng());
  const at = (x, y) => g[((y % period) + period) % period * period + (((x % period) + period) % period)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
}
function getPaperTile() {
  if (paperTile) return paperTile;
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), img = g.createImageData(S, S), rng = makeRng('paper');
  const octs = [[4, 0.5], [8, 0.25], [16, 0.13], [32, 0.07], [128, 0.05]].map(([p, a]) => [tileValueNoise(rng, p), p, a]);
  const fib = tileValueNoise(rng, 64);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let n = 0; for (const [f, p, a] of octs) n += f((x / S) * p, (y / S) * p) * a;
    const fv = fib((x / S) * 64, (y / S) * 6);
    const fiber = Math.abs(fv - 0.5) < 0.012 ? 0.06 : 0;
    const grain = (rng() - 0.5) * 0.05;
    const dark = Math.max(0, Math.min(1, (n - 0.35) * 0.9 + grain + fiber)); // 0 = clean paper
    const i = (y * S + x) * 4;
    img.data[i] = 255 - dark * 70; img.data[i + 1] = 252 - dark * 88; img.data[i + 2] = 240 - dark * 115; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  paperTile = cv; return cv;
}

export class CanvasPainter {
  constructor(ctx, scale, assets, style) { this.ctx = ctx; this.scale = scale; this.assets = assets; this.style = style; this.stack = []; this.pool = []; }
  _path(rings, closed) {
    const c = this.ctx; c.beginPath();
    for (const r of rings) { if (!r || r.length < 4) continue; c.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) c.lineTo(r[i], r[i + 1]); if (closed) c.closePath(); }
  }
  _apply(st) {
    const c = this.ctx; c.globalAlpha = st.alpha ?? 1;
    if (st.fill) { c.fillStyle = st.fill; c.fill(st.rule || 'nonzero'); }
    if (st.stroke) { c.strokeStyle = st.stroke; c.lineWidth = st.width || 1; c.lineJoin = st.join || 'round'; c.lineCap = st.cap || 'round'; c.setLineDash(st.dash || []); c.stroke(); c.setLineDash([]); }
    c.globalAlpha = 1;
  }
  poly(rings, st) { this._path(rings, true); this._apply(st); }
  lines(list, st) { this._path(list, false); this._apply({ ...st, fill: null }); }
  circle(x, y, r, st) { const c = this.ctx; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); this._apply(st); }
  rect(x, y, w, h, st) { const c = this.ctx; c.beginPath(); c.rect(x, y, w, h); this._apply(st); }
  text(str, x, y, st) {
    const c = this.ctx; c.save(); c.translate(x, y); if (st.rot) c.rotate((st.rot * Math.PI) / 180);
    c.font = `${st.italic ? 'italic ' : ''}${st.weight || 'normal'} ${st.size}px ${st.family}`;
    c.letterSpacing = (st.spacing || 0) + 'px';
    c.textAlign = st.align || 'center'; c.textBaseline = 'middle';
    const dx = st.align === 'left' ? 0 : (st.spacing || 0) / 2;
    c.globalAlpha = st.alpha ?? 1;
    if (st.halo) { c.strokeStyle = st.halo; c.lineWidth = st.haloWidth ?? st.size * 0.28; c.lineJoin = 'round'; c.strokeText(str, dx, 0); }
    c.fillStyle = st.color; c.fillText(str, dx, 0);
    c.restore();
  }
  measure(str, st) { const c = this.ctx; c.save(); c.font = `${st.italic ? 'italic ' : ''}${st.weight || 'normal'} ${st.size}px ${st.family}`; c.letterSpacing = (st.spacing || 0) + 'px'; const w = c.measureText(str).width; c.restore(); return w; }
  icon(id, x, y, size, rot = 0, alpha = 1) {
    const img = this.assets.image(id, this.style.iconPalette, this.style.palette); if (!img) return;
    const c = this.ctx; c.save(); c.globalAlpha = alpha; c.translate(x, y); if (rot) c.rotate((rot * Math.PI) / 180);
    const ar = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
    const w = ar >= 1 ? size : size * ar, h = ar >= 1 ? size / ar : size;
    c.drawImage(img, -w / 2, -h / 2, w, h); c.restore();
  }
  clip(rings, rule = 'evenodd') { this.ctx.save(); this._path(rings, true); this.ctx.clip(rule); }
  unclip() { this.ctx.restore(); }
  group(o = {}) {
    // Blurred groups are rendered at reduced resolution (cheap blur), others at full size.
    const base = this.ctx.canvas, depth = this.stack.length;
    const ds = o.blur ? Math.max(1, Math.min(6, Math.floor((o.blur * this.scale) / 2))) : 1;
    const w = Math.ceil(base.width / ds), h = Math.ceil(base.height / ds);
    let oc = this.pool[depth];
    if (!oc || oc.canvas.width !== w || oc.canvas.height !== h) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; oc = cv.getContext('2d'); this.pool[depth] = oc; }
    oc.setTransform(1, 0, 0, 1, 0, 0); oc.clearRect(0, 0, w, h);
    const t = this.ctx.getTransform(); oc.setTransform(t.a / ds, t.b / ds, t.c / ds, t.d / ds, t.e / ds, t.f / ds);
    this.stack.push({ ctx: this.ctx, o, ds }); this.ctx = oc;
  }
  ungroup() {
    const { ctx, o, ds } = this.stack.pop(); const oc = this.ctx; this.ctx = ctx;
    let src = oc.canvas;
    if (o.blur) {
      const key = 'blur' + this.stack.length;
      let bc = this.pool[key];
      if (!bc || bc.canvas.width !== src.width || bc.canvas.height !== src.height) { const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height; bc = cv.getContext('2d'); this.pool[key] = bc; }
      bc.setTransform(1, 0, 0, 1, 0, 0); bc.clearRect(0, 0, src.width, src.height);
      bc.filter = `blur(${Math.max(0.5, (o.blur * this.scale) / ds)}px)`; bc.drawImage(src, 0, 0); bc.filter = 'none';
      src = bc.canvas;
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = o.alpha ?? 1;
    if (o.blend) ctx.globalCompositeOperation = o.blend;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, src.width * ds, src.height * ds); ctx.restore();
  }
  gradientRect(x, y, w, h, g) {
    const c = this.ctx; let gr;
    if (g.type === 'radial') gr = c.createRadialGradient(g.cx, g.cy, g.r0, g.cx, g.cy, g.r1);
    else gr = c.createLinearGradient(g.x1, g.y1, g.x2, g.y2);
    g.stops.forEach(([o, col]) => gr.addColorStop(o, col));
    c.fillStyle = gr; c.fillRect(x, y, w, h);
  }
  paper(x, y, w, h, alpha) {
    if (alpha <= 0) return;
    const c = this.ctx, pat = c.createPattern(getPaperTile(), 'repeat');
    pat.setTransform(new DOMMatrix().scale(0.8));
    c.save(); c.globalAlpha = alpha; c.globalCompositeOperation = 'multiply'; c.fillStyle = pat; c.fillRect(x, y, w, h); c.restore();
  }
}

const f1 = (v) => Math.round(v * 10) / 10;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class SvgPainter {
  constructor(W, H, style, customAssets = []) { this.W = W; this.H = H; this.style = style; this.out = []; this.defs = []; this.symbols = new Set(); this.idc = 0; this.scale = 1; this.custom = new Map(customAssets.map((c) => [c.id, c])); }
  _d(rings, closed) {
    let d = '';
    for (const r of rings) { if (!r || r.length < 4) continue; d += 'M' + f1(r[0]) + ' ' + f1(r[1]); for (let i = 2; i < r.length; i += 2) d += 'L' + f1(r[i]) + ' ' + f1(r[i + 1]); if (closed) d += 'Z'; }
    return d;
  }
  _st(st, isLine) {
    let a = '';
    a += st.fill && !isLine ? ` fill="${st.fill}"` : ' fill="none"';
    if (st.rule === 'evenodd') a += ' fill-rule="evenodd"';
    if (st.stroke) a += ` stroke="${st.stroke}" stroke-width="${f1(st.width || 1) || 0.1}" stroke-linejoin="${st.join || 'round'}" stroke-linecap="${st.cap || 'round'}"` + (st.dash && st.dash.length ? ` stroke-dasharray="${st.dash.join(' ')}"` : '');
    if (st.alpha != null && st.alpha !== 1) a += ` opacity="${+st.alpha.toFixed(3)}"`;
    return a;
  }
  poly(rings, st) { const d = this._d(rings, true); if (d) this.out.push(`<path d="${d}"${this._st(st)}/>`); }
  lines(list, st) { const d = this._d(list, false); if (d) this.out.push(`<path d="${d}"${this._st(st, true)}/>`); }
  circle(x, y, r, st) { this.out.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}"${this._st(st)}/>`); }
  rect(x, y, w, h, st) { this.out.push(`<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}"${this._st(st)}/>`); }
  text(str, x, y, st) {
    const anchor = st.align === 'left' ? 'start' : st.align === 'right' ? 'end' : 'middle';
    const tr = st.rot ? ` transform="rotate(${st.rot} ${f1(x)} ${f1(y)})"` : '';
    const common = `x="${f1(x)}" y="${f1(y)}" font-family="${esc(st.family)}" font-size="${st.size}"${st.italic ? ' font-style="italic"' : ''}${st.weight && st.weight !== 'normal' ? ` font-weight="${st.weight}"` : ''} letter-spacing="${st.spacing || 0}" text-anchor="${anchor}" dominant-baseline="central"${tr}${st.alpha != null && st.alpha !== 1 ? ` opacity="${st.alpha}"` : ''}`;
    if (st.halo) this.out.push(`<text ${common} fill="${st.halo}" stroke="${st.halo}" stroke-width="${f1(st.haloWidth ?? st.size * 0.28)}" stroke-linejoin="round">${esc(str)}</text>`);
    this.out.push(`<text ${common} fill="${st.color}">${esc(str)}</text>`);
  }
  measure(str, st) { return str.length * st.size * 0.55 + (st.spacing || 0) * str.length; }
  icon(id, x, y, size, rot = 0, alpha = 1) {
    const tr = `translate(${f1(x)} ${f1(y)})${rot ? ` rotate(${rot})` : ''}`;
    if (this.custom.has(id)) { this.out.push(`<image href="${this.custom.get(id).dataUrl}" x="${f1(-size / 2)}" y="${f1(-size / 2)}" width="${f1(size)}" height="${f1(size)}" transform="${tr}" opacity="${alpha}" preserveAspectRatio="xMidYMid meet"/>`); return; }
    if (!this.symbols.has(id)) { this.symbols.add(id); this.defs.push(`<symbol id="ic-${id}" viewBox="0 0 64 64">${assetMarkup(id, this.style.iconPalette)}</symbol>`); }
    this.out.push(`<use href="#ic-${id}" x="${f1(-size / 2)}" y="${f1(-size / 2)}" width="${f1(size)}" height="${f1(size)}" transform="${tr}"${alpha !== 1 ? ` opacity="${alpha}"` : ''}/>`);
  }
  clip(rings, rule = 'evenodd') { const id = 'clip' + this.idc++; this.defs.push(`<clipPath id="${id}"><path d="${this._d(rings, true)}" clip-rule="${rule}"/></clipPath>`); this.out.push(`<g clip-path="url(#${id})">`); }
  unclip() { this.out.push('</g>'); }
  group(o = {}) {
    let attr = '';
    if (o.blur) { const id = 'blur' + this.idc++; this.defs.push(`<filter id="${id}" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${o.blur}"/></filter>`); attr += ` filter="url(#${id})"`; }
    if (o.alpha != null) attr += ` opacity="${o.alpha}"`;
    if (o.blend) attr += ` style="mix-blend-mode:${o.blend}"`;
    this.out.push(`<g${attr}>`);
  }
  ungroup() { this.out.push('</g>'); }
  gradientRect(x, y, w, h, g) {
    const id = 'grad' + this.idc++;
    const stops = g.stops.map(([o, c]) => { const m = c.match(/rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(','); return `<stop offset="${o}" stop-color="rgb(${p[0]},${p[1]},${p[2]})" stop-opacity="${p[3] ?? 1}"/>`; } return `<stop offset="${o}" stop-color="${c}"/>`; }).join('');
    if (g.type === 'radial') this.defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${f1(g.cx)}" cy="${f1(g.cy)}" r="${f1(g.r1)}" fx="${f1(g.cx)}" fy="${f1(g.cy)}">${stops}</radialGradient>`);
    else this.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f1(g.x1)}" y1="${f1(g.y1)}" x2="${f1(g.x2)}" y2="${f1(g.y2)}">${stops}</linearGradient>`);
    this.out.push(`<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="url(#${id})"/>`);
  }
  paper(x, y, w, h, alpha) {
    if (alpha <= 0) return;
    const id = 'paper' + this.idc++;
    this.defs.push(`<filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="4" seed="7"/><feColorMatrix type="matrix" values="0 0 0 0 0.42 0 0 0 0 0.33 0 0 0 0 0.2 0 0 0 -0.9 0.62"/></filter>`);
    this.out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" filter="url(#${id})" opacity="${alpha * 0.6}" style="mix-blend-mode:multiply"/>`);
  }
  toString() {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${this.W} ${this.H}" width="${this.W}" height="${this.H}">\n<defs>${this.defs.join('\n')}</defs>\n${this.out.join('\n')}\n</svg>`;
  }
}

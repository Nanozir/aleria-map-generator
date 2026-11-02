// Seeded random numbers and coherent noise. Original implementation (no external deps).

/** Hash a string into a 32-bit seed (xmur3-style mix). */
export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** Create a seeded PRNG (mulberry32) with helper methods. */
export function makeRng(seed) {
  let a = hashString(String(seed));
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = () => next();
  r.range = (lo, hi) => lo + next() * (hi - lo);
  r.int = (lo, hi) => Math.floor(lo + next() * (hi - lo + 1));
  r.pick = (arr) => arr[Math.floor(next() * arr.length)];
  r.chance = (p) => next() < p;
  r.normal = () => { let u = 0, v = 0; while (!u) u = next(); while (!v) v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  r.shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  return r;
}

/** 2D gradient noise (Perlin-style) seeded from an rng. Returns f(x,y) in about [-1,1]. */
export function makeNoise2D(rng) {
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(16), gy = new Float32Array(16);
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const g00 = perm[X + perm[Y]] & 15, g10 = perm[X + 1 + perm[Y]] & 15;
    const g01 = perm[X + perm[Y + 1]] & 15, g11 = perm[X + 1 + perm[Y + 1]] & 15;
    const n00 = gx[g00] * xf + gy[g00] * yf;
    const n10 = gx[g10] * (xf - 1) + gy[g10] * yf;
    const n01 = gx[g01] * xf + gy[g01] * (yf - 1);
    const n11 = gx[g11] * (xf - 1) + gy[g11] * (yf - 1);
    const u = fade(xf), v = fade(yf);
    return 1.4 * ((n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v);
  };
}

/** Fractal Brownian motion. */
export function fbm(noise, x, y, oct = 5, lac = 2, gain = 0.5) {
  let amp = 1, f = 1, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) { sum += amp * noise(x * f, y * f); norm += amp; amp *= gain; f *= lac; }
  return sum / norm;
}

/** Ridged multifractal noise in [0,1] (sharp crests, good for mountain ranges). */
export function ridged(noise, x, y, oct = 4) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) { const v = 1 - Math.abs(noise(x * f, y * f)); sum += amp * v * v; norm += amp; amp *= 0.5; f *= 2.1; }
  return sum / norm;
}

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

/** Minimal binary min-heap keyed by priority (used by Dijkstra / A*). */
export class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(val, pri) {
    const k = this.k, v = this.v; let i = k.length; k.push(pri); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= pri) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = pri; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v; const top = v[0]; this.lastPri = k[0];
    const lk = k.pop(), lv = v.pop(); const n = k.length;
    if (n) {
      let i = 0;
      while (true) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

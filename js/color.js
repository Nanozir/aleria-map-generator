// Tiny colour helpers.
export function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const v = parseInt(h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export function mix(a, b, t) { const A = hexToRgb(a), Bc = hexToRgb(b); return rgbToHex(A.map((v, i) => v + (Bc[i] - v) * t)); }
export function shade(hex, f) { // f>0 lighten, f<0 darken
  return f >= 0 ? mix(hex, '#ffffff', f) : mix(hex, '#000000', -f);
}
export function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
export function desaturate(hex, t) { const [r, g, b] = hexToRgb(hex); const l = 0.3 * r + 0.59 * g + 0.11 * b; return rgbToHex([r + (l - r) * t, g + (l - g) * t, b + (l - b) * t]); }

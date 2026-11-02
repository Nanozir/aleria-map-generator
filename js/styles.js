// Map style presets. Each preset defines palettes and effect flags; users can override
// land tint / water / border colours and effect strengths in the Style panel.
import { mix, desaturate, shade } from './color.js';

export const FONTS = {
  serif: "'Palatino Linotype','Book Antiqua',Palatino,'URW Palladio L',P052,Georgia,serif",
  title: "'Cinzel','Trajan Pro','Palatino Linotype','Book Antiqua','URW Palladio L',P052,Georgia,serif",
  sans: "'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  script: "'Brush Script MT','URW Chancery L',Z003,'Apple Chancery',cursive",
};

// Natural biome colours; styles derive their palettes from these.
const NATURAL = {
  ocean: '#4f7fa8', lake: '#5d8db5', glacier: '#eef3f6', tundra: '#c3c8b2', coldwaste: '#ada592', taiga: '#5e7a5c', plains: '#a7bf78',
  forest: '#5f8c4a', ancient: '#3e6b3a', hills: '#a69c6c', mountain: '#8b7a66', snowpeak: '#f4f4f2', jungle: '#2f7838', savanna: '#cbb96a',
  desert: '#ddc28c', swamp: '#6b7d5e', storm: '#79807a', anomaly: '#a487d1',
};

function derive(fn) { const o = {}; for (const [k, v] of Object.entries(NATURAL)) o[k] = fn(v, k); return o; }

export const STYLE_PRESETS = {
  parchment: {
    name: 'Classic Parchment', paper: '#e6d5ab', waterShallow: '#aebfb4', waterDeep: '#869d97', coast: '#4b3826', coastWidth: 1.4,
    ripples: 'soft', rippleColor: '#6d5b3f', contours: false, oceanContours: true, relief: true, reliefInk: '#4b3826', reliefFill: '#eadcb6',
    paperTexture: 0.6, vignette: 0.5, text: '#2e2112', halo: '#ecdfbd', font: 'serif', border: '#7d2a22', road: '#6b4a2b', river: '#5d7c88',
    palette: 'parchment', fog: '#eee5cb', hillshade: 0.35, landTint: '#d6c393', tint: 0.0,
    biomes: derive((c) => mix(desaturate(c, 0.45), '#d9c79a', 0.45)),
  },
  ink: {
    name: 'Parchment & Ink', paper: '#efe5c9', waterShallow: '#dfdcc6', waterDeep: '#cfcdb4', coast: '#1d160e', coastWidth: 2,
    ripples: 'ink', rippleColor: '#2a2016', contours: true, oceanContours: false, relief: true, reliefInk: '#1d160e', reliefFill: '#f2e9d0',
    paperTexture: 0.65, vignette: 0.45, text: '#1d160e', halo: '#f1e8cf', font: 'serif', border: '#1d160e', road: '#3b2b1b', river: '#2b2b2b',
    palette: 'ink', fog: '#f2ead3', hillshade: 0.15, landTint: '#efe5c9', tint: 0,
    biomes: derive((c) => mix(desaturate(c, 0.7), '#efe5c9', 0.78)),
  },
  modern: {
    name: 'Clean Modern', paper: '#f5f7f8', waterShallow: '#8fc1e3', waterDeep: '#3f78ad', coast: '#2e4d63', coastWidth: 0.8,
    ripples: 'none', rippleColor: '#ffffff', contours: false, oceanContours: false, relief: true, reliefInk: '#3e4a3d', reliefFill: '#ffffff',
    paperTexture: 0, vignette: 0, text: '#1d2731', halo: '#ffffff', font: 'sans', border: '#c0392b', road: '#7a5230', river: '#3f86c4',
    palette: 'modern', fog: '#e9eef2', hillshade: 0.45, landTint: '#ffffff', tint: 0,
    biomes: derive((c) => c),
  },
  stormy: {
    name: 'Dark & Stormy', paper: '#141a20', waterShallow: '#26323e', waterDeep: '#0d141b', coast: '#9fb6c9', coastWidth: 1.1,
    ripples: 'glow', rippleColor: '#6f8ea8', contours: false, oceanContours: true, relief: true, reliefInk: '#c9d3da', reliefFill: '#39434b',
    paperTexture: 0.25, vignette: 0.75, text: '#e4dac2', halo: '#0e1318', font: 'title', border: '#d06a4c', road: '#b39a74', river: '#6f97b8',
    palette: 'stormy', fog: '#05080b', hillshade: 0.5, landTint: '#3a4148', tint: 0,
    biomes: derive((c) => mix(shade(desaturate(c, 0.55), -0.45), '#2c343b', 0.35)),
  },
  contrast: {
    name: 'High Contrast', paper: '#ffffff', waterShallow: '#0b2a6b', waterDeep: '#020c26', coast: '#ffffff', coastWidth: 2.2,
    ripples: 'none', rippleColor: '#ffffff', contours: false, oceanContours: false, relief: true, reliefInk: '#000000', reliefFill: '#ffffff',
    paperTexture: 0, vignette: 0, text: '#000000', halo: '#ffffff', font: 'sans', border: '#ff2d2d', road: '#000000', river: '#00b4ff',
    palette: 'contrast', fog: '#000000', hillshade: 0.25, landTint: '#ffffff', tint: 0,
    biomes: {
      ocean: '#0b2a6b', lake: '#00b4ff', glacier: '#ffffff', tundra: '#e6e6e6', coldwaste: '#cfcfcf', taiga: '#3f8f5a', plains: '#ffe066', forest: '#2e9c4a',
      ancient: '#0f6b2c', hills: '#d9a05b', mountain: '#8a5a2b', snowpeak: '#ffffff', jungle: '#00a86b', savanna: '#ffc300', desert: '#ffb347', swamp: '#6c8a3a',
      storm: '#9b9bb5', anomaly: '#d65bff',
    },
  },
};

/** Icon palettes (placeholders used inside SVG assets). */
export const ICON_PALETTES = {
  parchment: { I: '#3b2b1b', F: '#f1e5c6', A: '#9b2d20', G: '#c99a2e', L: '#58c7e6', R: '#b3261e', S: '#8a857c' },
  ink: { I: '#16110b', F: '#f4ecd6', A: '#16110b', G: '#8a6a1c', L: '#3a8fb0', R: '#8b1a12', S: '#8a857c' },
  modern: { I: '#1f2933', F: '#ffffff', A: '#c0392b', G: '#e0a800', L: '#22b8e6', R: '#d62828', S: '#8d939a' },
  stormy: { I: '#e8e0cc', F: '#2b343d', A: '#e2583e', G: '#e3b54a', L: '#7fe3ff', R: '#ff4d3a', S: '#6c737a' },
  contrast: { I: '#000000', F: '#ffffff', A: '#ff0000', G: '#ffbf00', L: '#00b4ff', R: '#ff0000', S: '#777777' },
};

export function defaultStyle(preset = 'parchment') {
  const p = STYLE_PRESETS[preset];
  return { preset, landTint: p.landTint, tint: 0, water: p.waterShallow, border: p.border, coast: p.coast, text: p.text,
    paperTexture: p.paperTexture, vignette: p.vignette, relief: p.relief, reliefDensity: 1, ripples: p.ripples !== 'none', contours: p.contours,
    hillshade: p.hillshade, font: p.font, iconScale: 1, overlayOpacity: 0.55 };
}

/** Merge preset + user overrides into the effective style used by the renderer. */
export function effectiveStyle(st) {
  const p = STYLE_PRESETS[st.preset] || STYLE_PRESETS.parchment;
  const water = st.water || p.waterShallow;
  const waterDeep = st.water && st.water !== p.waterShallow ? shade(st.water, -0.3) : p.waterDeep;
  const biomes = {};
  for (const [k, v] of Object.entries(p.biomes)) biomes[k] = st.tint > 0 ? mix(v, st.landTint, st.tint) : v;
  biomes.lake = mix(water, waterDeep, 0.2);
  return { ...p, ...st, presetDef: p, waterShallow: water, waterDeep, biomes, fontFamily: FONTS[st.font] || FONTS.serif, titleFamily: st.font === 'sans' ? FONTS.sans : FONTS.title,
    border: st.border || p.border, coast: st.coast || p.coast, text: st.text || p.text, iconPalette: ICON_PALETTES[p.palette] };
}

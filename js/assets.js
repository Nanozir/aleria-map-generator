// Original SVG icon/stamp library. Each icon is drawn in a 64x64 box centred on (32,32).
// Colour placeholders are substituted per style: I=ink, F=fill, A=accent, G=gold,
// L=glow (mana/lumenari), R=crimson, S=stone.

const sw = 'stroke-linejoin="round" stroke-linecap="round"';
export const ASSETS = [
  // ---- settlements
  { id: 'capital', name: 'Capital (palace-temple)', cat: 'settlement', svg: `
    <circle cx="32" cy="34" r="29" fill="G" opacity=".18"/>
    <path d="M6 56h52v-5H6z" fill="F" stroke="I" stroke-width="2.4" ${sw}/>
    <rect x="15" y="31" width="34" height="20" fill="F" stroke="I" stroke-width="2.6"/>
    <path d="M20 31a12 12 0 0 1 24 0z" fill="G" stroke="I" stroke-width="2.6" ${sw}/>
    <path d="M7 51V24h9v27M48 51V24h9v27" fill="F" stroke="I" stroke-width="2.4" ${sw}/>
    <path d="M6 24l5.5-11 5.5 11zM47 24l5.5-11 5.5 11z" fill="A" stroke="I" stroke-width="2.2" ${sw}/>
    <path d="M32 19V9" stroke="I" stroke-width="2.4"/><circle cx="32" cy="7" r="4" fill="G" stroke="I" stroke-width="1.8"/>
    <path d="M22 37v14M28 37v14M36 37v14M42 37v14" stroke="I" stroke-width="2"/>` },
  { id: 'city', name: 'City', cat: 'settlement', svg: `
    <path d="M8 54V30h6v-5h4v5h6V22h-2l7-9 7 9h-2v8h6v-5h4v5h6v24z" fill="F" stroke="I" stroke-width="2.8" ${sw}/>
    <path d="M27 54v-8a5 5 0 0 1 10 0v8z" fill="I"/><path d="M31 13V5l7 2.5-7 2.5" fill="A" stroke="I" stroke-width="1.6" ${sw}/>` },
  { id: 'town', name: 'Town', cat: 'settlement', svg: `
    <path d="M6 54V38l9-8 9 8v16z" fill="F" stroke="I" stroke-width="2.6" ${sw}/>
    <path d="M40 54V40l9-7 9 7v14z" fill="F" stroke="I" stroke-width="2.6" ${sw}/>
    <path d="M21 54V30l11-10 11 10v24z" fill="F" stroke="I" stroke-width="2.8" ${sw}/>
    <path d="M21 30l11-10 11 10" fill="none" stroke="A" stroke-width="3" ${sw}/><rect x="29" y="44" width="6" height="10" fill="I"/>` },
  { id: 'village', name: 'Village', cat: 'settlement', svg: `
    <path d="M14 52V36l18-14 18 14v16z" fill="F" stroke="I" stroke-width="3.5" ${sw}/><rect x="28" y="40" width="8" height="12" fill="I"/>` },
  { id: 'fortress', name: 'Fortress', cat: 'settlement', svg: `
    <path d="M12 56V24h7v-6h6v6h4v-6h6v6h4v-6h6v6h7v32z" fill="F" stroke="I" stroke-width="2.8" ${sw}/>
    <path d="M27 56V45a5 5 0 0 1 10 0v11z" fill="I"/><path d="M18 32h6v6h-6zM40 32h6v6h-6z" fill="I"/>
    <path d="M32 18V5l11 4-11 4" fill="A" stroke="I" stroke-width="1.8" ${sw}/>` },
  { id: 'temple', name: 'Temple (Church of Ucliat)', cat: 'settlement', svg: `
    <path d="M12 56V32l20-15 20 15v24z" fill="F" stroke="I" stroke-width="2.8" ${sw}/>
    <path d="M32 17V4M27 8h10" stroke="I" stroke-width="2.6" ${sw}/>
    <circle cx="32" cy="38" r="8" fill="G" stroke="I" stroke-width="2"/>
    <path d="M26 32l12 12M38 32L26 44" stroke="I" stroke-width="2.2" ${sw}/>
    <path d="M28 56v-6h8v6" fill="I"/>` },
  { id: 'dungeon', name: 'Dungeon entrance', cat: 'settlement', svg: `
    <path d="M6 56c2-20 11-33 26-33s24 13 26 33z" fill="S" stroke="I" stroke-width="2.6" ${sw}/>
    <path d="M18 56c0-11 6-19 14-19s14 8 14 19z" fill="I"/>
    <path d="M22 50h20M24 45h16" stroke="F" stroke-width="1.6" opacity=".6"/>
    <path d="M12 38l5 2M50 36l-5 3M24 27l2 4M41 28l-2 4" stroke="I" stroke-width="2" ${sw}/>
    <circle cx="32" cy="47" r="3" fill="L" opacity=".9"/>` },
  // ---- lore markers
  { id: 'church', name: 'Church', cat: 'marker', svg: `
    <path d="M10 56V34l14-10 14 10v22z" fill="F" stroke="I" stroke-width="2.6" ${sw}/>
    <path d="M38 56V22l8-12 8 12v34z" fill="F" stroke="I" stroke-width="2.6" ${sw}/>
    <circle cx="46" cy="26" r="4" fill="G" stroke="I" stroke-width="1.6"/><path d="M46 10V3M43 5.5h6" stroke="I" stroke-width="2.2"/>
    <path d="M20 56v-9a4 4 0 0 1 8 0v9" fill="I"/>` },
  { id: 'knights', name: 'Church Knights', cat: 'marker', svg: `
    <ellipse cx="32" cy="9" rx="13" ry="4" fill="none" stroke="G" stroke-width="3"/>
    <path d="M19 42V25a13 13 0 0 1 26 0v17l-5 5H24z" fill="#c9ccd2" stroke="I" stroke-width="2.6" ${sw}/>
    <path d="M23 29h18" stroke="I" stroke-width="3.5"/><path d="M32 33v10" stroke="I" stroke-width="2"/>
    <path d="M20 47q12 6 24 0" fill="none" stroke="#b9bcc4" stroke-width="2.4" stroke-dasharray="2.5 2"/>
    <circle cx="32" cy="54" r="7" fill="G" stroke="I" stroke-width="2"/><path d="M28 50l8 8M36 50l-8 8" stroke="I" stroke-width="1.8"/>` },
  { id: 'crimson', name: 'Crimson Sun symbol', cat: 'marker', svg: `
    <g fill="R" stroke="I" stroke-width="1.5" ${sw}>
      <path d="M32 3l4 13h-8zM32 61l-4-13h8zM3 32l13-4v8zM61 32l-13 4v-8zM11.5 11.5l12 6.5-5.7 5.7zM52.5 52.5l-12-6.5 5.7-5.7zM52.5 11.5l-6.5 12-5.7-5.7zM11.5 52.5l6.5-12 5.7 5.7z"/>
    </g>
    <circle cx="32" cy="32" r="14" fill="R" stroke="I" stroke-width="2.4"/>
    <circle cx="32" cy="32" r="6" fill="I"/><circle cx="32" cy="32" r="2.2" fill="R"/>` },
  { id: 'summoning', name: 'Summoning circle', cat: 'marker', svg: `
    <circle cx="32" cy="32" r="28" fill="L" opacity=".15"/>
    <g fill="none" stroke="L" stroke-width="2.2"><circle cx="32" cy="32" r="27"/><circle cx="32" cy="32" r="21"/>
    <path d="M32 11L50.2 42.5H13.8zM32 53L13.8 21.5h36.4z"/></g>
    <g fill="L"><circle cx="32" cy="7.5" r="1.8"/><circle cx="56.5" cy="32" r="1.8"/><circle cx="32" cy="56.5" r="1.8"/><circle cx="7.5" cy="32" r="1.8"/>
    <circle cx="49.3" cy="14.7" r="1.4"/><circle cx="14.7" cy="49.3" r="1.4"/><circle cx="49.3" cy="49.3" r="1.4"/><circle cx="14.7" cy="14.7" r="1.4"/></g>
    <circle cx="32" cy="32" r="4" fill="G"/>` },
  { id: 'lumenari', name: 'Lumenari (cracked stone humanoid)', cat: 'marker', svg: `
    <circle cx="32" cy="34" r="29" fill="L" opacity=".18"/>
    <path d="M32 4a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15zM21 22h22l5 19-6 2-2 17h-6.5L32 48l-1.5 12H24l-2-17-6-2z" fill="S" stroke="I" stroke-width="2.2" ${sw}/>
    <path d="M30 7l3 4-2.5 3.5M28 25l5 6-3.5 5 4 6M39 27l-3 5 3 4M24 30l3 3" fill="none" stroke="L" stroke-width="2.2" ${sw}/>` },
  { id: 'breach', name: 'Doomsday breach', cat: 'marker', svg: `
    <circle cx="32" cy="32" r="28" fill="R" opacity=".22"/>
    <path d="M8 31l9 3 4-9 6 11 6-14 4 12 8-5 4 4-8 7-9-1-4 10-6-9-8 4-5-6z" fill="I" stroke="R" stroke-width="2.2" ${sw}/>
    <path d="M27 36l5-8 4 9" fill="none" stroke="R" stroke-width="2" ${sw}/>` },
  { id: 'relic', name: 'Lost Magic relic', cat: 'marker', svg: `
    <path d="M32 6l15 15-15 37-15-37z" fill="L" stroke="I" stroke-width="2.4" ${sw}/>
    <path d="M17 21h30M32 6v52M24 21l8 37 8-37" fill="none" stroke="I" stroke-width="1.6" ${sw}/>
    <path d="M52 6v10M47 11h10M10 40v8M6 44h8" stroke="G" stroke-width="2.2" ${sw}/>` },
  { id: 'ruins', name: 'Ruins', cat: 'marker', svg: `
    <path d="M6 56h52" stroke="I" stroke-width="3" ${sw}/>
    <path d="M12 56V26h8v30zM28 56V36l8-3v23zM44 56V40h8v16z" fill="S" stroke="I" stroke-width="2.4" ${sw}/>
    <path d="M9 26h14v-4H9zM20 18l10-2" fill="S" stroke="I" stroke-width="2.2" ${sw}/><path d="M36 54l6-4" stroke="I" stroke-width="2"/>` },
  { id: 'monster', name: 'Monster', cat: 'marker', svg: `
    <path d="M18 24C8 20 5 10 8 3c2 8 8 11 14 13zM46 24c10-4 13-14 10-21-2 8-8 11-14 13z" fill="F" stroke="I" stroke-width="2.4" ${sw}/>
    <path d="M17 20h30l-2 19-6 14H25l-6-14z" fill="F" stroke="I" stroke-width="2.6" ${sw}/>
    <path d="M22 30l7 3-7 2zM42 30l-7 3 7 2z" fill="A"/><path d="M26 47l2 4 2-4 2 4 2-4 2 4 2-4" fill="none" stroke="I" stroke-width="1.8" ${sw}/>` },
  { id: 'military', name: 'Military marker', cat: 'marker', svg: `
    <path d="M14 50L46 12M50 50L18 12" stroke="I" stroke-width="4.5" ${sw}/>
    <path d="M14 50L46 12M50 50L18 12" stroke="F" stroke-width="1.6" ${sw}/>
    <path d="M10 44l10 8M54 44l-10 8" stroke="A" stroke-width="4" ${sw}/><circle cx="32" cy="31" r="5" fill="G" stroke="I" stroke-width="2"/>` },
  // ---- nature & decoration stamps
  { id: 'tree', name: 'Tree', cat: 'nature', svg: `
    <path d="M32 58V40" stroke="I" stroke-width="4" ${sw}/><path d="M32 6c-10 0-16 8-15 15-6 3-8 12-2 17 5 4 12 3 17 0 5 3 12 4 17 0 6-5 4-14-2-17 1-7-5-15-15-15z" fill="#6f9a52" stroke="I" stroke-width="2.6" ${sw}/>` },
  { id: 'pine', name: 'Pine', cat: 'nature', svg: `
    <path d="M32 60V48" stroke="I" stroke-width="4"/><path d="M32 4L14 30h8L10 48h44L42 30h8z" fill="#4c7356" stroke="I" stroke-width="2.6" ${sw}/>` },
  { id: 'mountain', name: 'Mountain', cat: 'nature', svg: `
    <path d="M2 56L26 12l10 14 6-8 20 38z" fill="F" stroke="I" stroke-width="2.6" ${sw}/>
    <path d="M26 12l4 44h-8zM26 12l-6 16 6-3 5 4z" fill="I" opacity=".35"/><path d="M26 12l-5 11 5-2 4 3z" fill="#ffffff" opacity=".8"/>` },
  { id: 'hills', name: 'Hills', cat: 'nature', svg: `<path d="M2 52c6-16 18-16 24 0M22 52c8-22 26-22 34 0" fill="F" stroke="I" stroke-width="2.8" ${sw}/>` },
  { id: 'house', name: 'Building', cat: 'deco', svg: `<path d="M12 56V30l20-16 20 16v26z" fill="F" stroke="I" stroke-width="2.8" ${sw}/><path d="M10 31l22-18 22 18" fill="none" stroke="A" stroke-width="3.2" ${sw}/><rect x="27" y="40" width="10" height="16" fill="I"/>` },
  { id: 'tower', name: 'Tower', cat: 'deco', svg: `<path d="M22 58V20h-3V10h5v4h4v-4h8v4h4v-4h5v10h-3v38z" fill="F" stroke="I" stroke-width="2.6" ${sw}/><rect x="29" y="26" width="6" height="8" fill="I"/><path d="M28 58v-9h8v9" fill="I"/>` },
  { id: 'ship', name: 'Ship', cat: 'deco', svg: `<path d="M8 40h48l-8 14H16z" fill="#8a5a33" stroke="I" stroke-width="2.6" ${sw}/><path d="M32 40V6" stroke="I" stroke-width="2.6"/><path d="M33 9c12 6 14 18 12 28H33zM31 13C21 19 19 29 21 37h10z" fill="F" stroke="I" stroke-width="2.2" ${sw}/><path d="M32 6l9 3-9 3" fill="A"/>` },
  { id: 'storm', name: 'Storm cloud', cat: 'deco', svg: `<path d="M16 40a10 10 0 0 1 2-20 14 14 0 0 1 27-3 11 11 0 0 1 3 22z" fill="#6c7480" stroke="I" stroke-width="2.4" ${sw}/><path d="M32 38l-6 12h6l-4 11 12-15h-6l4-8z" fill="G" stroke="I" stroke-width="1.6" ${sw}/>` },
  { id: 'skull', name: 'Danger (skull)', cat: 'deco', svg: `<path d="M32 6C19 6 11 15 11 27c0 7 3 11 7 14v9h28v-9c4-3 7-7 7-14C53 15 45 6 32 6z" fill="F" stroke="I" stroke-width="2.6" ${sw}/><circle cx="24" cy="29" r="5" fill="I"/><circle cx="40" cy="29" r="5" fill="I"/><path d="M32 35l-3 6h6z" fill="I"/><path d="M26 50v6M32 50v6M38 50v6" stroke="I" stroke-width="2.4"/>` },
  { id: 'banner', name: 'Banner', cat: 'deco', svg: `<path d="M16 60V4" stroke="I" stroke-width="3.2" ${sw}/><path d="M17 6h32l-8 11 8 11H17z" fill="A" stroke="I" stroke-width="2.4" ${sw}/><circle cx="30" cy="17" r="4" fill="G"/>` },
  { id: 'compass', name: 'Compass rose', cat: 'deco', svg: `
    <g transform="translate(32 35) scale(.84) translate(-32 -32)">
    <circle cx="32" cy="32" r="21" fill="none" stroke="I" stroke-width="1.4"/><circle cx="32" cy="32" r="17" fill="none" stroke="I" stroke-width=".8"/>
    <path d="M32 32L44 20M32 32L44 44M32 32L20 44M32 32L20 20" stroke="I" stroke-width="1"/>
    <path d="M32 6l4.5 21.5L58 32l-21.5 4.5L32 58l-4.5-21.5L6 32l21.5-4.5z" fill="F" stroke="I" stroke-width="1.6" ${sw}/>
    <path d="M32 6l4.5 21.5L32 32zM58 32l-21.5 4.5L32 32zM32 58l-4.5-21.5L32 32zM6 32l21.5-4.5L32 32z" fill="I"/></g>
    <text x="32" y="9" font-size="9" font-family="Georgia,serif" font-weight="bold" text-anchor="middle" fill="I">N</text>` },
];
export const ASSET_MAP = Object.fromEntries(ASSETS.map((a) => [a.id, a]));

/** Kinds that can be placed with the settlement / marker tool. */
export const FEATURE_KINDS = {
  capital: { label: 'Capital', icon: 'capital', size: 26, cat: 'settlement', name: 15 },
  city: { label: 'City', icon: 'city', size: 18, cat: 'settlement', name: 11.5 },
  town: { label: 'Town', icon: 'town', size: 13, cat: 'settlement', name: 9.5 },
  village: { label: 'Village', icon: 'village', size: 8, cat: 'settlement', name: 7.5 },
  fortress: { label: 'Fortress', icon: 'fortress', size: 15, cat: 'settlement', name: 9 },
  temple: { label: 'Temple', icon: 'temple', size: 14, cat: 'settlement', name: 8.5 },
  dungeon: { label: 'Dungeon entrance', icon: 'dungeon', size: 14, cat: 'settlement', name: 8.5 },
  ruins: { label: 'Ruins', icon: 'ruins', size: 13, cat: 'marker', name: 8 },
  relic: { label: 'Relic site', icon: 'relic', size: 12, cat: 'marker', name: 8 },
  lumenari: { label: 'Lumenari site', icon: 'lumenari', size: 16, cat: 'marker', name: 8.5 },
  breach: { label: 'Doomsday breach', icon: 'breach', size: 18, cat: 'marker', name: 8.5 },
  crimson: { label: 'Crimson Sun site', icon: 'crimson', size: 13, cat: 'marker', name: 8 },
  knights: { label: 'Church Knights', icon: 'knights', size: 13, cat: 'marker', name: 7.5 },
  summoning: { label: 'Summoning circle', icon: 'summoning', size: 13, cat: 'marker', name: 7.5 },
  monster: { label: 'Monster lair', icon: 'monster', size: 14, cat: 'marker', name: 8 },
  military: { label: 'Military marker', icon: 'military', size: 14, cat: 'marker', name: 8 },
};

export function assetMarkup(id, pal) {
  const a = ASSET_MAP[id]; if (!a) return '';
  return a.svg.replace(/"(I|F|A|G|L|R|S)"/g, (m, k) => `"${pal[k]}"`);
}
export function assetSvg(id, pal) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256">${assetMarkup(id, pal)}</svg>`;
}

/** Image cache for canvas rendering. */
export class AssetStore {
  constructor(onLoad) { this.cache = new Map(); this.onLoad = onLoad; this.pending = 0; this.custom = new Map(); }
  setCustom(list) {
    for (const c of list || []) if (!this.custom.has(c.id)) { const img = new Image(); this.pending++; img.onload = img.onerror = () => { this.pending--; this.onLoad && this.onLoad(); }; img.src = c.dataUrl; this.custom.set(c.id, img); }
  }
  image(id, pal, palKey) {
    if (this.custom.has(id)) { const im = this.custom.get(id); return im.complete && im.naturalWidth ? im : null; }
    const key = id + '|' + palKey;
    let im = this.cache.get(key);
    if (!im) {
      if (!ASSET_MAP[id]) return null;
      im = new Image(); this.pending++;
      im.onload = im.onerror = () => { this.pending--; this.onLoad && this.onLoad(); };
      im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(assetSvg(id, pal));
      this.cache.set(key, im);
    }
    return im.complete && im.naturalWidth ? im : null;
  }
  preload(pal, palKey) {
    ASSETS.forEach((a) => this.image(a.id, pal, palKey));
    return new Promise((res) => { const t0 = Date.now(); const chk = () => (this.pending <= 0 || Date.now() - t0 > 4000 ? res() : setTimeout(chk, 30)); chk(); });
  }
}

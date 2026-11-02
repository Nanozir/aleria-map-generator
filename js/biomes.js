// Biome catalogue tailored to Kremantin. Colours live in styles.js (per map style).
export const BIOMES = [
  { key: 'ocean', name: 'Ocean', water: true, cost: Infinity, hab: 0 },
  { key: 'lake', name: 'Lake', water: true, cost: Infinity, hab: 0 },
  { key: 'glacier', name: 'Glacier / Frozen Lands', cost: 6, hab: 0, relief: 'ice' },
  { key: 'tundra', name: 'Frozen Tundra', cost: 3, hab: 0.12, relief: 'rock' },
  { key: 'coldwaste', name: 'Cold Wastes (Menfor)', cost: 3, hab: 0.1, relief: 'rock' },
  { key: 'taiga', name: 'Boreal Forest', cost: 3, hab: 0.25, relief: 'pine' },
  { key: 'plains', name: 'Temperate Plains', cost: 1, hab: 1, relief: 'grass' },
  { key: 'forest', name: 'Temperate Forest', cost: 2, hab: 0.6, relief: 'tree' },
  { key: 'ancient', name: 'Ancient Forest', cost: 2.6, hab: 0.3, relief: 'bigtree' },
  { key: 'hills', name: 'Highlands', cost: 2.5, hab: 0.45, relief: 'hill' },
  { key: 'mountain', name: 'Mountains', cost: 7, hab: 0.04, relief: 'mountain' },
  { key: 'snowpeak', name: 'Snow Peaks', cost: 9, hab: 0, relief: 'snowmountain' },
  { key: 'jungle', name: 'Wild Jungle', cost: 3.5, hab: 0.35, relief: 'palm' },
  { key: 'savanna', name: 'Savanna', cost: 1.4, hab: 0.6, relief: 'grass' },
  { key: 'desert', name: 'Badlands', cost: 2.5, hab: 0.15, relief: 'dune' },
  { key: 'swamp', name: 'Marsh', cost: 4, hab: 0.2, relief: 'swamp' },
  { key: 'storm', name: 'Storm Moor', cost: 3, hab: 0.22, relief: 'storm' },
  { key: 'anomaly', name: 'Mana Anomaly', cost: 5, hab: 0.03, relief: 'crystal' },
];
export const B = Object.fromEntries(BIOMES.map((b, i) => [b.key, i]));
export const isWaterBiome = (id) => !!BIOMES[id]?.water;

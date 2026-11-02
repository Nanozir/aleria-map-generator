> Source: Google Doc “Aleria Map Generator - Detailed Prompt” — the original brief this project was built from. Reproduced verbatim.

# Detailed Prompt: Interactive Aleria Map Generator Website

Create a full-featured, browser-based interactive fantasy map generator website called **Aleria Map Generator** (or "Guide for Heroes Map Tool"). It must match the interactivity and customization depth of [Azgaar's Fantasy Map Generator](https://azgaar.github.io/Fantasy-Map-Generator/) and [Inkarnate](https://inkarnate.com), but with a locked-in main template based on the world of *A Guide for Heroes (Who’d Rather Not Be)*. Users should be able to generate, heavily edit, style, annotate, and export maps of Aleria/Kremantin that stay consistent with the established lore while remaining fully customizable.

## Core World Template (Default Generation Rules)

The generator must default to and bias toward this structure (users can override everything):

- **World**: Aleria. Primary known continent: **Kremantin**.
- **Central region**: Kingdom of Elysandria — fertile plains, ancient forests, rugged mountain ranges. Capital features a grand palace-temple complex with marble halls, crystal statues, and the main summoning chamber (magic circles). Seat of the Church of Ucliat and historical hero-summoning site. Queen Elisabeth Bernt Ravenshield III’s domain.
- **North**: Harsh northern wastes — Menfor. Cold, barren, dangerous.
- **South**: Wild southern jungles.
- **Southeast**: Storm-shrouded region.
- **Northeast**: Frozen lands.
- **Other areas**: Unexplored / shadowed regions with mystery. Border zones with monster incursions, trade routes, fortified frontiers, and dungeons containing Lost Magic relics.
- **Political/religious overlay**: Church of Ucliat strongholds and Church Knights presence (silver chains, sword-crossed sun medallions, halo headpieces). Crimson Sun Order hidden or experimental sites. Other race territories (beastfolk/lion-like, short folk, Rih-Fugh horned/third-eye people, tenebrim/narelith areas, etc.).
- **Threat layers** (toggleable overlays): Doomsday underworld breach points / monster flood zones; rare Lumenari manifestation sites (cracked stone humanoids, glowing cracks, unstable mana areas); dungeon entrances with Lost Magic.
- **Magic/mana flavor**: Heightmap and biomes should support mana-rich zones, core-related anomalies, and places where ancient Lost Magic left lasting effects. Settlements can have Church temples, appraisal relic sites, or Order laboratories.
- **Language/culture notes**: Main language Algon. Skills, Spells (Tro-Ko compressed incantations), Techniques, and Relics exist as flavor text or optional markers, not full systems.

Generation should produce a coherent map that feels like the inhabitants’ depiction of Kremantin, with unexplored edges fading into mystery.

## Required Interactive Features (Match or Exceed the Reference Tools)

Implement these with a clean, modern UI (sidebar tools + main canvas/map view + bottom status bar):

1. **Procedural Generation**
   - Heightmap / Voronoi-cell based terrain (similar to Azgaar).
   - Configurable parameters: seed, map size/resolution, landmass shape (favor central Kremantin with surrounding regions), elevation, temperature, moisture, biomes.
   - Biomes tailored to the template: temperate forests/plains (Elysandria), cold wastes (Menfor), jungles, stormy coasts, frozen tundra, mountains, dungeons/mana-anomaly zones.
   - Optional “lore mode” that forces the regional layout above.

2. **Full Editing Tools**
   - Brush tools for raising/lowering terrain, painting biomes, adding rivers, lakes, mountains, forests.
   - Place and edit settlements (capitals, cities, towns, villages, fortresses, temples, dungeon entrances). Name them or auto-generate Algon-flavored names.
   - Draw routes/roads, borders, political states/kingdoms, military markers.
   - Cultures, religions (Church of Ucliat dominant), and race zones as optional layers.
   - Text labels, icons, and freeform drawing.
   - Undo/redo, layers, and selection tools.

3. **Styling & Assets (Inkarnate-style)**
   - Multiple map styles: classic fantasy parchment, clean modern, dark/stormy, high-contrast, parchment with ink, etc.
   - Asset library: trees, mountains, buildings, temples, churches, ruins, monsters, Lumenari silhouettes, Church Knight icons, Crimson Sun symbols, summoning circles, dungeon entrances. Allow users to upload custom assets.
   - Texture and color controls for land, water, borders.
   - Icon and stamp placement with scaling/rotation.

4. **Overlays & Lore Integration**
   - Toggle layers: political, religious (Church vs Order), race distribution, Doomsday threat, Lumenari events, dungeon/relic sites, trade routes, mana density.
   - Click any feature for a info panel (editable notes that can store lore snippets).
   - “Hero’s View” mode that highlights known vs unexplored areas.

5. **Export & Sharing**
   - Export as PNG/SVG/PDF (high resolution, up to 4K–8K).
   - Save/load project files (JSON) so users can continue editing later.
   - Shareable link or embed option.
   - Optional GitHub Pages deployment for easy hosting.

6. **Technical Requirements**
   - Pure client-side (no backend required for core features). Use HTML5 Canvas or WebGL for performance.
   - Responsive layout that works on desktop (primary) and tablet.
   - Keyboard shortcuts, zoom/pan, minimap.
   - Performance: smooth on mid-range machines for maps up to ~2000×2000 or Voronoi equivalent.
   - Clean, dark/fantasy-themed UI that fits the tone of the story (not overly bright or cartoonish).
   - Open-source ready: well-structured code, clear comments, and a README explaining how to run/modify it.
   - Optional: integrate with or allow importing of data from the fandom wiki for names/locations.

## Additional Notes for the Builder

- Start with a solid procedural heightmap + biome system, then layer the Aleria template rules on top.
- Make the default generated map immediately recognizable as Kremantin/Aleria without needing manual fixes.
- Keep the tool usable for both “faithful to the novel” maps and freeform fantasy maps (users can ignore the template).
- Reference Azgaar’s open-source code for terrain generation techniques if helpful, but do not copy it wholesale—build a clean original implementation.
- Prioritize usability: tooltips, undo, and clear feedback when placing features.

---

This is the detailed prompt for building an interactive map generator website tailored to the world of *A Guide for Heroes*.

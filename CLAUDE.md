# CLAUDE.md: guide for coding agents working on Aleria Map Generator

This file is for Claude Code (and other coding agents). It explains:

- how the project is built
- how to run and test it
- which conventions to keep
- a **prioritized improvement roadmap** with acceptance criteria

The original brief is in [`docs/ORIGINAL_PLAN.md`](docs/ORIGINAL_PLAN.md); read it first. When a change has to trade something off, the brief wins over this file.

---

## 1. Project overview

The app is a browser-based fantasy map generator and editor for the world of **Aleria**, from the web novel
*A Guide for Heroes (Who'd Rather Not Be)*.

- **Lore mode:** generates a template biased toward the canon layout of **Kremantin**, one continent of Aleria.
- **Freeform mode:** generates generic fantasy worlds.
- **Editing:** maps can be hand-edited (terrain, biomes, zones, settlements, markers, roads, rivers, labels, stamps, drawings), restyled, and exported (PNG up to 8K, SVG, PDF, JSON).
- **Live site:** https://nanozir.github.io/aleria-map-generator/ (GitHub Pages, `main` branch, repo root).

### Run locally

There is no build step. Serve the folder statically, because ES modules don't load from `file://`:

```bash
python3 -m http.server 8765        # from the repo root
# open http://localhost:8765/
```

### Test (no test framework in the repo; use a headless browser)

The project has no `package.json`. Keep it that way: dev tooling lives **outside** the repo.

```bash
mkdir -p /tmp/aleria-test && cd /tmp/aleria-test && npm init -y >/dev/null
npm i playwright d3-delaunay && npx playwright install chromium
```

The app exposes `window.aleria`, a debug handle on the app state. It provides:

- data and state: `mesh`, `P` (project), `D` (derived render data), `view`, `sel`, `history`, `ready`
- functions: `newWorld`, `setProject`, `fitView`, `hitTest`, `setTool`, `showTab`, `applyPreset`, `loadProjectText`, `shareLinks`

A good smoke test should do all of the following:

1. Load `index.html`, then `await page.waitForFunction(() => window.aleria?.ready)`.
2. Collect `console` errors and warnings plus `pageerror` events. The run must end with **zero**.
3. Exercise the tools with keyboard shortcuts (`P`, `T`, `A`, `O`, `I`, `D`, `R`, `B`, `Z`, `V`, `X`), `Delete`, and `Ctrl+Z` / `Ctrl+Y`. Convert world coordinates to screen coordinates with `aleria.view` (`screen = rect.left + view.x + wx * view.k`).
4. Render a full map off-screen:

   ```js
   const io = await import('/js/io.js');
   const cv = await io.renderToCanvas(aleria, 2400);
   cv.toDataURL();
   ```

   Look at the PNG and check it.
5. Export: open the Export modal (`#btnExport`), then click `#doPng`, `#doSvg`, `#doPdf` and `#doJson`, and catch the `download` events. Round-trip the JSON through `aleria.loadProjectText(text)`.
6. Share link: open `aleria.shareLinks().link` (with and without `&embed=1`) in a new page.

Generation can also be tested headless in **Node** without a browser. Set `globalThis.window = { d3: await import('d3-delaunay') }`, then import `js/generator.js` and call `generateWorld({...DEFAULT_SETTINGS, seed})`. This is useful for statistical checks over many seeds, such as land %, water inside a region, or feature overlap.

Keep screenshots of the default lore map in `screenshots/` up to date after visual changes.

---

## 2. File map

| File | Responsibility |
|---|---|
| `index.html` | App shell: top bar, left tool palette + tool options, `#viewport` (map canvas, zoom controls, minimap, tooltips, toast, loading), right tab panels (Inspector / Layers / Style / Assets / World), status bar, modal. |
| `css/style.css` | Dark fantasy theme, 3-column grid, responsive breakpoints (1150px, 760px), `body.embed` chrome-less mode. |
| `js/main.js` | The app. State object `app`, render loop (cached bitmap while panning/zooming, full vector render when idle), minimap, hit-testing, undo/redo (`structuredClone` snapshots, 50 steps), brushes (terrain/biome/zone), the 14 tools, all side panels, Export/Share/Help modals, keyboard shortcuts, autosave to `localStorage`, boot (reads URL hash). |
| `js/generator.js` | World generation and the data model: `buildMesh`, `emptyProject`, `generateWorld` → `terrain` → `recomputeEnvironment` (`computeClimate` + `hydrology` + `assignBiomes`) → `populate`. Also `LORE_REGIONS`, `DEFAULT_SETTINGS`, `RELIGIONS_DEFAULT`, `RACES_DEFAULT`, graph search (`dijkstra`, `findPath` A\*), `repopulate`. |
| `js/render.js` | Map renderer. `buildDerived` precomputes coastlines, colour groups, hillshade, contours, relief glyphs, atmosphere. `buildZones` handles borders and state labels. `overlayGroups` builds overlay fills. `renderMap(painter, …)` draws everything in layer order. Also `LAYER_LIST`, `OVERLAY_LIST`, and smoothing helpers (`chain`, `chaikin`). |
| `js/painter.js` | Two back-ends with one drawing API: `CanvasPainter` (screen/PNG/PDF) and `SvgPainter` (SVG export). Methods: `poly`, `lines`, `circle`, `text` (halo, letter-spacing), `icon`, `clip`, `group/ungroup` (alpha, blend, low-res blur), `gradientRect`, `paper` (tileable texture). |
| `js/styles.js` | 5 style presets (`parchment`, `ink`, `modern`, `stormy`, `contrast`): palettes, biome colours, effect flags, fonts. `ICON_PALETTES`, `defaultStyle`, `effectiveStyle`. |
| `js/assets.js` | Original SVG icon library (`ASSETS`, 64×64 boxes, colour placeholders), `FEATURE_KINDS` (placeable feature types: size, label, icon), `AssetStore` (image cache + user uploads). |
| `js/names.js` | `NameGen`: Algon-flavoured names from syllable tables, kind templates (“Fort X”, “X Depths”…), custom-name list first. |
| `js/biomes.js` | The 18 biomes (key, name, movement cost, habitability, relief glyph). |
| `js/io.js` | `serializeProject` / `deserializeProject` (the mesh is rebuilt from the seed; cell arrays are saved as plain number arrays, floats rounded to 4 decimals), `renderToCanvas`, `exportPNG/SVG/PDF`, `settingsToHash` / `hashToSettings` (share links). |
| `js/rng.js` | Seeded RNG (`makeRng`, `hashString`), gradient noise, `fbm`, `ridged`, `MinHeap`, math helpers. |
| `js/color.js` | Colour helpers (`mix`, `shade`, `rgba`, …). |
| `vendor/` | `d3-delaunay` UMD (`window.d3`) and `jsPDF` UMD (`window.jspdf`), with their licenses. |

### Data model (project `P`, serialised to JSON)

- **`P.settings`:** seed, `lore`, `size` (`'1600x1000'`), `cells`, `shape`, `land`, `mountains`, `roughness`, `temp`, `moist`, `rivers`, `settlements`, `states`, `customNames`.
- **`P.cells`:** typed arrays indexed by cell.
  - Saved: `h` (elevation; ≤0 is sea), `t0`/`m0` (base climate), `biome`, `lock` (painted biome), `region` (lore region index, 255 = none), `state`, `religion`, `race`, `mana`, `known`, `threat`, `lake` (1 = auto, 2 = user).
  - Derived, not saved: `t`, `m`, `flux`, `dist`.
- **Object lists** (each object has a unique `id` from `uid(P)`): `features`, `labels`, `lines`, `rivers`, `stamps`, `drawings`.
- **Legend lists:** `states`, `religions`, `races`, `regions` (lore notes), `customAssets`.
- **View:** `P.style` (preset + overrides) and `P.view` (`layers`, `overlays`, overlay opacity).

### Generation pipeline and where the lore rules live

1. **`buildMesh(seed, W, H, cells)`:** jittered grid → Delaunay/Voronoi. Precomputes `px`, `py`, `polys`, `nbr`, shared `edges` and `border` cells.
2. **`terrain()`:**
   - Elevation: blob ellipses (domain-warped) → `tanh`, plus fBm, plus ridge polylines, plus edge falloff, then one smoothing pass.
   - Sea level comes from the `land` percentile.
   - **Lore rules:** the `if (S.lore)` branches set the main continent blobs, the mountain-ridge polylines (Menfor wall, west/east ranges, frozen peaks, jungle hills), the ragged storm coast, and the Elysandria "dry dome".
   - It then soft-assigns `LORE_REGIONS` anchors (`ax`/`ay` are normalised map coordinates) and blends their base temperature and moisture.
3. **`recomputeEnvironment()`:**
   - `computeClimate`: altitude lapse rate plus coastal moisture.
   - `hydrology`: priority-flood fill, lakes (depth > 0.04, capped size), flux, rivers above a threshold.
   - `assignBiomes` → `biomeFor`: thresholds; locked cells are kept.
4. **`populate()`.** The lore content is all in here:
   - capital (forced near the Elysandria centre)
   - regional seats, then cities, towns and villages scored by habitability
   - `stateDefs`: lore states and rulers, grown by cost-limited Dijkstra
   - known world (Hero's View)
   - lore markers via `pickCells` (fortresses, Church temples, dungeons, ruins, relics, Lumenari, breaches, hidden Crimson sites, monsters, knights, summoning)
   - mana, threat, religion and race fields
   - roads (MST trade routes + A\* roads/paths + sea lanes)
   - labels (region names, flavour notes, "KREMANTIN" title, oceans, big rivers) and the compass stamp

**Important limitation:** the whole canvas is currently **one continent**. The lore anchors are hard-coded, normalised positions with no data file. Fixing this is roadmap items A and B.

---

## 3. Conventions (do not break these)

- **No build step, no bundler, no framework.** Use plain ES modules loaded by `index.html`. It must keep working on GitHub Pages from the repo root (`.nojekyll` is present) and from any static server.
- **Pure client-side.** No backend or API keys. It should work offline once loaded.
- **Vendored libraries only.** Third-party code goes in `vendor/` with its LICENSE file. No CDN `<script>` tags. Keep dependencies small.
- **Do not copy Azgaar's Fantasy Map Generator code** (or Inkarnate assets). You may learn from its techniques, but write your own implementation, as the brief requires. Icons are original SVG.
- **Determinism:** the same seed and settings must give the same map. All randomness goes through `makeRng(seed + '|purpose')`, never `Math.random()` in generation. Adding new RNG draws shifts later output, so prefer separate sub-streams (`makeRng(seed + '|newthing')`).
- **Backward compatibility:** `deserializeProject` should keep loading older project JSON. Bump `P.version` and migrate if the schema changes.
- **Both painters:** any new drawing goes through the painter API so that PNG, PDF **and** SVG export all show it.
- **Undo:** every user edit calls `history.push(label)` *before* it mutates `P`.
- **Performance budget:** at 8k cells, generation takes about 200 ms in Node. A full screen render should stay ≲100 ms on a mid-range GPU; heavy effects belong in `buildDerived` caches.
- **Zero console errors** in the smoke test before you commit. Run `node --check` (or `node --input-type=module --check < file`) on each edited file.
- Comment the non-obvious algorithms. Keep the README feature list in sync.

---

## 4. Improvement roadmap (prioritized)

Each item lists **what** to do and **acceptance criteria**. Do them roughly in order. A and B are what the owner asked for most.

### A. World-scale Aleria: several continents, Kremantin as one of them (highest priority)

**Problem:** the generated map *is* Kremantin, edge to edge. In canon, Kremantin is one continent inside the wider world of Aleria.

**Do:**

- **New generation scale `world`.**
  - Settings and UI: a "World of Aleria" generation mode alongside "Kremantin (continent)" and "Freeform".
  - Canvas: a larger world canvas (e.g. `2400x1500`, 12k–20k cells) with **3–6 landmasses** separated by real oceans.
  - **Kremantin** is one continent at a fixed, configurable position and size in world coordinates (data-driven, see B). It is generated with the existing lore rules, re-scaled into its bounding box.
  - The other continents and island chains come from seeded procedural generation. Their names and contents are marked **unexplored / mysterious**: low `known` values, fog, "terra incognita" labels and few or no settlements. Canon names come from the canon data file when they are known.
- **Refactor the lore code** so that positions are in continent-local normalised coordinates, mapped through a per-continent transform. `terrain()` and `populate()` should accept a "continent spec" list instead of hard-coding one layout.
- **World vs. continent view.**
  - The world view shows the whole planet surface, with oceans named and Kremantin highlighted.
  - "Focus Kremantin" (and focusing any continent) either:
    - zooms and frames that continent, with a nicer re-rendered label set (region labels only appear at continent zoom), or
    - generates a higher-resolution continent map from the same seed (a sub-mesh).
  - Pick the simpler, robust option first. Zoom-dependent label and icon visibility (level-of-detail) is needed either way.
- Ocean and sea names, sea lanes between continents, and unknown waters faded at the world edges.

**Acceptance criteria:**

- [ ] The default load (or a clearly offered default) shows **Aleria with ≥3 continents**. Kremantin is recognisable and internally keeps all current lore regions in their correct relative positions.
- [ ] The other landmasses look plausible (not ellipses), are clearly unexplored (fogged, sparse), and have editable names and notes.
- [ ] A single control or shortcut switches between world view and the Kremantin view. Labels and icons are readable at both scales, and nothing is huge or overlapping at world zoom.
- [ ] Share links and JSON round-trip preserve the mode. Old Kremantin-only projects still load.
- [ ] Generation in world mode takes < 1 s for 16k cells in Node. There are no console errors.

### B. Canon-accuracy pass with an editable canon data file

**Problem:** the Kremantin layout came from a short brief, not from the novel. Several things are placeholders:

- state names (Menfor, Frozen Holds, Beastfolk Prides, Rih-Fugh Enclaves, Tenebrim Reaches)
- most settlement and marker names, which are generated
- race territories
- religious zones
- "The Shadowed West" and "The Unmapped East"

**Do:**

- Create **`data/canon.json`**, plus a short `data/README.md` describing its schema. Store:
  - continents (name, world position/size, known/unknown)
  - regions (name, anchor, extent hint, climate, biome bias, description)
  - canonical places (name, kind, region, approximate position or relation such as "north of X", notes, source chapter/wiki URL)
  - states (name, ruler, colour), religions/orders, races and homelands
  - every entry carries **`"canon": "confirmed" | "inferred" | "placeholder"`** and an optional `"source"`.
- Research the setting, including the *A Guide for Heroes (Who'd Rather Not Be)* fandom wiki and the novel. Put what is confirmed in the file **with sources**. Anything invented stays `placeholder`.
- The generator reads `canon.json` (via `fetch`, falling back to an embedded default so `file://`-less tests still work). Canon places are placed first, at their stated positions, snapped to suitable terrain. Procedural content only fills the gaps.
- **UI:**
  - The Inspector shows a badge (Confirmed / Inferred / Placeholder) and the source link.
  - A Layers toggle "Highlight placeholders" draws a dashed outline or question-mark badge on non-canon items.
- **Import/export:** "Export canon data" downloads the current canon list (including the user's edits in the editor). "Import canon data" loads a corrected file. This is the main way for the user to correct canon without code.

**Acceptance criteria:**

- [ ] `data/canon.json` exists and validates against the documented schema. Every Kremantin label, state and fixed marker in lore mode comes from it.
- [ ] All non-sourced entries are visibly flagged in the UI and in the file.
- [ ] Editing a place's name or position and exporting canon data round-trips. Re-generating after an import reflects the corrections.
- [ ] Section 5 (Open questions) is updated with what was confirmed and what is still unknown.

### C. Smarter placement of settlements, markers and labels

**Problems seen in v1:**

- The labels around the Royal Capital overlap (the capital name collides with nearby town names and with the "ELYSANDRIA" region label).
- Small labels pile up in dense areas at default zoom.
- Some markers sit on unlikely terrain.
- Cities don't systematically prefer rivers and coasts.

**Do:**

- **Settlement siting:** score cells by habitability, with bonuses for river confluence, river mouth, coast with a natural harbour (concave coastline) and lake shore, and penalties for steep slope and high elevation. Cities and towns should mostly sit on rivers or coasts, and the capital on a river in central Elysandria. Use Poisson-disk minimum distances by tier (capital > city > town > village).
- **Marker siting rules (per kind):**
  - dungeons in hills or mountains or near ruins
  - Lumenari sites in high-mana anomaly cells
  - breach points in threat zones and frontiers
  - fortresses on borders and passes (low points of mountain ridges between states)
  - Church temples in or near towns
  - ports only on coasts
  - nothing on water or on lake cells
- **Label collision avoidance.**
  - Build a screen-space or world-space occupancy index of icons and labels.
  - For each settlement label, try 8 candidate positions (E, W, NE, SE, N, S, NW, SW) and pick the first one that is free. Otherwise drop or shrink it at that zoom level.
  - Region labels should follow region shape (spline along the region's long axis) and avoid icons.
  - Hide the lowest-priority labels first (village < town < city).
  - **Fix the capital label** specifically: it must never overlap the region label or neighbours.
- **Level-of-detail:** villages and their labels hide below a zoom threshold, and so do minor markers. Exports use the export scale.
- Roads should connect settlements more naturally: reuse existing roads, cross rivers at bridges/fords, and route over mountain passes.

**Acceptance criteria:**

- [ ] A headless check over 20 seeds reports **0 label-label overlaps** and **0 label-icon overlaps** among visible labels at default zoom and at 4K export (compute the bounding boxes in JS).
- [ ] ≥80% of cities and towns are within 1 cell of a river, lake or coast. No settlement or marker sits on water.
- [ ] Every marker kind obeys its terrain rule (asserted in a Node test).
- [ ] The visual check of the screenshots shows a clean, readable capital area.

### D. Known gaps from v1

1. **The share link only carries seed and settings.** Hand edits are lost.
   - Add an option to compress the project into the URL (`CompressionStream('deflate-raw')` + base64url) when it is small enough. Otherwise offer the JSON download or a pasteable text blob, and explain the size limit in the Share modal.
   - *Accept:* a lightly edited map round-trips through the share link with all edits.
2. **Roads, borders, rivers and drawings can't have their points edited.**
   - In Select mode, show vertex handles on the selected line: drag a handle to move it, Alt+click to delete, click a segment to insert a point.
   - *Accept:* works for every line type, with undo, and is reflected in all exports.
3. **"Wiki import" is only a names list.**
   - Add an "Import from wiki" helper: paste wiki text, a list, or a JSON export, then map names onto kinds. Optionally fetch MediaWiki API category pages client-side if CORS allows (fandom's `api.php?origin=*`), with a graceful fallback.
   - *Accept:* importing a list of places with kinds assigns them to generated features or canon entries.
4. **The unexplored-area fog is too faint in the Parchment style.**
   - Give it a stronger mist (layered noise + hatching or blank-paper look) and add a style control for fog intensity.
   - *Accept:* the Shadowed West and Unmapped East are clearly "unknown" in all 5 styles.
5. **Full redraw is slow** (~100–400 ms in software rendering).
   - Cache static layers (terrain, relief, coast) into tiles or offscreen bitmaps per zoom level, re-render only the layers that changed, and move generation to a Web Worker.
   - *Accept:* a full redraw takes < 60 ms on a mid-range laptop at 8k cells, and pan/zoom stays at 60 fps.
6. **Generating a new map clears undo history.**
   - Make regeneration an undoable step (keep the previous project snapshot).
   - *Accept:* Ctrl+Z after "New map" restores the previous map.
7. **Freeform maps are generic, and "archipelago" makes a few big islands.**
   - Add more shape presets (true archipelago with many small islands, inland sea, fractured coast, continent + island chains), tectonic-style ridges, and coastline-detail controls.
   - *Accept:* each shape preset looks distinct over 10 seeds.
8. **Smaller items:**
   - The title/subtitle ornament spacing is off.
   - The ink-style jungle trees read as "bubble wrap"; thin them out.
   - The Frozen Lands glacier blob looks flat; add texture.
   - Hidden layers (Crimson Sun sites) should have an explicit "reveal secrets" toggle.

### E. Nice-to-have (later)

- Timeline and story-progress layers ("as of Volume N": which areas are known to the heroes).
- A route planner: travel time between two places by road, terrain or sea.
- Per-region climate and biome editor; heightmap import from an image.
- Localisation of UI strings.

---

## 5. Open questions for the owner (canon to confirm)

Record answers in `data/canon.json` and update this list.

1. What other continents of Aleria are named in canon, and roughly where are they relative to Kremantin? Which are known to the people of Kremantin?
2. Is **Menfor** a nation, a region, or both? Who rules it, and where does Elysandria's northern border lie?
3. Do the north-eastern frozen lands, the southern jungles and the south-eastern storm region have canon names, and are there states or peoples there?
4. Where do the races live? Beastfolk (lion-like), short folk, Rih-Fugh (horned, third eye), tenebrim/narelith, and any others.
5. What is the canon name of Elysandria's capital (v1 says "Royal Capital of Elysandria")? Which other cities, towns, dungeons and landmarks are named, and where are they?
6. Church of Ucliat vs. Crimson Sun Order: where are their seats, strongholds and hidden sites? Should Crimson sites be hidden by default?
7. Doomsday breaches and Lumenari manifestations: are any specific places named in canon?
8. Seas and oceans: any canon names? (All current names are generated placeholders.)
9. Scale: how far is it, for example, from the capital to Menfor? (The v1 scale bar says "leagues" as a placeholder.)
10. Should the default map be the whole world of Aleria or Kremantin, with the other one a click away?

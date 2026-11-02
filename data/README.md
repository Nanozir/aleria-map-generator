# data/: canon data

`canon.json` holds the canon geography of Aleria that the generator should follow. It is the file to edit when the map gets canon wrong.

The facts are paraphrased from the author's private lore notes ("Main doc", the Lore and Races tabs). They are not quoted.

## Status values

Every entry has a `status`:

| status | meaning |
|---|---|
| `confirmed` | Stated in the lore notes (`source` says where). |
| `inferred` | A reasonable reading of the lore, not stated outright. All numeric `layoutHint` positions are inferred, because the lore gives compass directions only. |
| `placeholder` | Invented for the map. Replace it or confirm it. |

## Sections

| Key | Contents |
|---|---|
| `continents[]` | Each continent's id, name, optional `forbiddenBiomes` (e.g. Menfor: no cold or snow biomes), `direction` relative to the world, climate, terrain list, notes and `layoutHint` `{x, y, w, h}` in normalised world coordinates. |
| `nations[]` | Each nation's id, name, continent, position, government, ruler and notes. |
| `places[]` | Each place's id, name, `kind` (matches `FEATURE_KINDS` in `js/assets.js`), continent or nation, position (text), notes. `nameStatus` flags a confirmed place whose proper name is unknown. |
| `underworld` | Notes for a possible future Underworld layer. |
| `organizations[]`, `races[]` | Seats, homelands and `placementRule`s for the generator. |
| `seas[]`, `scale` | Currently unnamed or unknown, so they are placeholders. |
| `rules[]` | Canon world rules that should drive placement (villages, dungeons, crystals, wealth). |
| `defaultView` | The owner's view requirement (world, single continents, in-between framings). |
| `roughSketch` | Pointer to `docs/rough-world-sketch.png`: a NON-canon layout reference. Its top-right snowy land is the Northern Expanse, not Menfor. |
| `v1Placeholders[]` | v1 map content that contradicts or is missing from canon, so it can be removed or flagged. |

The generator does not read this file yet. Wiring it in is roadmap item B in `../CLAUDE.md`.

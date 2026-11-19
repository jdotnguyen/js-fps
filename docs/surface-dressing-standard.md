# Surface Dressing Standard

> How textures, trim, decals and props are placed on `js-fps` rooms.
> Companion to [modular-grid-standard.md](modular-grid-standard.md) (geometry and scale) and
> [ADR-0003](adr/0003-level-kit-and-data.md) (kit and level data).
> Status column: **live** = enforced in code today, **rule** = follow by hand until tooling exists.

## 1. UV contract

| Rule | Status |
| --- | --- |
| Static kit geometry gets **world-space box-projected UVs** in `AoMergeBuilder.build()` (`kit/merge.ts`). Textures run continuously across tiles, trims and bevels; they do not restart per piece. | live |
| Projection axis is chosen **per triangle** from its face normal (bevelled `rounded()` pieces never smear). | live |
| U is signed by facing: every wall reads left-to-right from in front of it, floors read upright from above. Opposite walls are never mirrored. | live |
| Only materials whose map **repeats** (`wrapS = RepeatWrapping`) take world UVs. Canvas textures, signs (`signDanger`), screens, decals and anything `transparent` keep their authored UVs. | live |
| 1 UV unit = 1 m for photo slots; the loader applies `repeat = 1 / metersPerTile` (`render/tex/manifest.ts`). Procedural `hazardClean` and `grating` use 0.5 m (`WORLD_TILE_METERS`). | live |
| The `tile` argument of `slab()` / `boxUv()` only matters for geometry that is **not** merged through `AoMergeBuilder` (e.g. `demoRoom.ts`). | live |
| Imported GLB room shells keep their own UVs. Author them in Blender at the same texel density (§2). | rule |
| Check with the 1 m checkerboard (`?checker`, or the Level overlay toggle). Squares must be square and continuous on every surface you touched. | rule |

## 2. Texel density (rule)

- Target **512 px per metre** at the `high` texture setting (a 1024 px image over `metersPerTile = 2`).
- Hero surfaces the player stands near (kitchen counters, security desk, Lab B glass frames): up to 1024 px/m.
- Floors and ceilings may drop to 340 px/m (`metersPerTile = 3`, the concrete slots).
- Do not change `metersPerTile` to hide repetition; break it up instead (§4).

## 3. Wall bands (rule)

A 3.2 m wall reads as three bands, never one flat surface:

| Band | Height (m) | Material source |
| --- | --- | --- |
| Kick / skirting | 0.00 – 0.25 | `palette.hazard` or `steel` |
| Main panel | 0.25 – 2.40 | `palette.wallMain` |
| Upper / service | 2.40 – ceiling | `palette.wallAlt` (pipes, cable trays, vents live here) |

- The 2.40 m line matches the door head (`DOOR_H`), so band seams line up with door frames.
- Main-panel seams fall on the 2 m grid (half a cell); never on arbitrary offsets.
- Choose materials per **area palette** (`kit/palettes.ts`), not per piece. Use a per-piece `params.material` override only for a deliberate accent panel (at most one per wall).

## 4. Breaking repetition (rule)

| Tool | Where it goes | Budget per room |
| --- | --- | --- |
| Grime / rust decals (`paintedDecal`) | Floor-wall joins, under vents and pipes, below light fixtures | 4–8 |
| Stencils (`stencilDecal`) | Beside doors, on bulkheads, floor arrows at junctions | 1–3 |
| Blood (`bloodDecal`) | Only where a story beat happened | as scripted |
| Accent panel or material swap | One wall per room, facing the main entry | 1 |

- Place decals **by rule** (corner, under fixture, beside door), never by uniform random scatter.
- Decals sit ≥ 0.004 m proud of the surface (grid standard §3) and use `polygonOffset`.

## 5. Prop placement (rule)

- Props **belong to a wall or an anchor**: desks, lockers, shelves and crates go against walls; free-standing props group around a focal object (table, console, tank).
- Place in **clusters with a purpose** (desk + chair + terminal + mug), 2–4 clusters per room, not singles spread evenly.
- Keep a **clear 1.2 m path** between every pair of doors and around objective interactables (squad pathing needs 2 capsules side by side).
- Face clusters toward the room's focal point or entry, so the first view from the door reads as composed.
- Rotate within ±5°, not randomly; snap the rest to the 0.25 m sub-grid.

## 6. Definition of done for a dressed room

1. Checkerboard pass: no stretched, mirrored or restarting squares.
2. Screenshot from each entry door at eye height (1.62 m), with and without post-processing (`?nopost`).
3. Decal and cluster counts are inside the §4 and §5 budgets.
4. `npm test` and `npm run typecheck` pass.

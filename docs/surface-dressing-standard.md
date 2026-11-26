# Surface Dressing Standard

> How textures, trim, decals and props are placed on `js-fps` rooms.
> Companion to [modular-grid-standard.md](modular-grid-standard.md) (geometry and scale).
> Status column: **live** = enforced in code today, **rule** = follow by hand until tooling exists.
> A `slice01` room is dressed in its own file, `src/data/levels/slice01/rooms/<id>.json`
> ([where a level is authored](modular-grid-standard.md#where-a-level-is-authored)).

## 1. UV contract

| Rule | Status |
| --- | --- |
| Static kit geometry gets **world-space box-projected UVs** in `AoMergeBuilder.build()` (`kit/merge.ts`). Textures run continuously across tiles, trims and bevels; they do not restart per piece. | live |
| Projection axis is chosen **per triangle** from its face normal (bevelled `rounded()` pieces never smear). | live |
| U is signed by facing: every wall reads left-to-right from in front of it, floors read upright from above. Opposite walls are never mirrored. | live |
| Only materials whose map **repeats** (`wrapS = RepeatWrapping`) take world UVs. Canvas textures, signs (`signDanger`), screens, decals and anything `transparent` keep their authored UVs. | live |
| 1 UV unit = 1 m for photo slots; the loader applies `repeat = 1 / metersPerTile` (`render/tex/manifest.ts`). Procedural `hazardClean` and the grating fallback use 0.5 m (`WORLD_TILE_METERS`). | live |
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
| Kick / skirting | 0.00 – 0.25 | `steelBrushed` kick plates. Reserve warning paint for moving edges and exposed drops. |
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
- **Climbable tops in combat spaces.** Jay can jump onto any top 0.35–1.00 m high with 1.75 m of headroom above it (desks, counters, tables, crates; `openspec` player-movement spec), and enemies cannot follow him up (they climb 0.35 m). Keep such tops out of a fight's footprint, put something low over them (a cabinet, a shelf), make them taller than 1.00 m, or accept that Jay can stand there. `src/world/slice01JumpTops.test.ts` lists every one in slice01.

## 6. Keeping draw calls down

The level tests report each room's draw calls and triangles but no longer fail on a fixed count (`render-quality` spec). The gate is the 30 fps floor (1% lows) at High in the heaviest scenes. These rules keep rooms cheap anyway.

| Rule | Status |
| --- | --- |
| Flat paint colours (`plain()` in `kit/slice.ts`: wood, fabric, ceramics, leaves, food...) opt in with `userData.flat` and merge into a few shared white materials per roughness bucket (0.2 / 0.35 / 0.5 / 0.65 / 0.8 / 0.95, metal 0 / 0.5, per side). Their colour rides in the vertex colour (x baked AO). A new prop colour costs no draw call. | live |
| Static glows (`glow()`: LEDs, heat lamps, pendant bulbs, under-cabinet strips) opt in with `userData.glow` and share one emissive material per room (colour x intensity in the vertex colour). Anything that animates or flickers keeps its own `fixtureMaterial`. | live |
| Still one call each: every claimed light slot (diffuser + light shaft + its glow, about 3), every canvas screen / poster / menu, every window (glass, abyss backdrop, seabed), vending machines (panel + logo). Budget those first. | rule |
| Opaque canvas decals (`transparent = false`) must also set `depthWrite = true`, or the frame behind them can draw over them. | rule |

## 7. Definition of done for a dressed room

1. Checkerboard pass: no stretched, mirrored or restarting squares.
2. Screenshot from each entry door at eye height (1.62 m), with and without post-processing (`?nopost`).
3. Decal and cluster counts are inside the §4 and §5 budgets.
4. `npm test` and `npm run typecheck` pass.

## 8. Shadow lights, sway and patterns

Shadow lights are the room's most expensive light and its strongest mood (`render-lighting` spec). The pool holds 0 on Low, 2 on Medium and 6 on High, of which 1 on Medium and 2 on High can project a pattern. Spend them on lights the player looks at and on pools where people and furniture throw shadows.

| Field | Where | Values | What it costs |
| --- | --- | --- | --- |
| `shadow: true` | a room's `lights` entry | boolean | Takes a shadow spot while it ranks high enough: its lit area in view first, then the current room, then nearest. It keeps its spot for 0.5 s after being outranked, then the shadow fades over. A cached shadow redraws only while something moving is under it. |
| `cookie` | a room's `lights` entry (with `shadow: true`) | `grille`, `fan` (turns), `cracked` | Shows only while it holds a patterned spot; otherwise the light casts a plain shadow or lights evenly. A `fan` redraws its shadow every frame. |
| `sway` | `pendant_light` params | `true` (0.06 rad) or an amplitude in radians, up to 0.4 | Each swaying bulb's cable and shade are one unmerged group: about 3 more draw calls per bulb. Its shadow redraws every frame while it swings. Shots nearby, shots passing the shade and the `lightJolt` sequence action knock it harder. |

Rules:

- Opt in at most two or three lights per room. A room with more opted-in lights than Medium's 2 hand shadows over as the player moves, and only High shows them all.
- Put opted-in lights where the floor under them is busy: a sofa, a table, a stage where people stand. A shadow light over an empty corridor costs a spot and shows nothing.
- Give a pattern to a light whose pool the player sees from far away (the grille over R03's stage). Keep patterns off lights that hand over often.
- Sway is for hanging lamps in calm rooms and for lamps the story knocks. Do not sway every lamp in a room: one or two moving pools read as alive, a whole row reads as an earthquake.
- Check a room with the `?debug` lighting overlay (Level folder): green cones hold a shadow, yellow ones are fading, blue rings are fill lights, red crosses got no light. The HUD line shows how many shadows were redrawn this frame.

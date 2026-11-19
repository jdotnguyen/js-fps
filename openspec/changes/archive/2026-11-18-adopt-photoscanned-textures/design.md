# Design: photoscanned CC0 textures

## Context

Materials are built in `src/render/materials.ts` from 11 procedural `TextureKey`s generated in a worker. Each `MeshStandardMaterial` already uses a packed ORM texture for roughness (G) and metalness (B), but not for AO (R). Kit geometry is UV'd in world metres through `boxUv(w, h, d, tile)`, `slab()` and `pipe()`, so a texture's physical size maps directly to a `tile` value.

Raw downloads live in `C:\Users\justi\Documents\Git\graphql-react\textures` (463 MB, including Blender, USD and Godot files, displacement maps and DirectX normals that we never ship). They stay out of git.

## Set review and slot assignment

Reviewed from a contact sheet of every colour map. Notes on what each set actually looks like decided the assignments.

| Slot | Set | Notes |
|---|---|---|
| `paintBone` (light walls, admin, medbay) | PaintedMetal012 | Mostly clean off-white with small chips. Best "TAG-owned" base. |
| `paintDark` (main panel walls, 77 uses) | PaintedMetal013 | Off-white with grey chipping; tinted down hard to read as dark grey paint. |
| `paintTeal` | PaintedMetal006 | Green-teal paint with rust patches; tint nudged toward TAG teal. |
| `labPanel` | PaintedMetal012 | Same set as paintBone, lighter tint and lower roughness, so labs feel cleaner. |
| `diamond` | DiamondPlate008A | Plain grey steel tread; the default floor plate. |
| `diamondHazard` *(new)* | DiamondPlate006C | Orange-painted tread worn to steel. Loading zones, dive bay edges. |
| `diamondRusty` *(new)* | TextureCan metal_0001 | Rusty treadplate. Dive bay, tunnel, moon pool rim. |
| `hazard` | PaintedMetal016 | Yellow/black stripes on heavy rust. Dive bay and tunnel only; clean areas keep the procedural stripes as `hazardClean`. |
| `rubber` | Rubber001 | Black speckled rubber matting. Corridors and stairs. |
| `rustHeavy` *(new)* | PaintedMetal011 | White paint mostly eaten by rust. Hull-side walls in the tunnel and valve room. |
| `rustDrip` *(new)* | TextureCan metal_0053 | Chipped paint with rust running down. Below leaks and pipes. |
| `rustBlotch` *(new)* | TextureCan metal_0051 | Cream paint with large rust patches. Dive bay lockers and suit room. |
| `concrete` (walls, pillars) | Poly Haven concrete_wall_008 | Warm grey with formwork seams. Lower decks. |
| `concreteFloor` *(new)* | Poly Haven brushed_concrete_2 | Stained brown-grey floor. Tunnel, valve room, storerooms. |
| `concretePainted` *(new)* | Poly Haven painted_concrete_02 | Dark painted floor. Docking ring, control room. |
| `labTile` (floors) | Tiles133B | White square tile, grey grout. Lab B before, medbay, seed lab. |
| `tileBroken` *(new)* | Tiles133D | Same tile with tiles missing. Lab B after the outbreak. Same grid as 133B so the swap reads as damage, not a different room. |
| `tileWall` *(new)* | Tiles136B | White subway tile. Kitchen and surgery walls. |
| `tileWashroom` *(new)* | Tiles132B | Bright cyan pool tile; heavily desaturated and darkened. Crew washrooms, nutrient room. |
| `signDanger` *(new, decal)* | PaintedMetal017 | Not tileable: a rusted DANGER / DO NOT ENTER sign. Used once per quad as a sign prop on Lab B and pressure doors, never as a wall. |
| `steel`, `grating` | *(procedural, unchanged)* | No photo set yet. `steel` has 176 uses on trims and frames and reads fine small. |

## Per-area palette

| Area | Rooms | Walls | Floor | Accents |
|---|---|---|---|---|
| dock | R01, R01w, R01a | paintDark | concretePainted, diamond | hazard (clean) |
| commons | R02 | paintBone, paintTeal | rubber | — |
| gallery | R03 | paintDark | rubber | — |
| labs | R04–R06 | labPanel | labTile → tileBroken after the outbreak | signDanger on doors |
| security | R07, R07a | paintDark | rubber | — |
| medbay | R08, R08b | paintBone, tileWall (surgery) | labTile | — |
| tunnel | R09, R10 | rustHeavy, concrete | concreteFloor, diamondRusty | rustDrip under pipes |
| control | R11 | paintDark | concretePainted | — |
| hydroponics | R12a–e | paintTeal, tileWashroom (nutrient room) | labTile (wet) | — |
| dive_bay | R13a–e | rustBlotch, paintDark | diamondRusty, diamondHazard | hazard (rusty) |
| admin | R14a–e | paintBone + existing wood | existing carpet | — |

Admin keeps its procedural wood and carpet on purpose: the "too clean" corporate wing is the contrast. Kitchen walls use tileWall.

## Pipeline

1. **Source**: `../textures/` (not in git). A source map in `scripts/textures/sources.json` names each set's colour, normal (GL only), AO, roughness and metalness files, so the three different naming schemes (ambientCG, Poly Haven, TextureCan) are handled in one place.
2. **Import script** (`npm run textures`): for each manifest slot, read the source files and write `public/assets/textures/<slot>/{color,normal,orm}.jpg` at the slot's resolution.
   - ORM packing: R = AO, G = roughness, B = metalness. Poly Haven's `arm` file is already packed and passes through. Missing maps get constants: AO 255, metalness 0.
   - Tiles, rubber and concrete have no metalness; painted metal does.
   - Uses `sharp` as a devDependency, so it runs the same on Windows.
   - Ignores `.blend`, `.usdc`, `.mtlx`, `.tres`, displacement, DirectX normals and `__MACOSX`.
3. **Manifest** (`src/render/tex/manifest.ts`): slot → `{ path, metersPerTile, size, tint, roughnessScale, fallback }`. `metersPerTile` is calibrated by eye. Starting points: tile sets from the tile count (Tiles133B is about 10 tiles across, so 15 cm tiles ≈ 1.5 m); painted metal 2 m; concrete 3 m; diamond plate 1 m.
4. **Loader**: `TextureLoader` for colour (sRGB), normal and ORM (linear), `RepeatWrapping`, mipmaps, and the existing anisotropy. Colour textures need `flipY` consistent with the procedural ones; this is checked in a test.
5. **Material build**: same `Materials` interface plus the new slots. Adds `aoMap: orm` (Three r170 reads AO from channel R on the first UV set, so no second UV set is needed) and applies `color` = tint. Any slot whose files fail to load falls back to its procedural generator and logs once.

## Albedo tinting

Photo textures are lit evenly and look too bright and saturated in a dark game. Each slot gets a `tint` multiplier, starting around 0.55–0.7 for light paints and tiles and about 0.35 for `paintDark`. Tiles132B also needs heavy desaturation, which is applied in the import script so the runtime stays a plain multiply.

## Texture memory budget

A 2K RGBA texture with mipmaps is about 22 MB of GPU memory, so a 2K set (3 maps) is about 67 MB, and a 1K set about 17 MB. slice01 contains every area, so every slot loads.

- **Phase 1** (judge the look): every slot at 1K JPG. About 20 sets ≈ 340 MB of GPU memory. Acceptable on the 9800X3D desktop for evaluation, too heavy to ship.
- **Phase 3** (ship): convert to KTX2 with Basis UASTC (normals) and ETC1S (colour, ORM) via KTX-Software's `toktx`, loaded with Three's `KTX2Loader`. That cuts GPU memory roughly 4–8×, which leaves room to raise floors and the main wall paints to 2K.
- Report total texture memory in the existing perf overlay (ADR-0015) so the budget is visible.

## Risks

- **Visible repetition** in long corridors under the moving flashlight. Mitigations: rotate or offset UVs per wall tile from the room seed; the decal change will break it up further.
- **Rust everywhere** makes the station look abandoned before the outbreak. The area table keeps heavy rust to the tunnel and dive bay. The first playtest checks this.
- **flipY / normal handedness** mistakes make bumps look inverted. Covered by a test scene with a single lit wall.
- **Download size**: about 20 sets × 3 JPGs at 1K ≈ 15–25 MB. Fine for now; KTX2 shrinks it further.

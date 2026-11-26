# Modular Grid & Asset Scale Standard

> Compact architecture reference for `js-fps` levels, procedural kit pieces, and imported GLBs.
> Complements [registry.ts](../src/world/registry.ts).

## 1. Canonical World Units & Coordinate Frame

- **Units:** `1 unit = 1 meter` (`Y` up, `-Z` forward, `+X` right).
- **Piece Pivot:** Floor centre of the piece's primary cell `(0, 0, 0)`, facing `-Z`.
- **Player & Humanoid Envelope** ([motor.ts](../src/actors/motor.ts), [player.ts](../src/actors/player.ts), [skeleton.ts](../src/actors/skeleton.ts)):
  - Capsule: `radius = 0.35 m` (`0.70 m` diameter), `height = 1.75 m`, `eyeHeight = 1.62 m`, `stepHeight = 0.35 m`.
  - Reference humanoid height: `1.78 m` (`REFERENCE_HEIGHT`), feet at `y = 0.000`.

---

## 2. Strict Modular Grid Standard

| Dimension | Current Code (`types.ts`) | Standard Rule for New Rooms & GLBs |
| --- | --- | --- |
| **Cell Footprint (`CELL`)** | `4.0 m × 4.0 m` (`x, z ∈ [-2.0, +2.0]`) | **Locked `4.0 m × 4.0 m`**. Multi-cell rooms use integer multiples. |
| **Deck Step (`DECK_H`)** | `4.0 m` per `cell[1]` | **Locked `4.0 m`** vertical deck pitch (`0.4–0.8 m` plenum above ceiling). |
| **Wall / Room Height** | `3.2 m` default (`slice01` rooms use `3.2–8.0 m`) | **`3.2 m` standard** (or `3.5 m` / `4.0 m` for tall/hero bays; ceiling slab sits at `[H, H + 0.12]`). |
| **Wall Thickness (`WALL_T`)** | `0.25 m` (inward from cell edge) | **Inward-only:** `z ∈ [-2.000, -1.750]` on `-Z` edge. Never straddle unless it is a shared door frame. |
| **Corridor Clear Bore** | `3.0 m` wide × `3.2 m` high (`HW = 1.5 m`) | **Minimum `2.4 m` clear width** (`3.0 m` standard) for 2× `0.35 m` capsules + squad passing. |
| **Doorway Socket** | `2.0 m` wide × `2.4 m` tall (`DOOR_W × DOOR_H`) | **Standardized Socket:** centred at `[0, 0, -2.0]`, dir `[0, 0, -1]`, clear opening `x ∈ [-1.0, +1.0]`, `y ∈ [0.0, 2.4]`. |
| **Door Frame Envelope** | `4.0 m` wide × `H` tall, `z ∈ [-2.25, -1.75]` | Straddles cell boundary `z = -2.0` by `±0.25 m` (`WALL_T`). Adjacent room tiles **must omit** the wall on that edge. |

### Named GLB Empties (`registry.ts` / `fromGlb`)
Any GLB replacing a kit piece must sit on the `4 m` pivot (`y = 0` floor, `x, z ∈ [-2, +2]`) and include:
- `COL_*` — simplified box meshes for static AABB collision (hidden at runtime).
- `SURF_<metal|grate|rubber|water>_*` — floor/walkable collider + footstep surface tag.
- `SOCKET_<name>` — empty at boundary centre (e.g. `[0, 0, -2]`), `-Z` pointing outward.
- `LIGHT_<ceiling|wall|emergency>_*` — empty at fixture diffuser origin.
- `NAV_*` — walkable nav nodes at `y = 0` (`[0, 0, 0]` for tiles, `[0, 0, -2 ± 0.9]` for doors).

---

### Where a level is authored

| File in `src/data/levels/slice01/` | Holds |
| --- | --- |
| `rooms/<id>.json` | One room: its `layout` (what its floors, walls and ceilings are built from), `height`, props, lights, atmosphere, water, NPCs, anchors, walks, spawns and triggers. |
| `doors.json` | `doors` and `vents`, which span two rooms. |
| `level.json` | Id, seed, player and squad starts, `rooms` (every room id, in level order), pickups, map stations and checkpoints. |

A new room needs its file and its id in `level.json`. No script writes these files. A single-file level (`kit_test.json`) stores `pieces` and also loads.

### A room's shell: `layout`

The level builds each room's floors, walls and ceilings from its `layout` and the doors when it loads (`src/world/shell.ts`). The built pieces are never stored. Moving a door in `doors.json` removes the wall on both sides of its new edge and puts one back on the old edge.

| Field | Meaning |
| --- | --- |
| `cells` | `[x, z]` grid cells, deck 0. Each cell gets one ceiling, built in this order, and numeric light slots count the ceilings in this order. Add a cell at the end so existing lights keep their slots. |
| `floor`, `floorOverride`, `floorParams`, `floorMaterial` | Floor kit (default `floor`), a kit per cell (`"x,z"`), params per cell, and `params.material` for the other cells. |
| `ceiling`, `ceilingMaterial` | Ceiling kit (default `ceiling`; `ceiling_pipes` alternates with plain `ceiling`) and its material. |
| `walls`, `wallOverride`, `wallParams`, `wallMaterial` | Wall finishes, chosen per side by a fixed hash (default `wall_panel`, `wall_plain`). Also a kit and params per side (`"x,z,side"`, side `n`, `e`, `s` or `w`), such as a window or a glass partition, and `params.material` for the rest. |
| `open` | Outer sides with no wall that no door explains: an open seam into the next room, or this room's side of the next room's glass. |
| `fixtures` | When given, only these cells' ceilings carry a light housing, and numeric light slots count only them. |
| `extraPieces` | Pieces placed by hand after the built tiles (stairs, landings, blast gates), exactly as given. |

---

## 3. Anti-Gap & Anti-Z-Fighting Rules

1. **No Coplanar Shared Faces (`≥ 0.002 m` separation):**
   - Never place a `wall_*` tile on the same cell edge as a `door_frame` or another room's `wall_*` tile (`z = -2.0` and `z = -1.75` will z-fight).
   - Wall trim, skirting, decals, and status screens must sit proud of the backing plane by `≥ 0.004 m` (current `doors.ts` uses `±0.305` / `±0.316` on `0.60 m` jambs; `detail.ts` uses `0.015–0.030 m`).
2. **Floor / Wall / Ceiling Seam Overlap (No Light Leaks):**
   - Floor top surface is strictly `y = 0.000` (slab `y ∈ [-0.10, 0.00]`, subfloor `[-0.22, -0.12]`).
   - Wall backing extends `0.05 m` past `y = 0` and `y = H` (`y ∈ [-0.05, H + 0.05]`) behind the floor/ceiling edge so corner seams never leak void light.
3. **Material / DoubleSide Discipline:**
   - Keep `DoubleSide` only for thin glass or unclosed imported shells (`labWorld.ts`); keep structural kit slabs single-sided with outward normals.

---

## 4. Audit of Existing Levels & GLB Models (Measured in Meters)

### Level Files Inspected (Unmodified)
- [kit_test.json](../src/data/levels/kit_test.json): `5` rooms, `4` doors (`pressure_slide`, `bulkhead`, `glass_slide`), uniform `3.2 m` height, deck `0`.
- [slice01/](../src/data/levels/slice01/): `35` rooms, `30` doors, deck `0`, room heights `3.2 / 3.6 / 4.0 / 4.5 / 5.0 / 8.0 m` (uses `wall_*`, `floor_*`, `ceiling_*` kit pieces).
- [demoRoom.ts](../src/world/demoRoom.ts): Hand-built `6 m × 3.2 m × 20 m` corridor (pre-kit showcase).
- [labWorld.ts](../src/world/labWorld.ts): Standalone `?level=lab` sandbox using `underground_lab.glb` + voxelized `int16` colliders.

### GLB Bounding-Box Measurements (`public/assets/models/`)
Measured from glTF scene-graph transforms and dequantized `POSITION` accessors (`KHR_mesh_quantization` normalized):

| Model | Measured Size `[W, H, D]` (m) | `min.y .. max.y` (m) | Status / Alignment Note |
| --- | --- | --- | --- |
| `squad/hale.glb` | `1.760 × 1.819 × 0.322` | `-0.001 .. 1.818` | **1:1 meters, feet at `y = 0`**. Ready. |
| `squad/heins.glb` | `1.019 × 1.822 × 0.392` | `0.000 .. 1.822` | **1:1 meters, feet at `y = 0`**. Ready. |
| `squad/mechanic.glb` | `1.366 × 1.784 × 0.356` | `0.000 .. 1.784` | **1:1 meters, feet at `y = 0`**. Ready. |
| `squad/priya.glb` | `1.708 × 1.745 × 0.336` | `-0.003 .. 1.742` | **1:1 meters, feet at `y = 0`**. Ready. |
| `squad/bram.glb` | `1.773 × 2.000 × 0.403` | `-1.000 .. 1.000` | Quantized `[-1, 1]` bounds; `bodyModel.ts` normalizes to `1.78 m` at `y = 0`. |
| `squad/doctor.glb` | `2.000 × 1.982 × 0.432` | `-0.991 .. 0.991` | Quantized `[-1, 1]` bounds; normalized by `bodyModel.ts`. |
| `squad/giles.glb` | `0.644 × 2.000 × 0.712` | `-1.000 .. 1.000` | Quantized `[-1, 1]` bounds; normalized by `bodyModel.ts`. |
| `squad/ruiz.glb` | `0.691 × 2.000 × 1.003` | `-1.000 .. 1.000` | Quantized `[-1, 1]` bounds; normalized by `bodyModel.ts`. |
| `squad/sung.glb` | `0.735 × 2.000 × 0.556` | `-1.000 .. 1.000` | Quantized `[-1, 1]` bounds; normalized by `bodyModel.ts`. |
| `crew/botanist_1.glb`, `_2.glb` | `2.000 × 2.000 × 2.000` | `-1.000 .. 1.000` | Quantized `[-1, 1]` bounds; requires `bodyModel.ts` or `+1.0 m` Y-shift. |
| `crew/botanist_3.glb` | `8.455 × 8.455 × 8.026` | `-4.156 .. 4.299` | **Oversized (~4.7×)**, centered at origin; needs scale `~0.21` + floor shift. |
| `crew/assistant.glb` | `0.020 × 0.018 × 0.020` | `-0.009 .. 0.009` | **Sub-meter (~1/100×)**; relies on `bodyModel.ts` skeleton normalization. |
| `infected/gamechar.glb` | `0.030 × 0.051 × 0.010` | `-0.025 .. 0.025` | **Sub-meter (~1/35×)**; relies on `bodyModel.ts` normalization. |
| `infected/necromorph_crowd.glb` | `0.012 × 0.020 × 0.006` | `-0.010 .. 0.010` | **Sub-meter (~1/90×)**; relies on `bodyModel.ts` normalization. |
| `infected/necromorph_slasher.glb` | `0.057 × 0.015 × 0.033` | `-0.008 .. 0.008` | **Sub-meter (~1/100×)**; relies on `bodyModel.ts` normalization. |
| `weapons/pistol.glb` | skinned, authored in 0.024 m units | the camera bone at `y = 34` | Viewmodel with a 1142x Armature node; scaled to metres and positioned via `WEAPON_MODELS.pistol.scale` and `.ref` (`glbWeapons.ts`). |
| `weapons/shotgun.glb` | skinned, authored in 0.024 m units | the camera bone at `y = 34` | Same rig and glove as the pistol; scaled and positioned via `WEAPON_MODELS.shotgun.scale` and `.ref`. |
| `lab/underground_lab.glb` | `73.843 × 9.325 × 52.537` | `-5.641 .. 3.684` | `223,504` tris, `0` empties; standalone sandbox (`?level=lab`), not `4 m`-snapped. |
| `seabed/ocean_floor_scene.glb` | `12.172 × 4.287 × 12.762` | `-1.426 .. 2.861` | Re-framed & instanced in [seabed.ts](../src/render/fx/seabed.ts). |
| `vehicles/kilo_submarine.glb` | `13.512 × 18.931 × 71.228` | `min.x = 78.871` | Off-center pivot (`+85.6 m` X); re-centered & scaled (`SUB_SCALE = 1`, `14.5 m` dock fit) in [subModel.ts](../src/render/fx/subModel.ts). |

# Design

## Context

See proposal.md (Why) for the motivation. This section covers only the current state that shapes the approach.

- **`KitRegistry` already has a GLB swap.** `world/registry.ts` maps a kit id to a GLB through `data/kit-manifest.json`. When the GLB is loaded, `create()` returns `fromGlb(...)` and skips the procedural generator entirely, including its colliders. Colliders then come only from `COL_*` and `SURF_*` meshes inside the GLB. Downloaded models never contain those.
- **Headless builds never load GLBs.** `headlessSlice.ts` builds the level with `new KitRegistry({ glb: {} })`. That build backs the level tests: collision, nav, jump tops and the 60-call / 1.5 M-triangle budgets. A kit id with no procedural generator would throw `unknown kit piece` there.
- **The room merger re-tiles repeating textures.** `Level.integrate` sends a GLB subtree's meshes to the room's `AoMergeBuilder`. `takesWorldUvs()` (`kit/merge.ts`) re-projects UVs for any material whose map has `RepeatWrapping`. glTF samplers default to `REPEAT`, so an imported prop's authored UVs would be overwritten with world-space tiling.
- **`render/gltf.ts` already has helpers.** `createGltfLoader()` (with the Meshopt decoder) and `normalizeGltf()` (scale, pivot, -Z facing, colour spaces) exist and are used by the corner test.
- **Existing import scripts are hand-written per asset** (`scripts/fix-*-glb.mjs`). Textures go through `npm run textures` (`scripts/textures/import.ts`, ImageMagick, WebP output) from raw sets in `../textures`.
- **The sources are mixed:**
  - The Poly Haven glTF ships 2K JPGs with a packed ARM map and an OpenGL normal.
  - The Naked Singularity GLB has 576 triangles, PNG/JPEG maps, hinged doors and one preview animation.
  - The Biomasse GLB is a demo scene: 14 meshes, a concrete wall, a light and about 10 MB of PNGs.
  - The Industrial pack is 12 FBX files of 33 to 167 KB, each with separate base colour, metallic and roughness PNGs. The normal maps are either DirectX or OpenGL, and the file name says which (`_Normal_DirectX` or `_Normal`).
- **Machine constraints.** The repository is on a Windows PC. Agents work through a shell that can run Node scripts but not Vite, and several agents share the PC's RAM (AGENTS.md).

## Goals / Non-Goals

**Goals:**
- One repeatable command turns a list of raw sources into game-ready GLBs and their cost records.
- An imported prop behaves exactly like a procedural one in headless tests, collision, nav and budgets. The model only changes how it looks.
- Adding the next imported prop takes one config entry, one stand-in and one manifest line.

**Non-Goals:**
- Placing any imported prop in slice01. That is the lab-wing rebuild.
- Replacing existing procedural pieces (walls, doors, crates) with GLBs.
- Skinned or animated imported props. Hinged parts are kept as separate nodes only (see Decision 6).
- Geometry compression (Draco, Meshopt) and KTX2 textures.
- Moving the crew and weapon `fix-*-glb` scripts onto the new pipeline.

## Decisions

### 1. One script, config-driven: `scripts/import-props.ts` + `scripts/props.sources.json`

Each config entry names:
- `id`, the source file (relative to the raw folder, default `../props-src`) and `licence`/`credit`
- the node or material names to keep or drop
- `front` (which way the model faces in the file)
- `height` in metres
- `triBudget` and `texturePxPerM`

The script runs each entry through the same steps:

```
read --> keep/drop nodes --> bake transforms, drop skins/anims/cameras/lights
     --> scale to `height`, pivot floor centre, face -Z
     --> weld, simplify to triBudget (meshoptimizer)
     --> materials: ORM pack, DX->GL normal, resize, WebP (ImageMagick)
     --> drop unused data --> write props/<id>.glb + record cost
```

`npm run props [-- <id> ...]` runs all entries or only the named ones.

- **Why config over per-asset scripts:** the nine first assets differ only in parameters. A table keeps the next import to one entry. The existing `fix-*-glb` scripts remain for characters, which need bespoke rig surgery.
- **Alternative: the `@gltf-transform/cli` `optimize` command.** It cannot convert FBX, pack separate PNGs into ORM, flip normals or scale to a known height, so the script uses the library API directly.

### 2. FBX through three.js `FBXLoader` in Node, materials rebuilt from the sibling PNGs

- `FBXLoader.parse(buffer)` runs in Node 22 for geometry and the scene graph. Its texture loads need a DOM, so the script gives it a `LoadingManager` that turns every texture URL into nothing and keeps only geometry, node names and material names.
- The script then builds the glTF document itself with `@gltf-transform/core`:
  - geometry: positions, normals, the first UV set, indices
  - materials from the PNGs beside the FBX, matched by suffix: `_Base_Color`, `_Metallic`, `_Roughness`, and `_Normal` or `_Normal_DirectX`. `_Height` is ignored.
- FBX scenes are often in centimetres. Scaling to the configured `height` makes the file's units irrelevant.
- **Alternative: the `fbx2gltf` npm package.** Rejected. It is unmaintained (0.9.7-p1) and bundles Autodesk FBX SDK binaries under Autodesk's licence. If `FBXLoader` fails on a file, the fallback is to export that one file to glTF by hand, not to add the binary.

### 1a. Only `@gltf-transform/core` and `/extensions`; no `@gltf-transform/functions`, no `sharp`

- `@gltf-transform/functions` imports `ndarray-pixels`, which imports `sharp` as soon as it loads. `sharp` is a native binary, and agents verify work in a Linux shell against the Windows `node_modules`. In that shell any module importing `functions` would fail.
- The four `functions` steps the script needs are small to write directly:
  - **weld:** `meshoptimizer`'s vertex remap
  - **simplify:** `MeshoptSimplifier.simplifyWithAttributes` from `meshoptimizer` 1.3, installed as `meshoptimizer-v1` (`npm:meshoptimizer@^1.3.0`) next to the top-level 0.18. That 0.18 stays because `scripts/lib/scan-body.mjs` imports its `meshopt_simplifier.module.js`, which 1.3's exports no longer allow. Normals and UVs are weighted so seams survive. The 0.18 copy installed for `@types/three` stalled at about 7,000 of the power box's 19,856 triangles, because its UV and normal splits read as borders.
  - **prune and dedup:** the script builds each output document itself from one source, so it never holds unused or duplicate data to begin with
- **Alternative: keep `functions` and install `sharp`'s Linux binary next to the Windows one.** Rejected: `npm ci` on Windows wipes it, and every agent session would have to repair the install.

### 3. Texture rules

- **Size.** Size = the next power of two ≥ (largest model dimension × `texturePxPerM`). The default `texturePxPerM` is 1024, the surface-dressing standard's ceiling for props the player stands near. Size is clamped to 256–2048.
  - The 0.5 m power box gets 512 or 1024 depending on its UV layout. The config can override this.
- **Format.**
  - Colour: WebP, quality 85.
  - ORM: WebP, quality 90, with R = AO (white if missing), G = roughness, B = metalness.
  - Normal: WebP, quality 92, OpenGL convention. DirectX maps get their green channel inverted.
  - The maps are written into the GLB through `EXT_texture_webp`, which r170's `GLTFLoader` reads. This matches the WebP slots that `npm run textures` already writes.
- **Encoder.** ImageMagick (`magick`, or `convert` on Linux) does every image step, found the same way `scripts/textures/import.ts` finds it. It is already required for `npm run textures`, and the agents' Linux shell has it with WebP support. The script writes each map to a temporary file, runs ImageMagick, and reads the result back into the document.

### 4. The stand-in contract: visuals from the model, physics from the stand-in

Every imported id also has a procedural `PieceDef` in a new `src/world/kit/importedProps.ts`. It provides:
- one or more boxes with the prop's real size, in one shared stand-in material. All stand-ins in a room merge into a single draw call, which the budget count subtracts exactly. Flat paint was rejected because a stand-in could open a new paint bucket in a room, which would make the count off by one
- its colliders and footstep surfaces
- its climbable top, which the jump-tops test sees
- optional `spots` and `keepouts`

When the GLB is loaded, the registry calls the stand-in's generator, throws away the stand-in's visual meshes, and puts the normalised model in their place. Colliders, surfaces, sockets, light slots, spots and keepouts all come from the stand-in. A GLB's own `COL_*` and `SURF_*` conventions still apply to models authored for the kit, but imported props never rely on them.

- **Why:** collision stays authored, boxy and predictable (no voxelising of a 4k-triangle mesh). Headless tests need no GLB. A missing or failed GLB falls back to a correctly sized box instead of a crash.
- **Alternative: derive colliders from the GLB's bounding box at load time.** Rejected: browser builds and headless tests would disagree about collision, and an L-shaped prop (the trolley) would get one solid box.

### 5. Imported meshes keep their UVs and merge by material

- **UVs.** The registry tags every material of an imported model `userData.keepUvs = true`, and `takesWorldUvs()` returns false for it. The tag goes on the material, not the mesh, because `AoMergeBuilder.add()` receives only geometry and material. The materials are shared across clones, so tagging once at preload covers every instance.
- **Merging.** Imported meshes still go through the room merger, so per-vertex AO is baked and instances share draw calls. Every instance of one prop in one room merges to one call per material, because `clone(true)` shares materials.
- **Transparent materials** (the cabinet's glass) are tagged `userData.dynamic` and stay unmerged.
- **Attributes.** `AoMergeBuilder.add()` already strips everything except `position`, `normal` and `uv`. The import step still writes only `POSITION`, `NORMAL`, `TEXCOORD_0` and indices, and never quantizes, because the merger applies world matrices without dequantizing (`render/gltf.ts` warns about this).

### 6. Hinged parts become separate nodes, not animation

- The script drops skins and animations.
- A source node listed under `parts` in the config is kept as a separate node named `PART_<name>`, with its pivot at the hinge. Examples are the power box door and the cabinet doors.
  - Both rigged sources already put each door node's origin on its hinge, with the open angle as the node's rotation. The part keeps that origin as its pivot.
  - `closed: true` resets the rotation to closed before baking. The cabinet ships closed; the power box keeps its open door for R06.
  - The registry tags the part `userData.dynamic`, so a later sequence can rotate it.
- Everything else is baked and merged.
- This keeps the R06 option open (Giles opens the panel) without building an animation system for props now.

### 7. Cost records live in data and feed the budget test

- The script writes `src/data/imported-props.json`, which records for each id:
  - the GLB URL and source
  - licence and credit
  - triangles, materials (and how many of them are transparent), and texture pixels
- `kit-manifest.json` gets the `id -> url` line.
- `Level.roomStats()` adds, for each distinct imported id in a room, the recorded materials as draw calls and the recorded triangles × instances as triangles. In headless builds it first subtracts the stand-in's own contribution.
- The existing 60-call / 1.5 M-triangle assertions in `slice01.test.ts` then cover imported props without loading them.
- **Why data, not runtime measurement:** the level tests run headless and never load GLBs.

### 8. The bloom: meshes as props, material as a texture slot

- **Meshes.** From the Biomasse scene, the script keeps the biomass meshes as `bloom_growth_a`, `bloom_growth_b`, and so on, chosen by node in the config. It drops the concrete wall, the light and the demo camera.
- **Material.**
  - The `mat_biomass` maps are written into `../textures/Biomasse/` as a raw set.
  - A new `bloom` slot in `scripts/textures/sources.json` brings them in through the existing `npm run textures`.
  - The lab-wing rebuild can then use `bloom` on decals or surfaces like any other photo slot.
  - `mat_biomass_wall` is kept as a second set (`bloomWall`) only if the preview shows it reads differently.

### 9. Preview page

`sandbox/props.html` (with `src/sandbox/propsSandbox.ts`, like the poses sandbox) lists every manifest prop. For each one it shows:
- the GLB and its stand-in side by side on a 1 m grid
- the -Z facing arrow, the collider boxes and the climbable-top height
- an orbit camera

It loads nothing from slice01, so it stays light on the shared machine.

## Risks / Trade-offs

- **`FBXLoader` in Node fails on some files** (version or embedded data) → the script reports which file and which step failed and keeps going with the others. The fallback is a one-off manual glTF export of that file (Decision 2).
- **Simplifying to budget wrecks a silhouette** (the power box's breakers) → `triBudget` is per entry and the preview page shows the result. The budget can be raised; the triangle budget in `slice01.test.ts` is the backstop.
- **ImageMagick is missing or too old (no WebP)** → the script checks for it and its WebP support at start, and stops with one clear message before touching any source. Tests that need it skip with that message instead of failing.
- **Hiding the stand-in's visuals leaves a gap between the model and its colliders** (the box is bigger than the visible prop) → the preview shows both, and stand-in sizes come from the imported model's recorded bounds, rounded to 5 cm.
- **The cost records drift from the files** (a GLB re-imported without committing the JSON) → the script writes both in one run, and a test checks that each manifest URL's file exists and its byte size matches the record.
- **CC BY attribution is missed** → the config's `licence` and `credit` are required fields, and a test checks that every imported id appears in `CREDITS.md`.

## Migration Plan

- Nothing in slice01 changes, so there is nothing to migrate.
- Rollback is removing a manifest line, which falls back to the stand-in. Removing the change removes unused files only.
- The two dev dependencies can be dropped without touching runtime code.

## Memory (runtime-memory spec, "A change adds a texture set")

Measured on 2026-11-20 with the documented procedure's title-loaded point:
- Setup: built-in browser pane, 1280x720, quality Medium, dev build, `?debug&slot=scratch&memprobe`.

| Point | JS heap | GPU textures | GPU buffers | Render buffers | Programs | Decoded audio |
|---|---|---|---|---|---|---|
| Title, level loaded, with the `bloom` slot | 283 MB | 62 / 246 MB | 378 / 6 MB | 14 / 20 MB | 83 | 281 MB |

- **GPU textures** match the `trim-memory-footprint` baseline (62 / 246 MB). The three `bloom` maps are requested and decoded with the other photo slots. three.js uploads a texture on first render, and nothing in slice01 renders the slot yet.
- **When a room first uses the slot,** expect about 16 MB more GPU memory (three 1024 px RGBA maps with mipmaps), well under the 15 % reporting threshold.
- **JS heap and decoded audio** differ from the baseline mostly because of other in-flight work (new VO and gore files). This change adds no audio.
- **The 10-minute churn session** was not repeated. This change touches neither enemies nor gore.

## Verification notes

- 2026-11-20:
  - `npm run typecheck` clean.
  - Full `npm test` at the default concurrency: 841 of 841 pass (about 112 s), and 843 of 843 after the `bloom` slot.
  - `npm run props` imported all 11 props in about 15 s, each under its triangle budget.
  - The preview page shows every model on its stand-in.
  - Found and fixed during apply:
    - The 0.18 simplifier stalled on the power box.
    - Dropped meshes kept their materials alive.
    - Raising the top-level `meshoptimizer` to 1.3 broke `scan-body.mjs`; it is now aliased instead.
    - The trolley needed a deck-plus-handle collision shape.

# Proposal

## Why

The lab wing overhaul (R04 Lab B, R05 Lab Junction, R06 Pressure Door Hall) needs real props that the procedural kit cannot make well: a damaged breaker box, a glass-fronted lab cabinet, industrial cylinders and trolleys, and the bloom's organic growth. The kit has had a "GLB replaces the procedural piece" path since the start (`world/registry.ts`, `data/kit-manifest.json`), but no level has ever used it: the manifest is empty, and nothing defines how an imported prop is prepared, how much it may cost, or how it behaves in a room. This change makes that path real with a first batch of downloaded models, before the lab-wing rebuild places any of them. If the path needs work, that rebuild is not blocked behind it.

## What Changes

- **One import command for third-party props.** It reads glTF, GLB and FBX sources from a folder outside the repository and writes game-ready GLB files to `public/assets/models/props/`. It:
  - converts FBX with the three.js `FBXLoader` already in the project (no Autodesk binaries)
  - scales to metres, places the pivot at the floor centre facing -Z, and welds and simplifies to a per-asset triangle budget
  - packs AO/roughness/metalness into one ORM map and converts DirectX normals to OpenGL
  - resizes and re-encodes textures
  - drops cameras, lights, unused UV sets and preview-only animation clips
- **New dev dependencies:** `@gltf-transform/core` and `@gltf-transform/extensions` (MIT, plain JavaScript), and `meshoptimizer` 1.3 (MIT, WebAssembly) installed under the alias `meshoptimizer-v1`. The 0.18 that `@types/three` brings in cannot simplify across UV seams, and `scripts/lib/scan-body.mjs` imports a 0.18-only path, so the two versions sit side by side. `three` is already installed, and the image steps use ImageMagick, which `npm run textures` already requires. None of them ships in the game bundle, and none is a native binary, so the import and its tests run the same on Windows and in the agents' Linux shell.
- **Every imported prop has a procedural stand-in.** It is a simple shape with the prop's real size, colliders and climbable top. The stand-in is what headless tests, collision and navigation use. In the browser, the GLB replaces only the stand-in's visuals, and the colliders stay authored and predictable.
- **Imported props keep their own UVs.** The room merger's world-space UV projection skips them, so their textures are not re-tiled.
- **Budgets and records.** Each imported prop records its triangle count, material count and texture size, and the level tests count those in the per-room draw-call and triangle budgets even when the GLB is not loaded. Each one gets a `CREDITS.md` row and an in-game credits entry.
- **First batch (imported, not yet placed in any room):**
  - `power_box`: Poly Haven Power Box 01 (CC0), Giles's bypass panel
  - `lab_cabinet`: Laboratory Cabinet Storage, Naked Singularity (CC BY 4.0)
  - `bloom_growth_*` meshes and a `bloom` surface material, taken from the "PBR material Biomasse" demo scene, Bessarabian Femboy (CC BY 4.0)
  - `electrical_box`, `electrical_box_02`, `gas_cylinder`, `platform_trolley` and `cable_drum` from the 3dmodelscc0 Industrial pack (CC0)
- **A preview URL** shows every imported prop beside its stand-in, so the author can check scale, facing and materials before a room uses them.

## Capabilities

### New Capabilities
- `imported-props`: how third-party models become kit props, covering:
  - the import command and its outputs
  - the stand-in contract (visuals from the model; size, colliders and climbable tops from the stand-in)
  - UV and material handling in the room merger
  - per-prop cost records and their place in the room budgets
  - licence records

### Modified Capabilities
None. The level-kit and surface-textures requirements stay as they are. The `bloom` material is one more texture slot under the existing "Photo texture sets per material slot" requirement.

## Impact

- **Code:**
  - `src/world/registry.ts`: the GLB swap keeps the procedural colliders, surfaces and spots, and replaces the visuals
  - `src/world/kit/merge.ts`: no world UVs for imported meshes
  - `src/world/level.ts`: room stats include each imported prop's recorded cost
  - a new `src/world/kit/importedProps.ts` with the stand-ins
  - `src/data/kit-manifest.json` (first entries)
  - a preview page in the existing sandbox
- **Scripts:** a new `scripts/import-props.ts`, run as `npm run props`. Raw sources stay in `../props-src/` and never enter the repository.
- **Dependencies:** three dev dependencies in `package.json` and `package-lock.json`, none of them a native binary. The top-level `meshoptimizer` stays at 0.18 for `@types/three` and the crew-body pipeline. ImageMagick (`magick` or `convert`) must be on PATH, as it already is for `npm run textures`.
- **Assets:** about 9 new GLB files under `public/assets/models/props/`, and a `bloom` texture slot under `public/assets/textures/`.
- **Credits:** `CREDITS.md` and `src/ui/credits.ts`.
- **Tests:** stand-in and registry tests, the merger UV test, the budget accounting in `slice01.test.ts`, and an import-script test on a tiny fixture model.
- **Memory:**
  - The prop models only load when a room places them.
  - The `bloom` photo slot is fetched and decoded at startup like every slot. three.js uploads it to the GPU only when a mesh first uses it, so GPU texture memory in slice01 is unchanged (measured in design.md).
  - The lab-wing rebuild re-measures once the bloom is placed (runtime-memory spec).
- **Coordination:** no level data changes here, so this change does not conflict with `rebuild-dive-bay` in `gen-slice01.mjs` or `slice01.json`.

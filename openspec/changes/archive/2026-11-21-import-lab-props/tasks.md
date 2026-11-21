# Tasks

## 1. Setup and the FBX/simplify spike

- [x] 1.1 Add `@gltf-transform/core`, `@gltf-transform/extensions` and `meshoptimizer` ^1.3 (aliased `meshoptimizer-v1`, so the crew-body pipeline keeps 0.18) as dev dependencies (no `@gltf-transform/functions`, no `sharp`; design 1a); install them without letting npm reify the Windows `node_modules` from Linux (resolve in a scratch copy with `--os=win32 --cpu=x64`, copy in only the new package folders and the lockfiles); verify the lockfile changes only by additions, `@gltf-transform/core` imports in the Linux shell, and `npm ls` reports the tree clean
- [x] 1.2 Move the raw downloads into `../props-src/` (power_box_01_2k.gltf folder, IndustrialPack, the Biomasse and lab-cabinet GLBs) and verify every path in the config (2.1) resolves
- [x] 1.3 Spike: in a throwaway script, parse `ElectricalBox.fbx` and `Platform_Trolley.fbx` with three's `FBXLoader` in Node (no DOM, textures blocked by the loading manager), print node names, triangle counts and bounding boxes, then simplify the power box from about 21k to 4k triangles with meshoptimizer and write it to a scratch GLB; verify both FBX files parse, and open the simplified power box in the corner test (`?glb=`) to judge the silhouette. If `FBXLoader` fails, stop and report before building on Decision 2

## 2. Import command

- [x] 2.1 Write `scripts/props.sources.json` with the nine first entries (id, source, licence, credit, front, height, triBudget, texturePxPerM, keep/drop nodes, hinged parts) and verify that a missing required field (licence, credit, height) makes the script refuse the entry with its id
- [x] 2.2 Implement the source readers in `scripts/import-props.ts`: glTF/GLB through gltf-transform `NodeIO`, FBX through `FBXLoader` with materials rebuilt from the sibling PNGs by suffix (`_Base_Color`, `_Metallic`, `_Roughness`, `_Normal`/`_Normal_DirectX`); verify with a unit test on a tiny generated glTF fixture and on one committed CC0 FBX fixture from the Industrial pack
- [x] 2.3 Implement the kit-convention steps (drop cameras, lights, skins and animations, keep/drop nodes, bake transforms, scale to height, floor-centre pivot, -Z facing, weld with meshoptimizer's vertex remap, simplify to budget with `MeshoptSimplifier` and retry with a lower target until at or under budget, keep only POSITION/NORMAL/TEXCOORD_0, no quantization); verify with tests for the spec scenarios "Centimetre FBX", "Demo scene source" and "Over budget"
- [x] 2.4 Implement hinged parts as `PART_<name>` nodes with the pivot on the hinge; verify with a fixture test that the cabinet's two doors come out as separate parts rotating about their hinge edges
- [x] 2.5 Implement textures with ImageMagick (ORM packing, green-channel inversion for DirectX normals, power-of-two sizing from the largest dimension at the configured px/m clamped to 256-2048, WebP through `EXT_texture_webp`), with a start-up check for ImageMagick and WebP support; verify with tests for "Small prop" (0.5 m gives 512 px) and "DirectX normal source", which skip with a clear message when ImageMagick is missing
- [x] 2.6 Write each prop's cost record (triangles, materials, transparent materials, texture pixels, byte size, url, source, author, licence) to `src/data/imported-props.json` and its `id -> url` line to `src/data/kit-manifest.json` in the same run; add `npm run props [-- <id> ...]` with per-source error reporting and a non-zero exit when any source fails; verify with a test for "One broken source"
- [x] 2.7 Document the command, the config fields and the raw-folder layout in `docs/imported-props.md` (also covers the GLB naming conventions the `registry.ts` comment promises for `docs/kit-authoring.md`), link it from AGENTS.md next to the other asset docs, and verify the documented command runs as written

## 3. Stand-ins and the registry swap

- [x] 3.1 Add `src/world/kit/importedProps.ts` with a stand-in `PieceDef` for each of the nine ids (flat-painted boxes at the recorded size rounded to 5 cm, colliders, surfaces, climbable top, keep-outs where wall-mounted) and register it; verify with a test that every manifest id has a stand-in and that stand-in sizes match the recorded bounds
- [x] 3.2 Change `KitRegistry.create()` so a loaded model replaces only the stand-in's visible meshes and keeps its colliders, surfaces, sockets, light slots, spots and keep-outs; tag each loaded model material `userData.keepUvs` and each `PART_*` node `userData.dynamic` at preload; fall back to the stand-in with one warning naming the id when a model fails to load; verify with registry tests for "Headless level build", "Collision matches in the browser" and "Missing model file"
- [x] 3.3 Make `takesWorldUvs()` in `kit/merge.ts` return false for materials tagged `keepUvs`, and keep transparent imported materials unmerged; verify with a merge test that a repeat-wrapped `keepUvs` material keeps its source UVs and a plain repeat-wrapped material still gets world UVs

## 4. Budgets and credits

- [x] 4.1 Add the recorded cost of placed imported props to room stats (materials once per prop type per room, triangles per copy, after subtracting the stand-in's own contribution in headless builds); verify with a level test for "Headless budget check" on a small test level, and that `slice01.test.ts`'s budget test still passes unchanged
- [x] 4.2 Add a test that every manifest model file exists and matches its recorded byte size ("Stale record"), and that every imported id appears in `CREDITS.md` ("Missing credit"); verify both fail when an entry is broken by hand and pass when restored
- [x] 4.3 Add `CREDITS.md` rows and in-game credits entries (`src/ui/credits.ts`) for the CC BY models (lab cabinet, Biomasse) and the CC0 ones (power box, Industrial pack); verify the 4.2 credit test passes and the credits screen lists them

## 5. First batch and the bloom material

- [x] 5.1 Run `npm run props` for the nine ids and commit the outputs under `public/assets/models/props/`; verify the command exits 0, every file is under its triangle budget, and the 4.2 tests pass
- [x] 5.2 Extract the Biomasse `mat_biomass` maps to `../textures/Biomasse/` as a raw set, add the `bloom` slot to `scripts/textures/sources.json`, and run `npm run textures -- <dir> bloom`; verify `public/assets/textures/bloom/` has color, normal and orm files and the slot loads without the fallback warning
- [x] 5.3 Add `sandbox/props.html` with `src/sandbox/propsSandbox.ts`: each manifest prop beside its stand-in on a 1 m grid, with the -Z arrow, colliders and climbable-top height marked, and an orbit camera; verify by opening it in the running dev server and checking every prop's scale, facing and textures (one browser tab, closed afterwards)

## 6. Integration check

- [x] 6.1 Run `npm run typecheck` and the touched test files one by one, then the full suite once with the default concurrency; verify all pass and record the counts in the change's notes

## Workflow follow-up

- Justin reviews the preview page and the import outputs, then commits.
- Archive the change after review, then start the lab-wing rebuild change that places these props.

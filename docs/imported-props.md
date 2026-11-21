# Imported props

How third-party models become kit props (openspec spec `imported-props`, change `import-lab-props`).

## Raw sources

Downloads live **outside the repository**, in `../props-src/` (next to `js-fps`, like `../textures`). Keep the layout the config expects:

```
props-src/
  power_box_01_2k.gltf/power_box_01_2k.gltf (+ .bin, textures/)
  laboratory_cabinet_storage__pbr_low_poly__free.glb
  pbr_material_biomasse.glb
  IndustrialPack/<Name>/<Name>.fbx (+ <Name>_Base_Color.png, _Normal[_DirectX].png, _Roughness.png, _Metallic.png)
```

## Command

```
npm run props                          # every entry in scripts/props.sources.json
npm run props -- power_box cable_drum  # only these ids
npm run props -- --raw D:/somewhere/props-src
```

For each id it writes `public/assets/models/props/<id>.glb`, the prop's cost record in `src/data/imported-props.json` and its line in `src/data/kit-manifest.json`, all in the same run. A source that fails is reported with its id and the step (`read`, `conventions`, `textures`, `write`); the others still import, and the command exits non-zero.

Needs ImageMagick with WebP support on PATH (`magick`, or `convert` on Linux), the same as `npm run textures`. Everything else is plain JavaScript or WebAssembly, so the import and its tests (`scripts/props/*.test.ts`) run the same on Windows and in the agents' Linux shell.

## Config (`scripts/props.sources.json`)

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | snake_case kit id, also the GLB name |
| `source` | yes | `.gltf`, `.glb` or `.fbx`, relative to the raw folder |
| `licence`, `author`, `title`, `url` | yes | credit; a CC BY prop also needs a `CREDITS.md` row (a test checks) |
| `height` | yes | real height in metres; the model is scaled uniformly to it, so source units do not matter |
| `triBudget` | yes | most triangles; the model is simplified to it |
| `front` | no | which way the model faces in the file (`-z` default, `+z`, `-x`, `+x`); it is turned to face -Z |
| `texturePxPerM` | no | texture density, default 1024 px per metre of the largest side (the surface-dressing ceiling for props the player stands next to). Set 512 (the standard's target) for props 1 m or larger, and lower it if the size would round up to 2048 |
| `keep`, `drop` | no | selectors for the meshes to keep or drop: exact node name, `prefix*`, `mat:<material>`, `#<node index>` (for files with garbled names) |
| `parts` | no | hinged parts: `{ "door": { "node": "<source node>", "closed": true } }`. The node's origin is the hinge; `closed` resets its rotation before baking |
| `maps` | no | FBX only: texture files, if the suffix search beside the FBX (`_Base_Color`, `_Normal`/`_Normal_DirectX`, `_Roughness`, `_Metallic`, `_AO`) would pick the wrong ones |

## What the import does

1. Reads glTF/GLB with gltf-transform, or FBX with three's `FBXLoader` in Node (textures stubbed, maps rebuilt from the files beside the FBX).
2. Drops cameras, lights, skins and animations; applies `keep`/`drop`; bakes transforms.
3. Turns the model to face -Z, scales it to `height`, puts the pivot at the centre of its base.
4. Welds vertices and simplifies to `triBudget` (`meshoptimizer` 1.3, installed as `meshoptimizer-v1`; seams and shading weighted). The top-level `meshoptimizer` stays at 0.18 for the crew-body pipeline (`scripts/lib/scan-body.mjs`).
5. Keeps only `POSITION`, `NORMAL`, `TEXCOORD_0` and indices, never quantized (the room merger applies world matrices to raw floats).
6. Textures: colour, ORM (R = AO, G = roughness, B = metalness; white where a map is missing) and an OpenGL normal (DirectX green flipped), WebP through `EXT_texture_webp`, at the next power of two of (largest side x px/m), clamped to 256-2048.
7. Writes one `body` node plus one `PART_<name>` node per hinged part, translated to its hinge.

## In the game

Every imported id also has a **stand-in** kit piece (`src/world/kit/importedProps.ts`): grey boxes at the prop's recorded size (one shared material, so all stand-ins in a room are one draw call) with its colliders, climbable top and keep-outs. Headless builds and the level tests only ever see the stand-in. In the browser the GLB replaces the stand-in's visible meshes; collision always stays the stand-in's. If the GLB fails to load, the stand-in is shown and one warning names the id.

Imported materials keep their own UVs (the room merger's world-space tiling skips them). Every copy of a prop in a room merges into one draw call per material. The level budgets add each placed prop's recorded cost (materials once per prop type per room, triangles per copy), so `slice01.test.ts` counts them without loading any model.

Check new imports on the preview page, `sandbox/props.html`: every prop beside its stand-in on a 1 m grid, with its facing, colliders and climbable top marked.

## Authored GLBs for kit pieces

A GLB made for the kit (rather than downloaded) can also carry named empties and meshes, read by `fromGlb` in `src/world/registry.ts`: `COL_*` (collider box), `SURF_<concrete|metal|grate|rubber|water>_*` (collider with footstep surface), `SOCKET_<name>` (connection point, -Z out), `LIGHT_<ceiling|wall|emergency|pendant>_*` (light slot), `NAV_*` (walkable point). Pivot: floor centre, facing -Z, metres.

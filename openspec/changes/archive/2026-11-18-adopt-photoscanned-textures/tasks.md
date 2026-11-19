# Tasks

## 1. Import pipeline
- [x] 1.1 Add an `npm run textures` script (image processing uses the ImageMagick CLI instead of `sharp`, so no new devDependency)
- [x] 1.2 Write `scripts/textures/sources.json` mapping all 22 sets to their colour, GL normal, AO, roughness and metalness files (three naming schemes)
- [x] 1.3 Write `scripts/textures/import.ts` (run with `node --experimental-strip-types`): resize, pack ORM (R AO, G rough, B metal, constants for missing maps), desaturate Tiles132B, write `public/assets/textures/<slot>/{color,normal,orm}.jpg`
- [x] 1.4 Skip `.blend/.usdc/.mtlx/.tres`, displacement, DirectX normals and `__MACOSX`; fail loudly on a missing source file
- [x] 1.5 Add `../textures` source path as a script argument with that default; keep raw files out of git

## 2. Manifest and loader
- [x] 2.1 Create `src/render/tex/manifest.ts` with every slot from the design table (path, metersPerTile, size, tint, roughnessScale, fallback)
- [x] 2.2 Add an image loader in `src/render/textures.ts` (sRGB colour, linear normal/ORM, repeat wrap, mipmaps, anisotropy)
- [x] 2.3 Fall back to the procedural generator per slot when files are missing; log once per slot
- [ ] 2.4 Test: flipY and normal handedness match the procedural textures on a single lit wall

## 3. Materials
- [x] 3.1 Extend `Materials` with the new slots (diamondHazard, diamondRusty, hazardClean, rustHeavy, rustDrip, rustBlotch, concreteFloor, concretePainted, tileBroken, tileWall, tileWashroom, signDanger)
- [x] 3.2 Load photo slots in `createMaterialsAsync`; keep `steel` and `grating` procedural
- [x] 3.3 Turn on `aoMap` from the ORM texture; apply tint and roughness scale
- [x] 3.4 Update the stub materials in `slice01.test.ts` for the new slots

## 4. Kit geometry
- [x] 4.1 `floor_tiles`: replace the 16 tile slabs + grout slab with one `boxUv` slab using `labTile` (keep the `wet` puddles)
- [x] 4.2 `wall_tiles`: replace the grout-line geometry with one slab using `tileWall`
- [x] 4.3 Set each kit piece's `tile` value from the manifest's `metersPerTile` instead of hard-coded numbers
- [x] 4.4 Add a `signDanger` prop (single quad, full 0..1 UVs) for doors

## 5. Area palettes
- [x] 5.1 Add an area → material palette table (walls, floor, accents) from the design doc
- [x] 5.2 Make wall and floor pieces pick their material from the room's area, with per-piece override in level JSON
- [x] 5.3 Lab B floor swaps `labTile` → `tileBroken` on the outbreak sequence event
- [x] 5.4 Dive bay and tunnel use rusty `hazard`; everywhere else uses `hazardClean`

## 6. First look (Docking Ring)
- [ ] 6.1 Wire the dock area first and capture before/after screenshots from the same camera spots
- [ ] 6.2 Calibrate `metersPerTile` and tints by eye with Justin; then roll out the remaining areas

## 7. Budget and shipping
- [ ] 7.1 Show total texture memory in the perf overlay (ADR-0015)
- [ ] 7.2 Add KTX2 output to the import script (`toktx`: UASTC for normals, ETC1S for colour/ORM) and load with `KTX2Loader`
- [ ] 7.3 Raise floors and main wall paints to 2K once KTX2 is in, if the budget allows

## 8. Verify and document
- [ ] 8.1 Screenshot every area from fixed camera spots and check repetition, rust balance and darkness
- [ ] 8.2 Run the existing test suite and a full playthrough of the slice
- [x] 8.3 List every set and source in `CREDITS.md`
- [x] 8.4 Add a texture-sources addendum to ADR-0002

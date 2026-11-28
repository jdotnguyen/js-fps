# Tasks

## 1. Shared exterior lighting and water

- [x] 1.1 Add `src/render/fx/exteriorLight.ts`: shared water/lamp uniforms and `applyExterior(material)`, which patches a `MeshStandardMaterial` (ambient-scaled standard lighting, spot-lamp term, water fog). Unit test that the patched shader source has the lamp and fog code and that lamp packing caps at 8, nearest first. Verify with `node --experimental-strip-types --test src/render/fx/exteriorLight.test.ts`.
- [x] 1.2 Add the camera-centred water dome (far plane, water colour, lift only above the horizon). Test that the dome colour at and below the horizon equals the water fog colour.
- [x] 1.3 Switch the fish shader in `oceanLife.ts` to the shared water colour and density. Verify with a grep that no hard-coded fog colour remains, and that `tsc --noEmit` passes for the file.

## 2. Station-wide seabed, legs and floodlights

- [x] 2.1 Rebuild `seabed.ts` as a station-wide heightfield (footprint + 45 m margin, −4.5 m base, falls away with distance) plus instanced GLB rocks, with no caustics. It builds the ground without the GLB. Test that heights rise and fall continuously (no step over 0.3 m between neighbouring vertices) and that the far margin is lower than the near ground.
- [x] 2.2 Add `src/render/fx/exterior.ts` `buildExterior()`: ground, rocks, legs at column centres under the footprint (a checkerboard, so corridors get legs too), floodlight runs from window markers (`max(1, round(len/7))` lamps, housing, lens, speck beam), flicker on flagged runs (steady under reduced flashing). Test the lamp counts for runs of 4, 8, 12 m and that legs stay inside the footprint.
- [x] 2.3 Expose `HullBuilder` footprint columns and screen openings: `wall_sanity_screen` cuts the glass hole but is not a window for `windowViews` or exterior-eye culling. Extend `grid.test.ts` to cover it and verify it passes.
- [x] 2.4 Use `applyExterior` on the exterior hull plating. Drop its emissive glow to a faint 0.04. Verify by reading the material in the hull test.

## 3. Window tiles and sanity screens

- [x] 3.1 Strip `windowWall()` of the abyss plane, seabed strip and truss. Keep glass, frame and the `ocean-zone` marker (now carrying `flicker`). Remove `backdropDepth`. Verify that no mesh named `abyss-backdrop` or `seabed*` comes from a window tile.
- [x] 3.2 Add the `wall_sanity_screen` tile: window frame and glass, a per-bay procedural daytime-city screen shader with parallax, a pixel grid and capped brightness, tilted blind slats, a dark back, and a striped floor-light decal, with no ocean marker. Test that the tile builds headless, has a screen mesh per bay and emits no `ocean-zone`.

## 4. Level integration

- [x] 4.1 In `Level`: collect window markers station-wide, call `buildExterior` after the hull, tick it, and show it only when a visible room has a real window or an exterior eye is in use. Collect `exterior-lamp` markers. Remove `tickSeabed`. Verify that the exterior group is hidden while the player is in an interior room in a headless slice test.
- [x] 4.2 Mark the supply sub's two headlamps as `exterior-lamp` objects and run its hull materials (GLB and procedural) through `applyExterior`. Verify that the slice test finds 2 sub lamps.
- [x] 4.3 In `gen-slice01.mjs`, switch R02, R12c, R14c and R14d to `wall_sanity_screen`, drop `backdropDepth`, and flag the R01 dock window run with `flicker`. Regenerate `slice01.json`. Verify that `slice01.json` has `wall_window` only in R01, R01w and R12b.
- [x] 4.4 Replace the abyss-backdrop assertions in `slice01.test.ts` with exterior ones: one exterior group, 5 floodlights (R01 2, R01w 2, R12b 1), screens in the four rooms, no window-tile seabed or backdrop. Verify with the slice test file passing.

## 5. Checks

- [x] 5.1 Run `npm run typecheck` and the affected test files, and fix any failures caused by this change.
- [x] 5.2 Check the Docking Ring, Grow Hall and Commons in the running game (screenshots): no bars, the seabed fades, the lamp pools are visible, the screens are bright and the blinds read clearly.

## Workflow follow-up

- Archive the change once reviewed in game.

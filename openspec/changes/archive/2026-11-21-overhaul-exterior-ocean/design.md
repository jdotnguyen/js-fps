# Design

## Context

See proposal.md for why. Today `windowWall()` (`kit/detail.ts`) gives every `wall_window` tile its own `createAbyss` plane (portal-clipped, drawn at the far plane), a `createSeabed` strip of the "Ocean floor scene" GLB, two 10 m truss columns and a 12 m beam, plus an `ocean-zone` marker that `Level.buildRoom` batches into one `createOceanLife` rig per room. The station's outer skin is already built once (`HullBuilder` in `kit/exteriorHull.ts`), and its window list drives `Level.cull`. Exterior surfaces are lit like interiors: the level hemisphere and key lights, pooled room point lights, the scene's per-room `FogExp2`, and emissive self-lighting on the hull and seabed.

Constraints: DESIGN.md allows only a few shadow-casting lights, so the floodlights must not cast shadows or take pooled light slots. Camera far is 120 m. Tests build `slice01` headless with fake materials and no GLBs. Other sessions are editing `level.ts`, `gen-slice01.mjs`, `slice01.json` and `slice01.test.ts`, so changes to those files stay small and local.

## Goals / Non-Goals

**Goals:**
- Build the exterior once per level, from the hull and the window tiles' markers, never per tile.
- Give every exterior surface one lighting and fog model, so the seabed, hull, sub, rocks and fish fade into the same water colour and none of them gets an edge.
- Keep the draw-call budget flat: about one call each for the dome, seabed, rocks, legs, lamp housings and beams, whatever the number of windows.

**Non-Goals:**
- No power-cut screen reveal (screens are built over real glass so it stays possible later).
- No new fish models or behaviour; fish only switch to the shared water fog.
- The dev demo room (`demoRoom.ts`) keeps `abyss.ts` and its moan sync; it is not part of the game.

## Decisions

**1. One `exterior` module built beside the hull.** `src/render/fx/exterior.ts` exports `buildExterior({ hull, windows, materials })`, which returns `{ group, lamps, update(t, camera, visible) }`. `Level` calls it right after `hull.build()`. Window tiles no longer build anything outside the glass except the existing `ocean-zone` marker, which now also carries `flicker`. `Level` gathers those markers station-wide (it already gathers them per room for the fish). *Alternative:* keep per-tile pieces but align seeds and spacing. Rejected, because copies across panes and the hard edges come from the per-tile structure itself.

**2. Exterior lighting is custom, not three.js lights.** A shared uniform block (`exteriorUniforms`) holds the water colour and density, a small ambient term, and up to 8 spot lamps (position + range, direction + outer cone, colour × intensity + inner cone). `applyExterior(material)` patches a `MeshStandardMaterial` in `onBeforeCompile`:
- the standard lighting result is scaled by the ambient term (about 0.08), so room lights and the hemisphere barely reach outside;
- the lamp contribution is added on top as albedo × lamp × N·L × cone × range falloff;
- `fog_fragment` is replaced with exponential-squared fog toward the water colour, by camera distance.

The seabed, rocks, legs, lamp housings, exterior hull plating and the sub hull (GLB and procedural) all use it. The fish shader reads the same water uniforms instead of its hard-coded fog. *Alternative:* real `SpotLight`s. Rejected: each one adds lights to every lit material in the level and competes with the light pool.

**3. Water values.** Colour `#02070a` and density 0.07 (clear at 8 m, about 67% fogged at 15 m, about 99% at 30 m). The dome is a camera-centred sphere of radius 60 m, back-faced and drawn at the far plane. Its colour is the water colour, lifted by up to about 1.6× only when looking above the horizon. Below the horizon it equals the fog colour, so the seabed has nothing to end against.

**4. Seabed.**
- **Ground:** a procedural heightfield, not the GLB tile. It covers the hull footprint plus 45 m of margin, on a 1 m grid. The base level is −4.5 m relative to deck 0, with gentle noise of about ±0.6 m that falls by up to 5 m with distance from the footprint.
- **Ground texture:** the GLB ground's colour map when it has loaded, tiled every 6 m by world XZ. Otherwise (and in tests) a plain sediment colour.
- **Rocks:** the GLB's rock meshes, each re-centred, scattered as one `InstancedMesh` per rock mesh. Placement is seeded and biased to 4–25 m in front of real windows, with random yaw and scale 0.6–1.5, sunk 0.15 m into the ground.
- **Names and caustics:** every mesh name starts with `seabed`, so the existing shadow-pass skip still applies. The caustics shader is deleted.

**5. Station legs.** A leg under every other grid column, in a checkerboard (so one-cell corridors get legs too), from that column's lowest hull bottom down to the ground. Each stands at a cell centre, 2 m in from the hull edge, so the hull hides it from every window. The legs, collars and foot pads merge into one mesh. *Alternative:* only interior columns at least one cell in from the edge. Rejected: corridors and narrow wings would have none and float.

**6. Floodlights.**
- **Runs:** window markers that share a room, an outward direction and a wall line, and sit next to each other, form a run.
- **Lamp count:** `max(1, round(runLength / 7))`, spaced evenly along the run.
- **Placement:** each lamp sits 0.55 m above the window head and 0.35 m out from the glass, aimed out and down at about 43° (it hits the seabed about 8 m out).
- **Light values:** outer cone 32°, inner 18°, range 18 m, warm white `#fff1d0`.
- **Look:** each lamp gets a housing with a glowing lens and an additive beam cone. The beam shader scrolls a noise of specks, so marine snow shows only inside the light.
- **Flicker:** a run with `flicker` makes its first lamp flicker with a seeded pattern (a short dip every 6–14 s). Reduced-flashing mode holds it steady.
- **Lamp limit:** lamps beyond 8 are dropped, nearest the camera first. slice01 needs 5: R01 2, R01w 2, R12b 1.

**7. Sub headlamps.** The `supply_sub` piece marks each headlamp with an `Object3D` named `exterior-lamp` (its local +X points along the beam). `Level` collects these once and adds them to the lamp list each frame from their world matrices, only while the sub is visible. That lights the seabed under the docking sub with no change to the intro script.

**8. Sanity screens.** There is a new tile `wall_sanity_screen`. It uses the same window wall (frame, glass, mullions), puts no `ocean-zone` marker outside, and adds per bay:
- a screen plane 2 cm on the room side of the glass, running a procedural daytime downtown shader: sky gradient, sun haze, three building layers with lit/unlit window grids, a subtle pixel grid and a faint scan line;
- a little parallax from the camera direction, at a different depth per layer;
- blind slats in front, tilted to about 2/3 open, and a dark backing on the glass side.

Brightness is capped (emissive about 1.1, `toneMapped`), so bloom stays soft. The slats' light stripes are faked with a striped additive decal on the floor in front of each screen, so no new light. `HullBuilder` treats the tile as a glass opening that is **not** a window for `windowViews` or exterior-eye culling.

**9a. Ocean glass and dark life (after the first in-game look).** The shared `glass` (pale tint, 16% opacity, strong reflections) laid a grey film over the black water, and the fish and specks lit themselves, so the windows read grey and busy. Ocean windows now use their own near-black, 6%-opaque glass with faint reflections; interior partitions keep `glass`. Fish are faint silhouettes until a lamp reaches them, bubbles show only in a beam, and the bioluminescent specks are dim.

**9. Visibility.** The exterior group draws only when a visible room owns a real window, or when an exterior camera is in use. `Level.cull` already knows both. Lamp uniforms update only while it draws.

## Risks / Trade-offs

- [Patching `MeshStandardMaterial` shader text can break on a three.js upgrade] → keep every patch in one helper, guard each `replace` with a check that warns once, and test that the patched source contains the hooks.
- [Window spill from the rooms barely reaches the seabed, because the ambient term scales all standard lighting] → that is intended: near-black water. If it reads too dead, raise the ambient term in one place.
- [The procedural city may look synthetic up close] → the screens are meant to read as screens. A photo texture can replace the shader later without spec changes.
- [Concurrent edits in shared files] → small, anchored edits. Run the slice tests last, after re-reading those files.
- [Headless tests have no GLB] → the seabed must still build its ground and legs without the GLB, with rocks added when the model loads, so tests can assert on the exterior.

## Migration Plan

1. Land the exterior module and hook it into `Level` while the old per-tile pieces still exist.
2. Switch `windowWall` off the per-tile pieces, and add the screen tile.
3. Switch the four rooms in `gen-slice01.mjs`, regenerate `slice01.json` and drop `backdropDepth`.

To roll back, revert the change. Nothing persistent (saves, settings) depends on it.

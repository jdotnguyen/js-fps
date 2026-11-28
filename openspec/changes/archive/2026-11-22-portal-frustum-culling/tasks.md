# Tasks

## 1. Core Portal Frustum Culler

- [x] 1.1 Create `src/world/portalCull.ts` defining `PortalQuad`, `FallbackLink`, `OceanWindowPortal`, and `PortalCuller` with view-space near-plane polygon clipping, NDC rect projection/narrowing, sibling-portal rect merging per room pair, cycle/depth guards, straddle handling (`STRADDLE_MARGIN`), 1-hop light-bleed guard (`LIGHT_BLEED_DIST` + light-sphere frustum check), ocean-window culling, and no-camera 360-degree transitive BFS fallback; verify with `npm run typecheck`.
- [x] 1.2 Add unit tests in `src/world/portalCull.test.ts` covering multi-hop straight sightlines, closed-portal stopping, behind-camera culling, around-the-corner narrowed-rect culling, near-plane doorway straddling, 1-hop light-bleed guard (without cascading to depth 2+), non-adjacent AABB fallback links, ocean-window portals, and no-camera fallback; verify with `npm test -- src/world/portalCull.test.ts`.

## 2. Portal Extraction and Level Integration

- [x] 2.1 Expose `sill` and `head` world heights on `HullWindow` in `src/world/kit/exteriorHull.ts` so exterior window portals have exact 3D quads; verify with `npm run typecheck`.
- [x] 2.2 Build the portal graph in `Level` (`src/world/level.ts`) from doors (`closedBox`/opening quad + dynamic `open || seeThrough || porthole` predicate), `wall_glass_partition` cell edges, shared open `visibleFrom` cell edges, non-adjacent `visibleFrom` AABB fallback links, and `hull.windows` / `hull.windowViews`, then wire `Level.cull()` to `PortalCuller`; verify `npm test -- src/world/glassVisibility.test.ts` passes.
- [x] 2.3 Add optional `camera?: THREE.Camera` to `World.update()` in `src/world/world.ts`, `Level.update()` and `Level.renderFromEye()` in `src/world/level.ts`, and `FeedGlDeps.view` in `src/render/cameraFeedGl.ts`, and forward `camera` from `src/main.ts` and `createFeedGl().scene()`; verify with `npm run typecheck`.
- [x] 2.4 Extend `src/world/glassVisibility.test.ts` (and/or add slice01 portal integration cases in `src/world/portalCull.test.ts`) to assert real `slice01` multi-hop sightlines (`R02 -> R14a -> R14b -> R14c/d`, `R02 -> R03 -> R04` with `D_R02_R03` open, `R02 -> R12a -> R12b` with `D_R02_R12a` open), closed-door blocking (`R04 -> R03` keeps `R02` hidden when `D_R02_R03` is shut), and camera-facing vs facing-away culling; verify with `npm test -- src/world/glassVisibility.test.ts src/world/portalCull.test.ts`.

## 3. End-to-End Verification

- [x] 3.1 Run `npm run typecheck` and targeted level/lighting tests (`npm test -- src/world/portalCull.test.ts src/world/glassVisibility.test.ts src/world/lightSlots.test.ts src/world/shadowPool.test.ts src/world/slice01.test.ts`) and verify all pass.
- [x] 3.2 Playtest in the browser (reusing `http://localhost:5173/` if running) walking through TAG Offices (`R02 -> R14a -> R14b -> R14c/d`), Hydroponics (`R02 -> R12a -> R12b -> R12c`), Commons -> Observation Gallery -> Lab B (`R02 -> R03 -> R04`), and Pressure Door Hall -> Security -> Medbay (`R06 -> R07 -> R08`), verifying zero room pop-in blips, zero doorway threshold flicker, and zero light-spill snapping when panning near open doors/glass.

# Design

## Context

See `proposal.md` (Why) for the user-visible void-pop symptom.

Currently, `Level.cull()` in `src/world/level.ts` runs a single-hop pass from `cur`: it marks `cur` visible, then marks directly connected rooms via open/see-through/porthole doors and `visibleFrom`, then does one non-recursive snapshot pass of `this.hull.windowViews`. `Level.update()` only receives `eye: THREE.Vector3` (not `camera`), and `Level.renderFromEye()` only receives `eye` and `draw` (even though both `src/main.ts` and `src/render/cameraFeedGl.ts` already hold a `THREE.PerspectiveCamera`).

Meanwhile, actors (`npcs.group`, `squad.group`, `enemies.director.group`), `supplies.group`, and `gore.group` live directly on `scene` rather than inside `room.group`, and doors draw whenever either adjacent room is visible.

## Goals / Non-Goals

**Goals:**
- Eliminate 2+ hop room pop-in across any chain of open doors, `glass_slide` doors, porthole doors, glass partitions, and open `visibleFrom` boundaries.
- Clip recursive traversal to the active camera frustum and narrowed screen-space portal bounds so unseen wings, rooms behind the camera, and rooms around corners do not waste draw calls, `room.ticks`, or pooled fill/shadow light slots.
- Prevent near-plane threshold flicker when walking through doors and prevent light/shadow-spill snap when panning near a 1-hop open/glass portal.
- Keep headless tests calling `Level.update()` / `Level.renderFromEye()` without a camera working cleanly via a 360-degree open-portal fallback.

**Non-Goals:**
- Culling actors, enemies, supplies, or gore by room visibility (out of scope; fixing room visibility removes the void behind them and avoids doorway actor-pop edge cases).
- Authoring manual portal lists in level JSON (all portals are derived automatically from existing level data: doors, `wall_glass_partition`, `visibleFrom`, and `HullWindow`).
- Changing `bindLights()` priority semantics (`cur` remains priority 1, other visible rooms priority 0 nearest-first).

## Decisions

### D1: Pure `src/world/portalCull.ts` module for portal math & traversal

Extract portal representation and frustum-clipped traversal into a standalone, Three.js-math-only module `src/world/portalCull.ts` with no `Level` coupling so it can be exhaustively unit-tested with synthetic room graphs and `THREE.PerspectiveCamera` instances.

- **Data model:**
  - `PortalQuad`: 4 world-space corners (`[v0, v1, v2, v3]`), room pair `[roomA, roomB]`, world-space bounding box / center for straddle and distance tests, and a `passable: () => boolean` predicate (always `true` for glass/open boundaries; `d.open > 0.001 || d.visual.seeThrough || d.visual.porthole` for doors).
  - `FallbackLink`: for any `visibleFrom` pair with no shared physical portal edge (e.g., `R01a` declared `visibleFrom: ["R01", "R01w"]` where `R01w` is not edge-adjacent to `R01a`), store a directed link `from -> to` tested against the target room's merged world AABB projected into the parent's NDC rect.
  - `OceanWindowPortal`: world-space quad built from each `HullWindow` (using `x, z, dx, dz, halfWidth` plus newly exposed `sill` and `head` heights from `src/world/kit/exteriorHull.ts`), mapping to its target rooms in `hull.windowViews`.

- **Alternative considered:** Transitive 360-degree BFS without frustum clipping (~15 lines in `level.ts`). Rejected because the user opted for higher fidelity: frustum clipping keeps behind-camera and around-the-corner rooms out of `bindLights()` (preserving fill and shadow pool slots on all tiers), avoids running `room.ticks` for unseen rooms, and scales cleanly to more open-plan future levels.

### D2: Automatic portal extraction at level load

In `Level` constructor (once all rooms, doors, and `hull` are built):
1. **Door portals:** For each door `d` between rooms `[a, b]`, build the opening quad in world space from `cellMatrix(d.cell, d.rot)` using the door opening bounds (`x in [-DOOR_W/2, +DOOR_W/2]`, `y in [0, DOOR_H]`, `z = -CELL/2`, offset by `floorY` if needed — matching `d.visual.closedBox` transformed by `matrix`).
2. **Glass partition portals:** During `buildRoom`, record every `wall_glass_partition` cell edge (`width: 3.9`, `sill: 0.35`, `head: 2.54` above room `floorY`, matching `exteriorHull.ts`), resolve the owning room on the other side of `[x + dx, z + dz]`, and emit a bidirectional always-passable `PortalQuad`.
3. **Open `visibleFrom` boundaries:** For each `visibleFrom` room pair `[from, to]` that is not already joined by a door or glass partition portal:
   - Find shared cell edges between `from.cells` and `to.cells` (e.g., `R01 <-> R01w` in `slice01`) and emit full-opening quads (`width: CELL`, `y in [floorY, height]`).
   - If the two rooms share no cell edge (e.g., `R01w -> R01a`), emit a `FallbackLink` using the target room's union AABB.
4. **Ocean window portals:** Expose `sill` and `head` on `HullWindow` in `src/world/kit/exteriorHull.ts` so `Level` builds an `OceanWindowPortal` quad per seaward window linked to `hull.windowViews`.

### D3: View-space near-plane clipping + 2D screen-space NDC rect narrowing

For each recursive step `(roomId, clipRect, visitedPath, depth)`:
1. `clipRect` starts at `[-1, 1] x [-1, 1]` for `cur` (depth 0).
2. For each passable portal leaving `roomId` to `nextId`:
   - Skip if `nextId` is already in `visitedPath` (prevents cycles; allows reaching `nextId` via an alternate portal if that portal expands its visible NDC rect, with a hard depth cap e.g. `MAX_PORTAL_DEPTH = 12` as safety belt).
   - **Straddle check:** If the camera eye is within `STRADDLE_MARGIN` (`0.45 m`) of the portal's world AABB, treat the projected rect as the full `clipRect` so stepping through a doorway or pressing up against glass never clips the room ahead out.
   - **View-space near-plane clip:** Transform the 4 portal vertices into camera view space (`matrixWorldInverse`). Clip the polygon against `z <= -camera.near` (Sutherland-Hodgman, preallocated scratch arrays — zero per-frame allocations). If 0 vertices remain, the portal is completely behind the camera; skip.
   - **NDC projection & intersection:** Project surviving vertices with `projectionMatrix` to NDC `(x/w, y/w)`, compute their 2D bounding box `[minX, maxX, minY, maxY]`, and intersect with `clipRect`.
   - If `inter.minX < inter.maxX && inter.minY < inter.maxY`: mark `nextId` visible, merge `inter` into `roomRect[nextId]`, and recurse `(nextId, inter, ...)`.
3. **Ocean windows:** After interior portal traversal, for each room `r` marked visible with `roomRect[r]`, test each of its `OceanWindowPortal` quads against `roomRect[r]`; if it intersects, mark the target rooms in `hull.windowViews` visible (preserving the non-recursive ocean-window rule so a distant room's *other* windows don't cascade across unrelated interiors).
4. **Headless / no-camera fallback:** When `camera` is `undefined`, run transitive BFS over all passable portals (doors, glass partitions, `visibleFrom`) plus the existing `hull.windowViews` snapshot pass.

### D4: 1-hop light-bleed guard

Strict frustum clipping on 1-hop portals risks snapping off spilled light/shadows on `cur`'s floor when the player stands right beside an open doorway or glass wall and pans so the portal just exits the screen edge.

- **Guard rule:** For depth-0 (`cur`) passable portals only, if the camera eye is within `LIGHT_BLEED_DIST` (`4.5 m`) of the portal's world AABB **or** any active pooled light in the directly adjacent room has a range sphere intersecting the camera frustum, mark that 1-hop room visible (without recursing further through its own portals unless those portals were already reached via an in-frustum clip rect).
- **Why this works:**
  - Adjacent room lights and doorway-threshold shadows never snap off when panning your head.
  - Because the guard does **not** recurse to depth 2+, turning your back on a 4-room glass chain still culls all 2+ hop rooms cleanly.
  - Standing far across a large room (e.g. the far side of Commons looking away from TAG Reception) exceeds `LIGHT_BLEED_DIST` and culls even the 1-hop room behind you.

### D5: Camera plumbing & allocation hygiene

- `World.update(t, dt, eye, reducedFlashing, camera?: THREE.Camera)` in `src/world/world.ts` and `Level.update(...)` in `src/world/level.ts`: optional 5th parameter keeps all existing tests and `demoRoom.ts` compiling unchanged. `src/main.ts` passes `camera` (after ensuring `camera.updateMatrixWorld()`).
- `Level.renderFromEye(eye, draw, camera?: THREE.Camera)`: `src/render/cameraFeedGl.ts` updates `FeedGlDeps.view` to `(eye, draw, camera) => void` and passes its feed `camera`; `src/main.ts` forwards `camera` to `level.renderFromEye(eye, draw, camera)`.
- Reuse preallocated scratch `THREE.Vector3`, `THREE.Matrix4`, `THREE.Frustum`, and polygon vertex arrays inside `PortalCuller` so per-frame culling creates zero GC pressure (aligned with `runtime-memory` spec).

## Risks / Trade-offs

- **Risk: Slightly stale `camera.matrixWorldInverse` when `world.update` runs before `renderer.render`.**
  -> Mitigation: Call `camera.updateMatrixWorld()` (or compute from `camera.matrixWorld`) inside `portalCull` before reading `matrixWorldInverse` and `projectionMatrix`, matching what `renderer.render` will draw.
- **Risk: Double-sided glass or multi-panel glass partitions (`R03 <-> R04` has 3 adjacent `wall_glass_partition` cells) causing redundant recursion into the same room.**
  -> Mitigation: Group co-planar portals between the same room pair or track each room's accumulated visible NDC rect per frame — only recurse into `nextId` when a portal expands `roomRect[nextId]` beyond what was already traversed (or merge sibling portals between `(A, B)` into their union NDC rect before recursing once into `B`). Merging sibling portal rects per `(roomA -> roomB)` pair before recursing eliminates exponential fan-out across multi-cell glass walls.
- **Risk: `R01a` or exterior camera (`cur === null` or `exteriorEye`) edge cases.**
  -> Mitigation: Preserve `exteriorEye` seaward-window check verbatim; handle `R01w -> R01a` via the AABB `FallbackLink` check; keep `cur === null` showing all rooms as before.
- **Risk: Performance of recursive traversal if many doors are propped open.**
  -> Mitigation: `slice01` has 30 rooms total; sibling-rect merging + cycle tracking + `MAX_PORTAL_DEPTH = 12` bounds per-frame work to a few dozen dot products (< 0.05 ms).

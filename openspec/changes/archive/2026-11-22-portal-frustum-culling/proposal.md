# Proposal

## Why

Room visibility culling in `Level.cull()` is currently strictly one hop from the room the camera occupies. Whenever the player looks through an open doorway or glass partition into a neighbouring room that itself connects via glass or an open door to a third room (such as Commons -> TAG Reception -> Open Office -> Director's Office/Boardroom, Commons -> Hydroponics Vestibule -> Grow Hall -> Seed Lab, Commons -> Observation Gallery -> Lab B, or Pressure Door Hall -> Security -> Medbay), the room two or more hops away stays hidden while scene-level 3D models (NPCs, squadmates, enemies, supplies) and intermediate door frames still draw in empty void — popping the room in only once the player crosses into the intermediate room.

## What Changes

- Replace 1-hop adjacency culling in `Level.cull()` with **camera-frustum-clipped multi-hop portal culling** across open doors, see-through/porthole doors, glass partitions, open `visibleFrom` boundaries, and ocean windows.
- Build a world-space portal graph at level load from doors, `wall_glass_partition` cell edges, shared open `visibleFrom` edges (with AABB frustum fallback for non-adjacent `visibleFrom` pairs), and exterior `HullWindow` quads.
- Pass the active `THREE.Camera` into `World.update()` (player camera) and `Level.renderFromEye()` (security camera feeds) so portal traversal projects and clips each portal quad against the current NDC window, recursing only through portals that intersect the narrowed window and stopping at closed opaque doors or out-of-frustum sightlines.
- Add a **1-hop light-bleed guard** so immediate adjacent rooms connected by open/see-through portals remain visible/lit when the camera is close enough for light or shadow spill across the threshold, preventing lighting from snapping off when panning slightly away from a doorway or glass wall.
- Preserve backwards-compatible headless behavior: when `camera` is omitted (existing unit tests), fall back to 360-degree transitive traversal over currently open/see-through portals.
- Keep actors, enemies, supplies, and gore out of room culling (out of scope for this change); fixing room visibility eliminates the floating-models-in-void artifact without risking doorway actor pop-in.

## Capabilities

### New Capabilities

(None)

### Modified Capabilities

- `room-visibility`: Extend room visibility from 1-hop glass/door adjacency to multi-hop sightlines through open and see-through portals within the camera frustum, while preserving closed-opaque-door occlusion and preventing light-bleed pop at adjacent portals.

## Impact

- **Core culling:** New pure module `src/world/portalCull.ts` (portal quad clipping, NDC projection, recursive traversal, and unit tests in `src/world/portalCull.test.ts`).
- **World & level integration:** `src/world/level.ts` (portal extraction, `cull()`, `update()`, `renderFromEye()`), `src/world/world.ts` (`World.update` optional `camera` parameter), `src/world/kit/exteriorHull.ts` (expose `sill`/`head` heights on `HullWindow`).
- **Callers:** `src/main.ts` (pass `camera` to `world.update` and feed view callback), `src/render/cameraFeedGl.ts` (pass feed `camera` to `d.view`).
- **Tests:** Update/extend `src/world/glassVisibility.test.ts` and add `src/world/portalCull.test.ts` covering multi-hop glass/open-door chains, closed-door blocking, corner/behind-camera culling, near-plane doorway straddling, 1-hop light-bleed stability, and security camera feeds.

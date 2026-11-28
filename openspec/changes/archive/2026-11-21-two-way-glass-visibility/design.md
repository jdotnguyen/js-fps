# Design

## Context

See proposal.md (Why) for the bug. The relevant pieces today:

- `Level.cull()` (`src/world/level.ts`) draws the current room, rooms behind its open or see-through doors, and every room whose `visibleFrom` lists the current room. It is one hop: a room drawn through glass does not pull in its own neighbours.
- `glass(owner, x, z, side)` in `scripts/gen-slice01.mjs` puts a `wall_glass_partition` on the owner's edge and records the opposite edge in `glassEdges` so the neighbour builds no wall there. The glass mesh is part of the owner's room group, so it is hidden whenever the owner is.
- The pairing is hand-written once per site as `visibleFrom: [owner]` on the room behind (R04, R08, R12c, R14c, R14d). Nothing writes the reverse.
- `opening(a, b, …)` already adds both rooms to each other's `visibleFrom`; it is the pattern to follow.
- The glass material is `DoubleSide`. The crack and blood overlays on glass (`glass_cracks`, `crackMaterial`, `bloodGlassMaterial` in `src/world/kit/slice.ts`) use the default front side and face the owner's side, so they cannot be seen from behind.
- NPC bodies are hidden by distance (45 m), not by room.

## Goals / Non-Goals

**Goals:**
- Fix the five glass sites in `slice01` from one place, so a new `glass()` call cannot be one-way.
- Catch one-way glass in any level's data in the tests, including `kit_test.json` and hand-authored levels.

**Non-Goals:**
- Changing `cull()` or making visibility recursive.
- Hiding NPCs with their room (separate change; see Risks).
- Any change to which door kits count as see-through.

## Decisions

**D1. Fix it in the generator, not in `cull()`.** `glass()` adds the owner to the neighbour's `visibleFrom` and the neighbour to the owner's, as `opening()` does. The neighbour room is looked up from the cell grid when the level is written out, since `glass()` can be called before the neighbour room exists (R14c, R14d are declared after R14b's glass calls). Concretely: `glass()` records `[owner, nx, nz]`; after all rooms exist, a pass resolves the room that owns cell `(nx, nz)` and adds both directions.
*Alternative:* have `cull()` derive pairs from `wall_glass_partition` pieces at load time. Rejected: it hides an authoring rule inside the renderer, duplicates information already in `visibleFrom`, and `cull()` would need cell-to-room lookups it does not have today.

**D2. Drop the hand-written pairings.** The `visibleFrom` on R04, R08, R12c, R14c and R14d only exist to pair with glass; with D1 they are redundant and would drift. Any `visibleFrom` that is not a glass pairing stays (R01a's, which pairs with R01/R01w windows, is unaffected).
*Alternative:* keep them as documentation. Rejected: two sources of truth for one fact.

**D3. Guard in the level tests, from the level data.** A test walks every level JSON: for each `wall_glass_partition` piece, it takes each cell and the piece's `rot` to find the cell edge, finds the room on the other side of that edge, and asserts both rooms list each other in `visibleFrom`. Failures name both rooms and the cell edge. It lives beside the other whole-level checks (`wallClearance.test.ts` style) and runs over `slice01.json` and `kit_test.json`.
*Alternative:* reject one-way glass in the level loader's validation (`src/data/types/level.ts`). Rejected for now: the loader validates shape, not cross-room geometry, and a test failure is enough to keep authors honest.

**D4. Make glass overlays double-sided.** `crackMaterial` and `bloodGlassMaterial` set `side: DoubleSide`, so cracks and blood are seen from behind the glass. A mirrored crack pattern from the back is correct for a crack through the pane; a mirrored smear is acceptable.
*Alternative:* place a second overlay on the far side. Rejected: twice the meshes and event wiring for the same look.

## Risks / Trade-offs

- [A door in the owner room shows a void beyond it] From Lab B, the gallery is drawn but the commons is not (one hop, by spec). If `D_R02_R03` stands open, the doorway shows black, with the commons NPCs in it. → Check it during the walkthrough task. If it shows, the follow-up is NPC-by-room hiding or closing `D_R02_R03` during `contact`; it is not fixed here.
- [Lighting shifts behind the glass] From R04, R03's four pooled lights now compete for the pool after R04's three. The current room keeps its lights first and the cap is still 8, so the fights stay lit, but the gallery side of the glass may look brighter than before. → Look at it in the walkthrough; mark gallery lights `pool: false` only if it hurts the fight's readability.
- [Draw cost] One more room is drawn when standing behind any glass. → Check frame time in Lab B during `contact` with the debug profiler; the gallery is a small room.
- [In-flight changes touch `slice01.json`] → Regenerate after rebasing; never hand-merge the JSON.

## Migration Plan

Regenerate `slice01.json` from the generator. Saves store room ids and flags, not visibility, so no save migration. Rollback is reverting the generator change and regenerating.

# Proposal

## Why

Glass partitions only work one way. `glass(owner, …)` in `scripts/gen-slice01.mjs` gives the glass to the owner room and removes the wall on the other side, but only the room *behind* the glass is made visible from the owner (by a hand-written `visibleFrom`). Standing behind the glass, the owner room is culled, and its glass with it, so the player looks through a hole into black, with NPCs from farther rooms floating in it (NPC bodies hide only by distance, not by room).

The player now walks into Lab B during the `contact` fight (`D_R04_R05` opens), and looking out at the Observation Gallery shows exactly this: no gallery, no glass, and the commons diners sitting in the void. Every other glass partition in the level is built the same way, so the same hole is waiting at each of them as soon as the player can reach the far side.

## What Changes

- **Glass is see-through from both sides.** When either room on a glass partition is the current room, the other one is drawn, and so is the glass itself.
- **`glass()` declares both directions**, the way `opening()` already does. The hand-written `visibleFrom` entries that only paired a room with its glass neighbour (R04, R08, R12c, R14c, R14d) are dropped, since `glass()` now produces them.
- **A level-data check** fails if any `wall_glass_partition` edge joins two rooms that are not each in the other's `visibleFrom`, naming the rooms and the edge. This covers hand-authored levels as well as the generated one.
- Affected pairs in `slice01`: R03 Observation Gallery ↔ R04 Lab B, R07 Security Office ↔ R08 Medical Bay, R12b Grow Hall ↔ R12c Seed Lab, R14b Open Office ↔ R14c Director's Office, R14b Open Office ↔ R14d Boardroom.
- **Not changed:** how doors, authored openings and ocean windows decide visibility; the 8-light pool and its current-room-first rule; NPC hiding (by distance only).

## Capabilities

### New Capabilities
- `room-visibility`: which rooms the level draws for the room the camera is in. This change covers glass partitions (see-through both ways) and the level-data check that guards it. Later changes can add doors, openings and windows here.

### Modified Capabilities
(none)

## Impact

- **Generator:** `scripts/gen-slice01.mjs` (`glass()`, and removal of the now-redundant `visibleFrom` on R04, R08, R12c, R14c and R14d), then a regenerated `src/data/levels/slice01.json`. R03, R07, R12b and R14b gain `visibleFrom` entries.
- **Validation / tests:** a check over every level's `wall_glass_partition` pieces (in `slice01.test.ts` or the level loader's validation in `src/data/types/level.ts`), plus a cull test in `src/world/` for standing behind the glass.
- **Runtime:** no change to `Level.cull()` is planned; it already honours `visibleFrom`.
- **Lighting:** from behind the glass, the owner room's pooled lights now compete for the 8-slot pool after the current room's lights. The current room keeps its lights first (render-lighting spec); the cap stays 8, so the number of real lights does not rise.
- **Look from the far side:** crack overlays (`glass_cracks`, owned by the glass owner) and glass blood are seen from the back for the first time; they are checked and fixed if they do not show.
- **Coordination:** `lab-b-score` and other in-flight changes touch `slice01.json`; regenerate after rebasing rather than hand-merging the JSON.

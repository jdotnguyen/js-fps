# Proposal

## Why

The current endgame in `slice01` ends in a sparse, generic 11-prop Control Room (`R11`) attached to a dead-end rusted Dive Bay closet (`R13d`) with a permanently sealed "Out of service" door (`D_R13b_R13d`) and a waist-high pipe blocking the `R11` doorway. Replacing this wing with a tall industrial Power Bay (`R11`), a cleared maintenance corridor (`R13d`), a North-South sub-sea rail Departure Boarding Bay (`R15a`), and a grand bank-like Arrival Terminal (`R16a`/`R16b`/`R16c`) sets up a much stronger no-combat narrative finale (restoring power, riding an abyssal windowed train, and arriving at a blood-soaked concourse).

Because this overhaul spans new room geometry, room-by-room art/FX, an animated abyssal train ride, new VO/music, and a new creature model, we are splitting the work into phases. This first change delivers **Phase 1: the basic structural room geometry, greybox train shells, walkability, and debug jump points** so scale, sightlines, and movement flow can be verified in-browser before per-room detailing (Phase 2) and the scripted finale rewrite (Phase 3).

## What Changes

- **Overhaul `R11` into the Power Bay shell**: Rename `R11` from "Control Room" to "Power Bay", raise its ceiling height from `4.0 m` to `5.0 m` on its `12 m x 12 m` (`3x3`) footprint, strip the old control-room console banks and climax combat spawns (`r11_climax`), and leave a clean walkable shell with a placeholder terminal anchor.
- **Detach and clear `R13d` (Maintenance Corridor)**:
  - **BREAKING**: Remove door `D_R13b_R13d` between Launch Hall (`R13b`) and `R13d`, sealing that wall solid on both sides and detaching `R13d` from the Dive Bay suite (`area: 'transit'`).
  - Remove the south-wall `pipe_run`, `pipe_labels`, and `pipe_leak` (and its `dive_leak` trigger/anchor) that currently obstruct `D_R13d_R11`.
  - Add a bulkhead door (`D_R13d_R15a`) on `R13d`'s east wall leading into the Departure Boarding Bay.
- **Add `R15a` Departure Boarding Bay (North-South)**: Build a `3x4`-cell (`12 m x 16 m`, `5.0 m` tall) North-South rail bay east of `R13d` with a west boarding platform, a center track bed holding a walkable greybox Train Car shell (west boarding door + side windows), and an east ocean-window wall with north/south tunnel mouths.
- **Add `R16a`/`R16b`/`R16c` Arrival Terminal (isolated on the grid)**:
  - `R16a` **Arrival Track Dock** (`3x3` cells = `12 m x 12 m`, `5.0 m` tall, sunken `floorY: -0.6`): center North-South track stopping at the stairs with a matching walkable greybox Train Car shell and a `~3.5–4.0 m` west exit platform. Exiting the train west and turning left (south) faces wide steps climbing `+0.6 m` onto the grand concourse.
  - `R16b` **Arrival Concourse** (`5x6` cells = `20 m x 24 m`, `8.0 m` tall ceiling, deck level `y = 0`): grand bank-entrance scale hall joined to `R16a` across the south stair seam, with a central path, two symmetrical rows of structural pillars (3 pairs flanking the approach to the booths, sized to conceal a large threat behind a pillar), and flanking check-in booth bays along the east and west sides.
  - `R16c` **Arrival Dispatch Room** (`2x1` or `3x1` shell at the far south end of `R16b`): greybox room shell for Heins's destination room.
- **Minimal sequence/script compatibility & debug jumps**: Remove dead `D_R13b_R13d` door commands and `r11_climax` combat spawns from `action_climax.json` / `action_restore.json` (deferring the full Power Bay + Train + Heins + Monster narrative rewrite to Phase 3), and add `?debug&jump=` targets for `r15a` and `r16` alongside `r11`.
- **Implementation approach**: Execute implementation using the `threejs-game-director` skill (routing through the repo's modular 4 m grid, `scripts/gen-slice01.mjs`, and `threejs-gameplay-systems` / `threejs-qa-release` verification).

### Out of Scope (Deferred to Phases 2 & 3)
- Detailed per-room prop dressing (generators/turbines in `R11`, rail signage/equipment in `R13d`/`R15a`, massacre blood dressing & flickering-light choreography in `R16b`).
- Scrolling abyssal sea-tunnel train ride FX, train door animation, and arrival swap logic.
- Full finale script rewrite (Giles power-up dialogue, Heins radio exchange, removing Giles's infection arc/foreshadowing, new VO/music, and importing/staging the new creature 3D model).

## Capabilities

### New Capabilities
- `transit-wing`: Defines the structural layout, spatial progression, greybox train shells, grand arrival terminal geometry, walkability, and debug jump access of the lower transit wing (`R11`, `R13d`, `R15a`, `R16a`, `R16b`, `R16c`).

### Modified Capabilities
- `dive-bay`: Removes `D_R13b_R13d` (making Launch Hall's east wall solid) and detaches `R13d` from the Dive Bay suite so the Dive Bay consists of `R13a`, `R13b`, `R13c`, and `R13e`.
- `scene-gathering`: Updates the `R11`/`R13d` wing isolation requirement now that `D_R13b_R13d` no longer exists (solid wall separation replaces sealing a Dive Bay door during the finale).

## Impact

- `scripts/gen-slice01.mjs` and generated `src/data/levels/slice01.json`: modified `R11`, `R13b`, `R13d`, removed `D_R13b_R13d`, added `R15a`, `R16a`, `R16b`, `R16c`, `D_R13d_R15a`, greybox train/pillar/booth structural kit pieces or props, and new anchors.
- `src/world/kit/` (new structural/greybox kit helpers as needed for the train car shell, grand pillars, check-in booth shells, and wide stairs; `src/world/kit/palettes.ts` for the `transit` area palette).
- `src/app/session.ts`: add `?debug&jump=r15a` and `?debug&jump=r16` jump targets.
- `src/data/sequences/action_climax.json`, `src/data/sequences/action_restore.json`, `src/data/sequences/rounds.json`, `src/data/sequences/quiet_restore.json`: remove references to deleted `D_R13b_R13d`, `dive_leak`, and `r11_climax` spawns.
- Tests: `src/world/slice01.test.ts`, `src/script/gather.test.ts`, `src/script/action.test.ts`, `src/script/quiet.test.ts`, and `src/world/wallClearance.test.ts` / `src/world/sunkenFloor.test.ts` updated for the new rooms and removed Dive Bay door.

# Proposal

## Why

Train Car B glides down the middle of R16a, a 12 m x 12 m dock, and stops beside a narrow west platform that ends at a solid wall. The concourse (`R16b`) lies south, at the end of the track, so the player steps off the train's right side into a dead end and only reaches the concourse by turning left up the stairs. The arrival should show the concourse: standing between its pillars you should see the whole right side of the train, the gate it came through on your left and a dark tunnel it is stopping before on your right.

The ride runs on one straight +Z axis, so the train must not turn. The terminal turns instead.

## What Changes

- Turn the arrival terminal 90 degrees clockwise around the dock. `R16b` moves from south of `R16a` to west of it (`24 m` east to west x `20 m`), so the pillar rows run east to west and the first pair frames the dock's centre line. `R16c` hangs off `R16b`'s south side. The train keeps running north to south in `R16a`'s east column, and `R16A_TRAIN_PARK` and every ride constant are unchanged.
- `R16a`: the whole west edge opens (`12 m`) onto full-width stairs up to `R16b`, replacing the south stairs. The south wall closes over the platform and opens over the track onto a dark, unlit bore, so the track runs through the dock instead of ending in it.
- A platform-edge rail runs between platform and track with a boarding gap at the car door, reaching the north and south walls so nobody can walk onto the track at the car's tail or nose.
- The right-side boarding door of Train Car B no longer opens automatically at the end of the ride. It stays closed until a script opens it (Phase 3). A debug-only `&door=open` flag opens it for playtests.
- Rotate and re-place everything authored against the old layout: `R16b` pieces, props, lights and anchors; `R16c` and its door; the `R16a` lights; the scripted-walk and level tests.
- Inside Train Car B (`R16a`), mount a comms/radio terminal in the centre of the solid rear bulkhead (for the story's radio segment where others speak to Heins) and add an interior transit infographic / info sign on the solid windowless door-pocket wall at the north-west end of the car.

Out of scope: more stops on the line (a separate change), the end-of-ride power cut, and any turn of the train.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `transit-wing`: the `R16a` dock layout requirement (renamed), the `R16b`/`R16c` concourse requirement, the boarding door and train interior requirement (door stays closed until scripted; rear-bulkhead comms terminal and door-pocket info sign), the Stage 3 requirement (`R16a` ending), the grid and debug-jump requirement, plus an added requirement for the platform guard and the dark through-bore.

## Impact

- `src/data/levels/slice01.json`: `R16a` pieces, props, lights; `R16b` and `R16c` cells, walls, props, anchors; door `D_R16b_R16c`.
- `src/world/kit/transit.ts`: new `transit_dark_bore` piece (the south wall's portal and the unlit bore), plus the `trainShell` rear-bulkhead comms terminal and door-pocket infographic/info sign.
- `src/game/transitRide.ts`: only the end-of-ride door event. `src/app/session.ts`: the debug `&door=open` flag.
- Tests: `src/world/slice01.test.ts`, `src/world/kit/transit.test.ts`, `src/game/transitRide.test.ts`. Docs: `docs/PLAYTEST.md`.
- Specs: `openspec/specs/transit-wing/spec.md`.
- No new scene lights, samplers, or external texture files (procedural canvas decals only). `R16b` now butts against `R15a`'s east wall.

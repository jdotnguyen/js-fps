# Tasks

## 1. Grid and layout check

- [x] 1.1 Check the turned layout against `docs/modular-grid-standard.md`: `R16a` x cells 20-22, `R16b` x cells 14-19 (the `24 m` between `R15a` and `R16a`), `R16c` south of `R16b`, no cell shared by two rooms, the seam open for `12 m`. Cell map recorded in design Decision 8; verified by the layout test in `src/world/slice01.test.ts`.

## 2. Terminal layout

- [x] 2.1 Rotate `R16b` 90 degrees clockwise about the seam in `src/data/levels/slice01.json` (cells, wall edges and headings, props, anchors; the south end becomes the closed west end), and move `R16c` and door `D_R16b_R16c` south of it. Verify in `src/world/slice01.test.ts` (room spans, no overlapping floors, pillar rows flank z 36, the dispatch route walks).
- [x] 2.2 Rebuild the `R16a` west and south sides: full-width stairs on the west edge (rot 90), a south wall over the platform columns, extra ceiling cells for the bore, cabin light slots moved up by two. Verify with `npm test -- src/world/slice01.test.ts` (a capsule climbs the stairs onto `R16b`; nothing tall within 4 m of the car's right side; the seam is open).
- [x] 2.3 Add the `transit_dark_bore` kit piece in `src/world/kit/transit.ts` (wall piers and header around an open portal, unlit steel liner, solid end cap and floor, four fog planes) and place it with the `R16a` guard rail (two `platform_railing` runs, boarding gap `>= 2.2 m`, north and south runs reaching the walls). Verify in `src/world/kit/transit.test.ts` (unlit, no lit strip, fog thickens to the far end, the portal is open) and `src/world/slice01.test.ts` (a capsule cannot reach the track, and the bore is closed at its end).
- [x] 2.4 Re-run the wall-clearance, walk and light-slot tests for `R16a`, `R16b` and `R16c` and fix any regression: `npm test -- src/world/wallClearance.test.ts src/world/slice01Walks.test.ts src/world/slice01ScriptedWalks.test.ts src/world/lightSlots.test.ts src/world/level.test.ts`. (Result: no regression; four tests fail identically on a clean HEAD, none in R16: guard_return_desk, two Priya walks, an R10 pressure gauge.)
- [x] 2.5 In `src/world/kit/transit.ts` (`trainShell`), add the comms/radio terminal centred on the solid rear bulkhead (`+Z` local) and the transit infographic / info sign on the interior skin of the solid windowless door-pocket wall (`doorSign` side, `z` in `[doorHalf, pocketEnd]`), and verify placement/clearances in `src/world/kit/transit.test.ts`.

## 3. Ride end and door

- [x] 3.1 In `src/game/transitRide.ts`, stop emitting the arrival `transit:train_door` open event for `r16a_train`, keeping the gate seal and all motion constants. Verify in `src/game/transitRide.test.ts` that the door stays closed after the glide and that the pull-out, slow-down, glide speed and duration are unchanged.
- [x] 3.2 Check the `?debug&jump=r16` spawn (anchor `r16_train_exit`, facing west) and the `r16b` jump anchor stand on walkable floor in the new layout (the `slice01` terminal walk).
- [x] 3.3 Add the debug-only `&door=open` flag next to `jump=transit_ride` in `src/app/session.ts`, ignored without `?debug`.

## 4. Docs and spec validation

- [x] 4.1 Update `docs/PLAYTEST.md` with the turned terminal, the closed door, the debug flag and what to check (the section written for the first layout still describes the old one), and verify the documented URL runs as written.
- [x] 4.2 Run `openspec validate r16a-perpendicular-train-arrival --strict` and verify there are no errors.

## 5. Verification

- [x] 5.1 Run `npm run typecheck` and the touched test files (`npm test -- src/world/slice01.test.ts src/world/kit/transit.test.ts src/game/transitRide.test.ts`) and verify all pass.
- [x] 5.2 Browser check in one tab, closed afterwards: from between the first pillar pair in `R16b` looking east you see the train's right side, the gate on the left and the dark bore on the right; the stairs, rail and boarding gap look right; inside Train Car B, the rear-bulkhead comms terminal and the north-west door-pocket info sign are visible and clear of windows/doors; `jump=r16` and `jump=r16b` spawn on floor. The full ride playthrough needs pointer lock, which the automated browser lacks, so it is a by-hand check. (Partly done: from the seam and the concourse the train's right side, the gate on the left, the dark bore on the right, the rail, stairs and the concourse were checked in static browser views; the full ride playthrough and the ride timing are by hand.)

# Tasks

## 1. Procedural Transit Kit Pieces (`src/world/kit/transit.ts`)

- [x] 1.1 Implement `transit_blast_gate` (`4.0 m W x 5.0 m H`, recessed dark sea-tunnel bore, telescoping/vertical-lift armored shutter leaves contained within `x ∈ [-1.95, +1.95]`, hazard chevrons, rail aspect signal lamps, and `transit:blast_gate` / `level:reset` event handling) and register it in `src/world/kit/registry.ts`; verify with `npm run typecheck` and unit tests in `src/world/kit/transit.test.ts` covering default sealed state, `open: true` transition, and `level:reset`.
- [x] 1.2 Implement `transit_depart_board` (`CanvasScreen` 512×256 departure schedule & rail signage board showing `TRANSIT LINE 01 // ARRIVAL TERMINAL`) and `platform_railing` (brushed-steel safety handrail + yellow tactile edge strip) in `src/world/kit/transit.ts`, and register them in `src/world/kit/registry.ts`; verify with `npm run typecheck` and `src/world/kit/transit.test.ts`.

## 2. `R13d` Maintenance Corridor Clean Transit Finish (`src/data/levels/slice01.json`)

- [x] 2.1 Remove legacy `diamondRusty`, `rustBlotch`, and `paintDark` material overrides from `R13d` pieces in `src/data/levels/slice01.json` so `R13d` inherits the clean `transit` area palette, and update `R13d` lights to clean industrial transit lighting (`#dce8f4`, steady); verify `R13d` loads cleanly in `npm test -- src/world/slice01.test.ts`.
- [x] 2.2 Remove `debris_pile` in `R13d`, add wall-mounted upper conduit/pipe runs, directional `TRANSIT -> R15A` / `POWER BAY <- R11` stencils, and clean floor-wall finish (zero grime/rusty decals) preserving `>= 1.2 m` clear aisle width; verify corridor walkability (`D_R13d_R11` to `D_R13d_R15a`) in `npm test -- src/world/slice01.test.ts`.

## 3. `R15a` Departure Boarding Bay & `R15a`/`R16a` Blast-Gate Portals (`src/data/levels/slice01.json`)

- [x] 3.1 Dress `R15a` in `src/data/levels/slice01.json` with `5.0 m` overhead gantry ribs, west platform yellow tactile edge and `platform_railing` (preserving a `2.8 m` boarding gap at `z ∈ [36.6, 39.4]`), `transit_depart_board` rail signage, `room_sign` (`R15A DEPARTURE BAY`), west-wall boarding kiosk/bench cluster, and clean industrial transit finish; verify `r15a_platform` -> `r15a_train_inside` walkability and jump-top rules in `npm test -- src/world/slice01.test.ts src/world/slice01JumpTops.test.ts`.
- [x] 3.2 Replace the flat `wall_panel` at `R15a` south (`[12, 0, 11]`) with `transit_blast_gate` (`gateId: "r15a_south"`) and at `R16a` north (`[22, 0, 8]`) with `transit_blast_gate` (`gateId: "r16a_north"`), verifying portal alignment, sunken `R16a` seating, and no coplanar z-fighting or seam gaps in `npm test -- src/world/slice01.test.ts`.

## 4. Browser Visual & QA Verification (`threejs-qa-release`)

- [x] 4.1 Run `npm run typecheck` and targeted tests (`npm test -- src/world/kit/transit.test.ts src/world/slice01.test.ts src/world/slice01JumpTops.test.ts`) with all checks passing.
- [x] 4.2 Inspect `?debug&jump=r11` (walking north through `R13d` into `R15a`), `?debug&jump=r15a` (with `?checker` and `?nopost` passes + blast-gate open event check), and `?debug&jump=r16` (confirming `R16a` north portal seating) in the browser, confirming clean textures, legible rail signage, and no clipping or seam leaks.

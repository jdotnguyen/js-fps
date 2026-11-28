# Proposal

## Why

Phase 1 (`finale-transit-rooms-geometry`) established the structural geometry for `R13d` Maintenance Corridor, `R15a` Departure Boarding Bay, and `R16a` Arrival Track Dock, and Phase 2a (`detail-r11-power-bay`) dressed `R11` as a deep-sea Power Bay. `R13d` still carries legacy Dive Bay rusty material overrides and a blocking `debris_pile`, `R15a` is still an unadorned greybox boarding hall with a flat south wall behind the track, and `R16a` has a flat north wall instead of a sea-tunnel portal. Phase 2b finishes the departure approach with a clean industrial transit aesthetic, rail signage, and matching blast-gate / sea-tunnel portals at `R15a` south and `R16a` north ready for Phase 2c's abyssal train ride.

## What Changes

- **Clean industrial transit finish for `R13d` Maintenance Corridor**: Remove the legacy `diamondRusty`, `rustBlotch`, and `paintDark` overrides so `R13d` inherits the `transit` area palette (`cleanSlate`, `concrete`, `steelDark`, `concretePainted`), replace the legacy `debris_pile` with clean corridor dressing (wall conduit/pipe runs, clean industrial lighting, directional `TRANSIT -> R15A` stencils, and rule-placed grime decals) while preserving `>= 1.2 m` clear aisle width.
- **Detail `R15a` Departure Boarding Bay**: Dress the `12 m x 16 m x 5.0 m` hall with clean industrial transit architecture—overhead gantry ribs across the `5.0 m` volume, platform-edge yellow tactile hazard strip and safety railings (with a `>= 2.2 m` boarding gap aligned with the train's west doorway), an illuminated departure schedule / rail signage board (`TRANSIT LINE 01 // ARRIVAL TERMINAL`), boarding kiosk/bench cluster on the west platform, track-side signal beacons, and rule-placed decals/stencils.
- **Blast gate & sea-tunnel portals (`R15a` south & `R16a` north)**: Author a procedural `transit_blast_gate` hero kit piece replacing the flat `wall_panel` at `R15a` south (`[12, 0, 11]`) and `R16a` north (`[22, 0, 8]`). Each portal frames the track bore with a recessed dark tunnel mouth, heavy armored blast-gate shutter leaves, hazard chevrons, and rail aspect signal lights, with an event-driven open/close state (`transit:blast_gate` / `level:reset`) so Phase 2c can open `R15a`'s south gate for train pull-out and `R16a`'s north gate for train arrival.

## Capabilities

### New Capabilities

<!-- None: all behavioral requirements belong to the existing transit-wing capability. -->

### Modified Capabilities

- `transit-wing`: Add requirements for `R13d` clean industrial transit finish and signage, `R15a` Departure Boarding Bay rail signage and platform dressing, and the `R15a` south / `R16a` north blast-gate tunnel portals.

## Impact

- **Level Data**: `src/data/levels/slice01.json` (`R13d` piece materials/props/lights, `R15a` props/lights/wall portal replacement, `R16a` north wall portal replacement).
- **World Kit**: `src/world/kit/transit.ts` (new `transit_blast_gate` and `transit_depart_board` / platform rail signage pieces, registered in `src/world/kit/registry.ts` or `transit.ts` exports).
- **Tests**: `src/world/kit/transit.test.ts` and `src/world/slice01.test.ts` (verify `R13d` clean finish & walkability, `R15a` signage & boarding clearance, and `R15a`/`R16a` blast-gate portal placement and open/close state).
- **Downstream Phases**: Sets up Phase 2c (Train Interior + Abyssal Ride) with an animatable `R15a` south blast gate and matching `R16a` north arrival tunnel portal.

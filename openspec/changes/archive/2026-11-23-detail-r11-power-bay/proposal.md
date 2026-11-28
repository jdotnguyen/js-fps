# Proposal

## Why

Phase 1 (`finale-transit-rooms-geometry`) cleared `R11` into an empty `12 m x 12 m x 5.0 m` "Power Bay" shell with only a placeholder generic console and two wall beacons. Before the squad's finale script (Phase 3) plays out here, `R11` needs to read as an authentic deep-sea industrial power plant — anchored by heavy turbine-generators, high-voltage switchgear, Giles's dedicated transit power-up terminal, and a dramatic staged cascading lights-on sequence that visually wakes the dormant bay from station backup power.

## What Changes

- **Hero Power Bay machinery & architecture (`src/world/kit/transit.ts`, `scripts/gen-slice01.mjs`, `src/data/levels/slice01.json`)**:
  - Add bespoke procedural kit pieces in `src/world/kit/transit.ts` for `R11`:
    - `power_generator`: heavy deep-sea turbine-generator skid (~`3.4 m x 1.8 m x 2.4 m`) with vibration plinth, stator housing, coolant/busbar risers reaching toward the `5.0 m` ceiling, rotating flywheel/rotor assembly, and event-driven status beacon strips that spin up and shift from dormant amber to online cyan-green when energized.
    - `switchgear_bank`: high-voltage industrial breaker and transformer cabinet bank (~`2.8 m x 0.9 m x 2.4 m`) with busbar ducts, analog gauge clusters, breaker throws, and event-driven online status indicators.
    - `power_terminal`: Giles's master transit-grid control station on the west wall (replacing the generic `console` at `final_console`), featuring a hooded industrial desk, breaker handle cluster, floor conduit run, and a live `CanvasScreen` showing `TRANSIT SUB-GRID // POWER BAY 11` telemetry that updates across `standby -> starting -> online`.
  - Dress `R11` to `docs/surface-dressing-standard.md` and `docs/modular-grid-standard.md`:
    - Pair the bespoke hero units (two parallel turbine-generators along the east bay, HV switchgear along the east/south-east perimeter, Giles's power terminal on the west wall) with existing imported industrial props (`electrical_box_02`, `electrical_box`, `power_box`, `cable_drum`, `gas_cylinder`, `platform_trolley`), overhead `5.0 m` structural rib frames / cable trays / pipe runs, hazard floor striping, stencil signage (`POWER BAY 11`, `TRANSIT SUB-GRID`), and rule-placed grime/oil decals.
    - Preserve unobstructed `>= 1.2 m` squad paths between `D_R10_R11`, `r11_giles_task`, `r11_hold`, and `D_R13d_R11`, as well as all Phase 3 placeholder anchors (`giles_final`, `final_console`, `r11_okafor_*`, `r11_jay_end`) and `fluid_trail` until Phase 3 rewrites the ending.
- **Per-light auxiliary circuit energize (`src/world/level.ts`, `src/script/host.ts`, `src/script/actions.ts`, `src/script/gameHost.ts`)**:
  - Extend the `light` sequence step and `Level.setLight` with an optional `power` scale (`0..1`) so scripted events can energize individual named lights onto auxiliary power while the rest of the station remains on `backup` power (and reset cleanly on `mains` or `level:reset`).
- **Cascading lights-on & power-up sequence (`src/data/sequences/action_climax.json`, `src/data/sequences/action_restore.json`, `scripts/ambience-generate.ts`, `src/audio/sounds.ts`)**:
  - Author `R11`'s ceiling lighting as three named spatial banks (west/terminal row, center aisle row, east generator row; 2 shadow-casting slots) that stay dark under `station_power: 'backup'` while the two `emergency_beacon` slots (and a subtle terminal task glow) keep the dormant room readable.
  - Add a reusable `r11_power_cascade` sequence triggered by `r11:power_up` (and instant restore via `r11_powered` flag in `action_restore.json`) that fires heavy relay/breaker clunks, starts the generator hum loop, transitions `r11:power_state` (`standby -> starting -> online`), cascades Banks 1 -> 2 -> 3 on with staggered ballast strikes (respecting `reducedFlashing`), extinguishes the standby emergency beacons, and refreshes room irradiance.
  - Generate ElevenLabs SFX (`oneshot-breaker-clunk.mp3`, `oneshot-turbine-spinup.mp3`, `emitter-generator-hum.mp3`) via `npm run ambience:generate` and register them in `SAMPLE_URLS` in `src/audio/sounds.ts` (following `docs/audio-assets.md` and `audio-assets` spec).
  - Expose direct preview access in `?debug&jump=r11` (and via `r11_power_cascade` sequence / debug trigger) so both dormant standby and energized states can be verified immediately.
- **Out of scope**:
  - Detailing `R13d`, `R15a`, Train Car interior / abyssal ride, and `R16a-c` (Phases 2b, 2c, 2d).
  - Rewriting `action_climax.json` dialogue, removing Giles's infection arc, Heins radio VO, or adding the finale creature (Phase 3).

## Capabilities

### New Capabilities
<!-- None; this change extends existing transit-wing and render-lighting capabilities. -->

### Modified Capabilities
- `transit-wing`: Detail `R11` Power Bay with hero turbine-generators, high-voltage switchgear, Giles's transit power-up terminal, vertical/surface dressing, and the staged cascading lights-on & machinery spin-up sequence with checkpoint restore and debug inspection.
- `render-lighting`: Allow a single scripted named light (`light` action / `Level.setLight`) to carry an optional auxiliary circuit `power` scale so individual lights can energize under station `backup` power without switching the whole station back to `mains`.

## Impact

- **Kit & Level Data**: `src/world/kit/transit.ts`, `src/world/kit/transit.test.ts`, `scripts/gen-slice01.mjs`, `src/data/levels/slice01.json`, `src/world/slice01.test.ts`.
- **Lighting & Script Engine**: `src/world/level.ts`, `src/world/stationPower.test.ts`, `src/script/host.ts`, `src/script/actions.ts`, `src/script/gameHost.ts`, `src/script/action.test.ts`.
- **Sequences & Audio**: `src/data/sequences/action_climax.json`, `src/data/sequences/action_restore.json`, `scripts/ambience-generate.ts`, `public/assets/audio/ambience/`, `src/audio/sounds.ts`.
- **Execution Workflow**: Built and visually verified via the `threejs-game-director` skill (`threejs-aaa-graphics-builder` for material/lighting/surface dressing craft and `threejs-qa-release` for browser visual checks, checkerboard pass, and `?nopost` / standby vs. powered captures).

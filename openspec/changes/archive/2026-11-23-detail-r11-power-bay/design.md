# Design

## Context

See [proposal.md](proposal.md) for motivation and Phase 2a scope.

Phase 1 (`finale-transit-rooms-geometry`) rebuilt `R11` as a `12 m x 12 m x 5.0 m` Power Bay (`X=8..10, Z=9..11`, world `x ∈ [30, 42]`, `z ∈ [34, 46]`, `area: 'transit'`) with:
- South entry `D_R10_R11` at `(x = 32, z = 46)` and north exit `D_R13d_R11` at `(x = 36, z = 34)`.
- A placeholder generic `console` at `[31.2, 0, 38]` (west wall), two wall-mounted `emergency_beacon` props, a legacy `fluid_trail` (still asserted by `slice01.test.ts` until Phase 3 removes Giles's infection arc), and Phase 3 placeholder anchors (`giles_final`, `final_console`, `r11_hold`, `r11_giles_task`, `r11_okafor_end`, `r11_okafor_step`, `r11_jay_end`, `ammo_r11*`).
- Five overhead ceiling light slots (`0, 2, 4, 6, 8`), three of which currently carry `backup: true, backupScale: 0.75..0.85` so the bay starts bright even under `station_power: 'backup'`.

In `src/world/level.ts`:
- `setPower('backup')` sets `s.item.power = 0` on every non-backup light slot.
- `setLight(id, pattern, tint)` mutates a single named light's pattern and color without touching `s.item.power`, so today a sequence cannot turn on a non-backup ceiling bank in `R11` while the rest of the station remains under `backup` power.

## Goals / Non-Goals

**Goals:**
- Transform `R11` from an empty greybox shell into a high-craft deep-sea industrial Power Bay with strong silhouette readability across its full `5.0 m` vertical volume, respecting `docs/surface-dressing-standard.md` and `docs/modular-grid-standard.md`.
- Keep draw calls, triangles, and shadow-light slots tight by merging flat paints (`userData.flat`) and static glows (`userData.glow`), reusing existing imported industrial GLBs (`electrical_box_02`, `electrical_box`, `power_box`, `cable_drum`, `gas_cylinder`, `platform_trolley`), and spending at most 2 shadow-casting lights in `R11`.
- Deliver a reusable, deterministic, accessibility-safe (`reducedFlashing`) cascading lights-on & machinery spin-up sequence (`r11_power_cascade`) that wakes `R11` from `backup` power without disturbing the rest of the station's blackout state, and survives checkpoints / `level:reset`.
- Keep every Phase 1 walkability, anchor, and `slice01.test.ts` invariant green (including preserving `fluid_trail` and Phase 3 placeholder anchors until Phase 3).

**Non-Goals:**
- Importing new external third-party GLB models (we pair bespoke procedural hero kit pieces with the existing CC0 imported industrial props already in `src/data/imported-props.json`).
- Rewriting `climax` / `cliffhanger` dialogue or removing Giles's infection beat (Phase 3).
- Detailing `R13d`, `R15a`, Train Car, or `R16a-c` (Phases 2b, 2c, 2d).

## Decisions

### D1: Spatial Layout of `R11` Power Bay (Zones & Sightlines)

World bounds of `R11` inner room: `x ∈ [30.25, 41.75]`, `z ∈ [34.25, 45.75]`, `y ∈ [0, 5.0]`.

```text
          North wall (z = 34.25)   [D_R13d_R11 x=35..37]
        +--------------------------------------------------+
  x=30.25| [elec_box/     |            |  [switchgear_bank  | x=41.75
         |  conduit]      |   NORTH    |   + power_box]     |
         |                |   EXIT     |                    |
         | [power_        |            |  +--------------+  |
  z=38   |  terminal]     |  CENTRAL   |  | GENERATOR #1 |  |
         |  (Giles task)  |   AISLE    |  | (turbine +   |  |
         |                |  (clear    |  |  overhead    |  |
  z=40   | [cable_tray /  |  >= 2.2 m) |  |  busbars)    |  |
         |  pipe risers]  |            |  +--------------+  |
         |                |            |  +--------------+  |
  z=42.5 | [cable_drum +  |            |  | GENERATOR #2 |  |
         |  trolley]      |            |  | (parallel)   |  |
         |                |  [SOUTH    |  +--------------+  |
  z=45.75|  [D_R10_R11    |   ENTRY]   |  [elec_box_02 +    |
         |   x=31..33]    |            |   cylinders]       |
        +--------------------------------------------------+
```

- **West Wall (`x = 30.25..31.8`)**:
  - `power_terminal` at `[31.1, 0, 38.0]` (`rot: 270`, facing `+X` into the room — matches existing `final_console` at `[31.2, 1.2, 38]` and `r11_giles_task` at `[32.4, 0, 38]`).
  - Flanked north (`z ≈ 35.5`) and south (`z ≈ 40.5`) by wall-mounted `electrical_box`, `power_box`, vertical conduit drops, and `sign_danger` / `tag_stencil` (`POWER BAY 11`).
  - Floor conduit bridge/grating strip connecting the terminal base toward the east generators (flush/walkable `<= 0.04 m` tall so zero collider snag).
- **East Machinery Bay (`x = 37.6..41.5`)**:
  - Two parallel `power_generator` hero skids oriented east-west or north-south — orienting both along **X** (width along X ≈ `3.2 m` at `x = 39.5`, depth along Z ≈ `1.8 m` at `z = 38.0` and `z = 41.8`, separated by a `2.0 m` inspection gap, with western nose ending at `x = 37.9`) gives:
    - Immediate dramatic silhouette when stepping through `D_R10_R11` at `(32, 46)` looking north-east!
    - Clear `>= 2.2 m` central aisle (`x = 32.4..37.6`) all the way from `D_R10_R11` to `D_R13d_R11` and around `r11_hold` `(36, 40)`, `r11_okafor_end` `(35.4, 40.4)`, `r11_jay_end` `(35.8, 38.3)`!
    - Clean clearance for `ammo_r11_b` and `ammo_r11_c` (keep or nudge within their corners if needed so no collider overlaps them).
  - `switchgear_bank` flush along the north-east wall (`z = 34.7, x = 39.4`, facing south into the bay) plus `electrical_box_02` along the south-east wall (`z = 45.0, x = 39.6`, facing north) and a maintenance cluster (`platform_trolley`, `cable_drum`, `gas_cylinder` pair) tucked into the south-east/south-west corners clear of `D_R10_R11`.
- **Upper `5.0 m` Volume (`y = 3.2..5.0`)**:
  - Heavy `rib_frame` or overhead busbar gantry beams spanning `R11` at `y = 4.2..5.0`, plus overhead `cable_tray` and `pipe_run` (`hung: true`, `ceiling: 5.0`) connecting the east generator risers across to the west switchgear/terminal wall so looking up reads as a true two-story industrial power plant rather than bare walls.
- **Surface Dressing**:
  - Keep `R11` decals inside `docs/surface-dressing-standard.md` §4 budgets: 4–6 rule-placed oil/grime decals under the generators, switchgear, and vents; 2–3 stencils (`POWER BAY 11`, `TRANSIT SUB-GRID ->` beside `D_R13d_R11`, `HIGH VOLTAGE` beside switchgear).
  - Avoid climbable tops (`0.35–1.00 m`) in open floor space where unnecessary; hero skids and switchgear exceed `1.8 m` tall (`> 1.00 m`).

### D2: Three New Bespoke Hero Pieces in `src/world/kit/transit.ts`

Extend `src/world/kit/transit.ts` (keeping all transit-wing pieces co-located) with three event-driven procedural pieces that subscribe to `r11:power_state` (`{ state: 'standby' | 'starting' | 'online', instant?: boolean }`) and `level:reset`:

1. **`power_generator`**:
   - Heavy industrial plinth (`0.22 m` steel/concrete base with yellow/black hazard trim band) + cylindrical horizontally-mounted generator drum (`lathe` / ribbed stator casing + cooling fins + end bell + top exhaust/coolant riser pipes ascending to `y ≈ 4.6 m` to meet the ceiling busbar).
   - **Animated rotor/flywheel**: exposed caged turbine shaft / cooling fan assembly on the front end bell (dynamic `THREE.Group`) that accelerates smoothly from `0 rad/s` (`standby`) -> ramp (`starting`) -> steady high-RPM hum (`online`), with `instant: true` snapping directly to operating speed.
   - **Dynamic status strip**: single shared per-piece `fixtureMaterial` LED bar + gauge bezel shifting from dim amber (`0xff8c1a`, intensity `0.8`) in `standby` -> pulsing amber/cyan in `starting` -> crisp online emerald-cyan (`0x38e8b8`, intensity `2.2`) in `online`.
   - Solid box collider covering the plinth and stator envelope (`metal` surface).

2. **`switchgear_bank`**:
   - Multi-bay high-voltage steel cabinet (`2.8 m` wide × `0.85 m` deep × `2.35 m` tall) with recessed breaker compartments, heavy busbar conduit risers up to `y ≈ 4.6 m`, angled analog voltmeter faces (flat-painted dials + needles), and heavy throw-lever handles.
   - Dynamic breaker indicator strip (`fixtureMaterial`) stepping from standby red/amber -> synchronized green/cyan on `r11:power_state`.
   - Solid box collider (`metal` surface).

3. **`power_terminal`**:
   - Replaces the generic `console` at `[31.1, 0, 38.0]` (`rot: 270`, facing `+X`). Same interaction envelope around `r11_giles_task` (`[32.4, 0, 38]`) so Giles's `power_restore` typing pose and `final_console` look-at anchor align accurately.
   - Heavy angled transit-grid control desk with side protective wings, hooded upper monitor bay housing a `512 x 288` `CanvasScreen` (`TRANSIT SUB-GRID // POWER BAY 11`, live RPM & kW bar graphs, `BANK 1/2/3` circuit readouts, `R15a RAIL BUS` status), tactile breaker levers, and low amber/cyan indicator strip.
   - Subscribes to `r11:power_state` (and `level:reset`) to drive live screen state (`OFFLINE / STANDBY` -> `SPINNING UP TURBINES...` -> `SUB-GRID ONLINE // RAIL BUS READY`).

**Draw-call discipline**: Static body parts use palette materials (`resolvePalette`) plus `userData.flat` paints (merging into shared room flat buckets) and `userData.glow` for non-animated trims. Only the rotating rotor group, animated status emissive strip, and `power_terminal`'s `CanvasScreen` stay dynamic.

### D3: Auxiliary Circuit `power` Override on Named Lights (`render-lighting`)

**Decision**: Extend `Level.setLight(id, pattern, tint?, power?)` and the `light` sequence action (`{ id, pattern, tint?, power? }`, `power: optional(numRange(0, 1))`) so a scripted step can explicitly energize a named light even when `station_power === 'backup'`.

- **How it works in `src/world/level.ts`**:
  - Store `overridePower?: number` on the room slot (or track in a `Map<PooledSlot, number>` cleared on `setPower('mains')` and `reset()`).
  - When `setLight(id, pattern, tint, power)` receives `power !== undefined`:
    - Set `s.item.power = power`.
    - Restore the light's authored color/emissive/range from `backupSaved` (if `power > 0` and `tint === undefined` and the light was previously dimmed/tinted by backup mode), so an energized `R11` bank shines at its true authored industrial white color and full range!
    - Call `bumpLighting(room.data.id)` whenever effective brightness changes (off -> on or on -> off).
  - When `power` is omitted (`undefined`), `setLight` behaves identically to before (zero regression for existing tests/sequences).
  - On `setPower('mains')` or `reset()`, all per-light power overrides are cleared and normal `station_power` rules resume.

**Alternatives considered**:
- *Calling `power: { state: 'mains' }` for R11*: Rejected because it would simultaneously light up the entire station (breaking the dark blackout atmosphere everywhere else) and snap all R11 lights on in one frame instead of cascading bank-by-bank.
- *Marking all R11 lights `backup: true, backupScale: 0`*: Rejected because `backupScale: 0` lights would still be counted as backup lights and wouldn't let `lightState` distinguish standby vs. energized cleanly.

### D4: `R11` Lighting Banks & Cascading Lights-On Sequence

Author `R11`'s 9 ceiling cells (`0..8`, arranged as 3 columns × 3 rows across `X=8, 9, 10` and `Z=9, 10, 11`) with 6 named industrial high-bay ceiling lights organized into **3 spatial banks** (west -> center -> east) plus 2 standby `emergency_beacon` slots:

- **Standby under `backup` power** (on arrival from R10):
  - `r11_beacon_ne` and `r11_beacon_sw`: `emergency` slots (`pattern: 'off'` on mains, auto-lit warm/red standby under `backup` power — satisfies `station-power` and `slice01.test.ts` line 1107).
  - `r11_terminal_task` (optional low-intensity local light or `r11_bank_1a` dim backup? Better: keep all 6 overhead bank lights strictly non-backup so all 6 ceiling bays start **completely dark** under `backup` power, while the two `emergency_beacon` slots + the glowing `power_terminal` screen illuminate the west wall and room silhouette!). Let's check brightness visually during implementation; if Giles's terminal needs a crisp local pool in standby, we can include a small dedicated `backup: true, backupScale: 0.25, ownColor: true` wall/task slot right above `power_terminal` (`r11_desk_lamp`) while keeping all 6 overhead high-bay banks 100% dark until the cascade!
- **Three overhead cascade banks** (all non-backup, `color: '#dce8f4'`, `intensity: 14–16`, `range: 18`):
  - **Bank 1 (West / Terminal row, `X=8`)**: `r11_bank_1a` (slot 0, `Z=9`), `r11_bank_1b` (slot 6, `Z=11`).
  - **Bank 2 (Center Aisle row, `X=9`)**: `r11_bank_2a` (slot 1, `Z=9`, `shadow: true`), `r11_bank_2b` (slot 7, `Z=11`).
  - **Bank 3 (East / Generator row, `X=10`)**: `r11_bank_3a` (slot 2, `Z=9`), `r11_bank_3b` (slot 5 or 8, `Z=10/11`, `shadow: true`).
  - Total shadow-casting lights in `R11`: **2** (within `docs/surface-dressing-standard.md` §8's 2–3 limit so Medium tier renders both without hand-over thrash).
- **Sequence `r11_power_cascade` (in `src/data/sequences/action_climax.json`)**:
  - Triggered by event `r11:power_up` (also callable directly from `?debug` sequence runner or a debug preview trigger).
  - Timeline (~2.8 s total):
    1. `t = 0.0 s`: `setFlag r11_powered = true`, `emit r11:power_state { state: 'starting' }`, `sfx breakerClunk` at `anchor:final_console`, `sfx turbineSpinUp` at `anchor:r11_hold`, `emit r11:hum_on` (enables positioned `ambient_loop` `generatorHum` at east generators).
    2. `t = 0.5 s`: **Bank 1** (`r11_bank_1a`, `r11_bank_1b`) -> `light` with `pattern: 'flicker', power: 1`, `sfx breakerClunk` (softer relay strike); after `0.35 s` -> `pattern: 'steady', power: 1`. (Note: under `reducedFlashing`, `patternValue('flicker', ..., true)` already caps changes to `<= 3/s` with gentle `0.7..1.0` range — safe by construction in `src/render/lights.ts`!)
    3. `t = 1.15 s`: **Bank 2** (`r11_bank_2a`, `r11_bank_2b`) -> `flicker, power: 1` + relay strike SFX; after `0.35 s` -> `steady, power: 1`.
    4. `t = 1.85 s`: **Bank 3** (`r11_bank_3a`, `r11_bank_3b`) -> `flicker, power: 1` + heavy relay strike SFX + subtle `cameraShake (0.08, 0.4)`; after `0.4 s` -> `steady, power: 1`.
    5. `t = 2.3 s`: `emit r11:power_state { state: 'online' }`, extinguish standby beacons (`r11_beacon_ne`, `r11_beacon_sw` -> `pattern: 'off', power: 0`), `sfx fluorescentBuzz` subtle settle.
  - **Restore on checkpoint load (`action_restore.json`)**: If flag `r11_powered` is true (or `climax_done` is true until Phase 3 replaces it), immediately apply all 6 bank lights `steady, power: 1`, beacons `off, power: 0`, and emit `r11:power_state { state: 'online', instant: true }` + `r11:hum_on`.
  - **Wiring into current `action_climax.json`**: Keep `climax` / `cliffhanger` compatible with existing tests (`action.test.ts`, `gather.test.ts`) while emitting `r11:power_up` when power comes online in `R11`, so Phase 2a's cascade is live end-to-end today and Phase 3 can simply emit `r11:power_up` from its rewritten Power Bay scene.
  - **Debug preview (`?debug&jump=r11`)**: Ensure `jump=r11` sets `station_power: 'backup'` (matching post-blackout arrival!) so inspecting R11 immediately shows the atmospheric dormant bay, AND allow triggering `r11_power_cascade` cleanly from the debug UI / console (`window.__debug` or sequence menu, or optional `?debug&jump=r11&power=on`) for rapid visual A/B verification of standby vs. powered states.

### D5: ElevenLabs Power Bay Audio (`scripts/ambience-generate.ts`, `src/audio/sounds.ts`)

Per `docs/audio-assets.md`, add three ElevenLabs sound assets to `AMBIENCE_MANIFEST` in `scripts/ambience-generate.ts`, generate them into `public/assets/audio/ambience/` with `npm run ambience:generate`, and register them in `SAMPLE_URLS` in `src/audio/sounds.ts`:
- `breakerClunk` (`oneshot-breaker-clunk.mp3`): heavy industrial high-voltage switchgear breaker throw clunk + spring latch snap (~1.0 s one-shot).
- `turbineSpinUp` (`oneshot-turbine-spinup.mp3`): deep-sea industrial turbine-generator spin-up whine and low mechanical rumble rising to operating speed (~3.0 s one-shot).
- `generatorHum` (`emitter-generator-hum.mp3`): seamless steady deep-sea power-plant turbine-generator hum loop (`loop: true`, `emitter` category, used by `ambient_loop` at the east generators).

### D6: Execution via `threejs-game-director`

During `openspec-apply-change`, follow `threejs-game-director`:
- Load `threejs-aaa-graphics-builder` references for material roughness/metalness contrast, industrial silhouette layering, lighting hierarchy, and the 10-category visual scorecard.
- Load `threejs-qa-release` for browser visual verification (`?debug&jump=r11` in both standby and post-cascade online states, `?checker` UV pass, `?nopost` pass, and `?debug` lighting overlay check).

## Risks / Trade-offs

- **[Backup-power brightness in dormant R11 too dark without flashlight]** → Mitigation: Keep both `emergency_beacon` slots lit plus a subtle localized task light (`backupScale: 0.25`) over `power_terminal` so Giles's console and the generator silhouettes read immediately on entry, verified in browser screenshots before finalizing.
- **[`setLight(..., power)` colliding with `setPower('backup')` / `setPower('mains')` order]** → Mitigation: Track explicit per-light overrides separately in `Level`, restore authored `color`/`emissives`/`range` from `backupSaved` when energizing above 0 under backup power, clear overrides on `setPower('mains')` and `reset()`, and cover all ordering permutations in `stationPower.test.ts`.
- **[Prop collision or climbable-top regressions in `R11`]** → Mitigation: Keep all machinery outside the `x ∈ [32.0, 37.6]` central corridor, keep hero units taller than `1.00 m`, and verify with headless nav/walk tests (`slice01.test.ts`) and `slice01JumpTops.test.ts`.
- **[Draw call / texture memory bloat in `R11`]** → Mitigation: Share palette + `userData.flat` materials across procedural hero pieces, reuse already-imported industrial GLBs (`electrical_box_02`, `electrical_box`, `power_box`, `cable_drum`, `gas_cylinder`, `platform_trolley`), keep decals within §4 budget, and verify `R11` room stats in `slice01.test.ts`.
- **[`action_climax.json` / `action.test.ts` regressions before Phase 3]** → Mitigation: Keep `fluid_trail`, all existing `R11` anchors, and existing `climax` / `cliffhanger` flags intact; run `action.test.ts`, `gather.test.ts`, `stationPower.test.ts`, `transit.test.ts`, and `slice01.test.ts` to verify zero breakage.

# Design

## Context

See `proposal.md` (Why) for motivation. Current technical state in the codebase:
- `src/world/kit/palettes.ts` defines clean, rust-free palettes for all rebuilt areas (`dock`, `commons`, `gallery`, `labs`, `hydroponics`, `dive_bay`, `admin`), while `security` and `medbay` remain legacy one-liners (`security: { wallMain: 'paintDark', floor: 'rubber', hazard: 'hazardClean' }` and `medbay: { wallMain: 'paintBone', floor: 'labTile', hazard: 'hazardClean' }`).
- Any omitted palette field (`wallAlt`, `ceiling`, `doorSurround`, `doorPanel`, `doorGlassBar`, `pipeAccent`, `pipeMain`) defaults in `resolvePalette()` to worn slots (`paintDark`, `paintBone`, `paintTeal`) or legacy `steel`. In `wall_tiles` (`src/world/kit/slice.ts`), the wall above 2.4 m explicitly checks `paletteFor(area).wallAlt` and falls back to `m.paintDark`, which puts a rusty dark band over the white tiles in `R08` and `R08b`.
- Existing props `locker`, `desk`, `console`, `lab_bench`, and `storage_shelf` already check `const clean = pal.doorPanel !== m.paintDark` to switch from `paintBone`/`paintDark`/`paintTeal` to `cleanWall`/`steelDark`/`cleanTeal`. Three props used in `R07`/`R07a`/`R08`/`R08b` do not yet have that check: `med_bed` (`src/world/kit/props.ts`), `console_bank` (`src/world/kit/slice.ts`), and `armory_rack` (`src/world/kit/slice.ts`).
- The shared fill-light pool (`render-lighting` spec, `src/world/lightSlots.test.ts`) holds 8 simultaneous lights across the current room and visible neighbours.
- `overhaul-priya-r08-death` is in flight and enforces strict geometry and sightline invariants in `src/world/slice01.test.ts` (prop-inside-walls, 1.2 m door clearances, R07 spine `x: -1.5..1.5` and viewing strip `z: 44.6..45.75`, R08 2.5 m stage in front of centre pane, R08 east lane `x: 2.5..5.75`, R07a east rack facing `D_R07_R07a`, and `wallClearance.test.ts` trim keepouts).

## Goals / Non-Goals

**Goals:**
- Bring `R07`, `R07a`, `R08`, and `R08b` to the exact same clean texture and lighting standard as `R01–R06` and `R12–R14` using existing rust-free photo slots in `src/render/tex/manifest.ts`.
- Make `R08`/`R08b` read immediately as a clean, clinical medical wing and `R07a` read as a bright, well-lit armory with lighter walls and clear weapon presentation.
- Stay strictly within the 8-light shared pool and zero regressions against `slice01.test.ts`, `wallClearance.test.ts`, `slice01JumpTops.test.ts`, and `overhaul-priya-r08-death`.

**Non-Goals:**
- No new downloaded photo texture sets (all needed clean slots — `cleanWall`, `cleanSlate`, `cleanTeal`, `tileWall`, `labTile`, `officeCeiling`, `steelBrushed`, `steelDark`, `rubber` — already exist in `manifest.ts`).
- No layout changes to `R07`/`R08` anchors, sequences (`action_security.json`), or Priya's death choreography.
- No changes to `R09`, `R10`, or `R11` (deferred to a follow-up change).

## Decisions

### 1. Palette definitions for `security` and `medbay`
Update `AREA_PALETTES` in `src/world/kit/palettes.ts`:
- `security`:
  - `wallMain: 'cleanSlate'`, `wallAlt: 'cleanWall'`, `ceiling: 'officeCeiling'`, `trim: 'steelBrushed'`, `floor: 'rubber'`, `floorAlt: 'steelBrushed'`, `hazard: 'hazardClean'`, `doorSurround: 'cleanSlate'`, `doorPanel: 'steelDark'`, `doorGlassBar: 'steelBrushed'`, `pipeAccent: 'cleanTeal'`, `pipeMain: 'steelDark'`.
  - Rationale: Matches the clean institutional language of `R03` Observation Gallery while keeping `R07` slightly cooler and darker than `R08` so the medical bay reads clearly as a bright stage through the glass.
- `medbay`:
  - `wallMain: 'cleanWall'`, `wallAlt: 'cleanTeal'`, `ceiling: 'officeCeiling'`, `trim: 'steelBrushed'`, `floor: 'labTile'`, `floorAlt: 'steelBrushed'`, `hazard: 'hazardClean'`, `doorSurround: 'cleanWall'`, `doorPanel: 'steelDark'`, `doorGlassBar: 'steelBrushed'`, `pipeAccent: 'cleanTeal'`, `pipeMain: 'steelDark'`.
  - Rationale: `wall_tiles` renders clean white `tileWall` from `0..2.4 m` and automatically reads `medbay.wallAlt` (`cleanTeal`) from `2.4 m..ceiling`, visually distinguishing the hospital/clinical ward from Lab B's white+slate (`cleanWall`/`cleanSlate`) while staying completely sterile and rust-free.
- *Alternative considered:* Pure white `wallAlt: 'cleanWall'` in `medbay`. Rejected in favor of clinical `cleanTeal` because `tileWall` + `cleanTeal` reads unmistakably as medical rather than another lab corridor, and keeps clear visual separation from `R07`'s `cleanSlate` and `R07a`'s `cleanWall`.

### 2. Lighter walls for `R07a` Armory via per-room piece override
Keep `R07a` in `area: 'security'` (so map area grouping, tests checking `areas`, and `slice01.test.ts` remain untouched), and apply `{ material: 'cleanWall' }` to `R07a`'s wall pieces in `scripts/gen-slice01.mjs` (the exact pattern already used by `R12d` Nutrient Room with `tileWall`).
- *Alternative considered:* Adding a new `'armory'` area palette. Rejected because `slice01.test.ts` checks the 11 station map areas and map stations reveal rooms by `area`. A piece-level `cleanWall` override achieves lighter walls with zero map-area churn.

### 3. Clean-palette opt-in on `med_bed`, `console_bank`, and `armory_rack`
Adopt the existing `const clean = pal.doorPanel !== m.paintDark` pattern (`resolvePalette(p, m)`) inside:
- `med_bed` (`src/world/kit/props.ts`): use `clean ? m.cleanWall : m.paintBone` for the bed pedestal and `clean ? pal.doorPanel : m.paintDark` for the vitals monitor casing.
- `console_bank` (`src/world/kit/slice.ts`): use `clean ? pal.doorPanel : m.paintDark` for the console base and monitor housing, and `clean ? m.steelBrushed : m.steel` for the trim top.
- `armory_rack` (`src/world/kit/slice.ts`): use `clean ? pal.doorPanel : m.paintDark` for weapon stocks/mounts, `clean ? m.cleanTeal : m.paintTeal` for the bottom ammo cases, and add a subtle static emissive top strip (`glow('rack-strip', 0xeaf4ff, 1.4)`) under the rack header when clean so the weapons bay catches the eye cleanly at zero extra draw calls (merges into the room's static glow bucket).
- *Alternative considered:* Unconditionally replacing `paintDark`/`paintBone` in those props. Rejected so any dark/worn room (e.g., `R11` Control Room before its overhaul, or test rooms) keeps backwards-compatible behavior until its area palette is upgraded.

### 4. Shared 8-light pool budget and armory lighting
Allocate pooled lights across `R07`, `R07a`, and `R08` to total exactly 8:
- `R07` (6 ceiling slots `0..5`): keep 3 pooled (`0, 2, 4` at cool neutral `#e6f0ff`, intensity `8 / 8 / 6.5`), and claim the other 3 (`1, 3, 5`) with `pool: false` glow-only so zero dark diffusers appear on the ceiling.
- `R08` (6 ceiling slots `0..5`): keep the `overhaul-priya-r08-death` 3-pooled hierarchy on the front row (`0` low fill over beds `#eef8ff` int `6`, `1` steady key over cart `#f2faff` int `11`, `2` flicker over east door/lane `#eef8ff` int `7.5`), and claim the back row (`3, 4, 5`) with `pool: false` glow-only (or dim emissive) so the ceiling looks consistently lit without washing out the cart key-light focus.
- `R07a` (1 ceiling cell + 1 rack light = 2 pooled):
  - Ceiling slot `0`: crisp neutral-white work light (`#f4f8ff`, intensity `12`, range `10`) replacing the dim amber `7`.
  - Rack light: place a single-bulb `pendant_light` with `{ ceiling: 4, drop: 1.15, count: 1, slots: true }` centred in front of the east shotgun rack (around `[8.85, 0, 40.0]`, high enough at `y = 2.85 m` to clear player headroom and door swing) and claim its `pendant` slot (`slot: 1`, `#fff4e0`, intensity `9`, range `7`).
- `R08b` Surgery (1 ceiling cell): keep slot `0` as clinical white (`#eef8ff`, `dying`, intensity `7.5`).
- Fog densities: `R07` -> `0.022` (`#090d11`), `R07a` -> `0.018` (`#0c1014`), `R08` -> `0.018` (`#081012`), `R08b` -> `0.022` (`#081012`).

### 5. Purposeful room additions within clearance bounds
Reuse existing kit props (zero new GLB assets, minimal draw-call cost):
- **`R07` Security Office:**
  - `notice_board` on the west wall north of the desk (`cell (-1, 10)`, `'w'`, `text: 'SECURITY WATCH'`, `detail: 'LOCKDOWN PROTOCOL'`), verified clear of pilasters/trim by `wallClearance.test.ts`.
  - `wall_clock` high on the north wall (`cell (0, 10)`, `'n'`, `y: 3.05`), clear of the bulkhead lintel and ceiling rail.
  - Desktop dressing (`mug`, `desk_wand`) resting on the watch console (`[-3.6, 0.9, 38.7]`) and west desk (`[-5.3, 0.78, 42.6]`). No added floor colliders; spine (`x: -1.5..1.5`) and viewing strip (`z: 44.6..45.75`) untouched.
- **`R08` Medical Bay:**
  - `bio_wash_station` (stainless scrub sink with soap/towels) on the south wall between the lab bench and gurney or west of the bench — check exact `x` clearance so it stays flush on the south wall (`z ~ 53.52`), >= 2.5 m from the centre pane (`z = 46.0` -> `7.5 m` away), and well west of the east creature lane (`x < 2.0`).
  - `lab_cabinet` (imported glass-door cabinet, already loaded in `R04`) on the south wall replacing or pairing neatly beside `storage_shelf` (e.g., `storage_shelf` shifted slightly or replaced by `lab_cabinet` at `[-4.7, 0, 53.48]` to avoid crowding and stay clear of `med_bed` at `[-4.7, 0, 51.6]`). Check `importedBudget.test.ts` and `slice01JumpTops.test.ts`!
  - `wall_clock` high on the south or west wall (above tile trim at `y: 3.05`), clear of `wallClearance.test.ts`.
- **`R07a` Armory & `R08b` Surgery:**
  - `R07a` gets the dedicated `pendant_light` over the east rack and the clean `armory_rack` header strip.
  - `R08b` keeps its minimal surgical footprint (`med_bed` + `storage_shelf`) with clean surfaces so `stinger_cam` and `r08_lurk` stay unobstructed.

## Risks / Trade-offs

- [Overlap with `overhaul-priya-r08-death`] -> Both changes touch `scripts/gen-slice01.mjs` and `src/data/levels/slice01.json`. Mitigation: do not move or rename any anchor, door, trigger, or existing R07/R08 furniture prop owned by `overhaul-priya-r08-death`; keep all additions strictly in unused wall/south-wall slots and validate with `slice01.test.ts`.
- [`R08` glow-only back-row fixtures could compete visually with the cart key light] -> Mitigation: set low `emissive` (e.g. `1.2–1.5`) and `shaft: 0` on back-row `pool: false` fixtures in `R08` so the ceiling reads clean without pulling the eye off the cart.
- [New south-wall props in `R08` (`bio_wash_station`, `lab_cabinet`) could add a climbable jump-top or exceed `importedBudget.test.ts`] -> Mitigation: `R08` is not a player-walkable combat space (locked behind `D_R07_R08`), and `lab_cabinet` is already imported in `slice01`, so instancing it adds no new GLB asset. Verify both `slice01JumpTops.test.ts` and `importedBudget.test.ts` during apply.
- [Wall-mounted props (`notice_board`, `wall_clock`) could overlap wall pilasters/trim rails] -> Mitigation: run `wallClearance.test.ts` immediately after regenerating `slice01.json`.

## Migration Plan

1. Update `palettes.ts`, `props.ts`, `slice.ts`, and `scripts/gen-slice01.mjs`.
2. Regenerate `src/data/levels/slice01.json` via `node scripts/gen-slice01.mjs`.
3. Update `palettes.test.ts` and add targeted assertions in `slice01.test.ts`, then run `npm run typecheck` and the touched unit tests (`palettes.test.ts`, `wallClearance.test.ts`, `lightSlots.test.ts`, `slice01.test.ts`, `importedBudget.test.ts`, `slice01JumpTops.test.ts`).
4. Visual playtest verification in browser from `R06 -> R07 -> R07a` and looking through the `R07 -> R08` glass (`?slot=scratch`).

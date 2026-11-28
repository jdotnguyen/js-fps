# Tasks

## 1. Clean Area Palettes (`security` and `medbay`)

- [x] 1.1 Update `AREA_PALETTES.security` and `AREA_PALETTES.medbay` in `src/world/kit/palettes.ts` to use clean, rust-free materials (`security`: `cleanSlate` / `cleanWall` / `officeCeiling` / `steelBrushed` / `rubber` / `steelDark`; `medbay`: `cleanWall` / `cleanTeal` / `officeCeiling` / `steelBrushed` / `labTile` / `steelDark`), and update `src/world/kit/palettes.test.ts` to assert zero `WORN_SLOTS` in both `security` and `medbay` (verified by `npm test -- src/world/kit/palettes.test.ts`).

## 2. Clean Prop Materials (`med_bed`, `console_bank`, `armory_rack`)

- [x] 2.1 Update `med_bed` in `src/world/kit/props.ts` to inspect `resolvePalette(p, m)` (`clean = pal.doorPanel !== m.paintDark`) and use `cleanWall` + `pal.doorPanel` instead of hardcoded `paintBone` + `paintDark` in clean areas, adding a unit assertion in `src/world/kit/palettes.test.ts` (verified by `npm test -- src/world/kit/palettes.test.ts`).
- [x] 2.2 Update `console_bank` and `armory_rack` in `src/world/kit/slice.ts` to honor `resolvePalette(p, m)` (`clean = pal.doorPanel !== m.paintDark`) — replacing hardcoded `paintDark` / `paintTeal` with `pal.doorPanel` / `cleanTeal` / `steelBrushed` — and add a clean static emissive top light strip to `armory_rack` when clean, with unit coverage in `src/world/kit/palettes.test.ts` (verified by `npm test -- src/world/kit/palettes.test.ts`).

## 3. Room Overhaul in `gen-slice01.mjs` (`R07`, `R07a`, `R08`, `R08b`)

- [x] 3.1 Give `R07a` (Armory) lighter clean walls (`material: 'cleanWall'` on its wall pieces), lower fog (`0.018`), a brighter overhead ceiling work light (slot `0`, `#f4f8ff`, intensity `12`, range `10`), and a dedicated rack `pendant_light` (`slots: true`, slot `1`) illuminating the east shotgun rack in `scripts/gen-slice01.mjs`, then regenerate `src/data/levels/slice01.json` with `node scripts/gen-slice01.mjs` (verified by inspecting `R07a` in `slice01.json` and running `npm test -- src/world/kit/palettes.test.ts`).
- [x] 3.2 Update fog densities (`<= 0.022`) and ceiling lights in `R07`, `R08`, and `R08b` in `scripts/gen-slice01.mjs` so `R07` (3 pooled + 3 `pool: false` glow-only), `R08` (3 pooled keeping cart key-light focus + 3 low-emissive `pool: false` glow-only), and `R07a` (2 pooled) stay within the 8-light shared pool, then regenerate `slice01.json` (verified by `npm test -- src/world/lightSlots.test.ts` and a pooled-count assertion for `R07`/`R07a`/`R08` in `src/world/slice01.test.ts`).
- [x] 3.3 Add purposeful room dressing in `scripts/gen-slice01.mjs` — `notice_board`, `wall_clock`, and desktop `mug`/`desk_wand` in `R07`; `bio_wash_station`, `lab_cabinet` (south wall), and `wall_clock` in `R08` — regenerate `slice01.json`, and add assertions in `src/world/slice01.test.ts` covering `fogDensity <= 0.025`, `R07a` `cleanWall` walls, and `R07`/`R07a`/`R08` pooled light budget (verified by `npm test -- src/world/slice01.test.ts src/world/wallClearance.test.ts src/world/slice01JumpTops.test.ts src/world/importedBudget.test.ts`).

## 4. Integration & Visual Verification

- [x] 4.1 Run `npm run typecheck` and the affected level/kit test suite (`npm test -- src/world/kit/palettes.test.ts src/world/lightSlots.test.ts src/world/wallClearance.test.ts src/world/slice01JumpTops.test.ts src/world/importedBudget.test.ts src/world/slice01.test.ts`) and verify all checks pass.
- [x] 4.2 Visually inspect `R07` (Security Office), `R07a` (Armory with `D_R07_R07a` open), and `R08`/`R08b` (Medical Bay & Surgery through the glass and via `CAM 04`) in the browser (`?slot=scratch`), verifying clean tile/teal medical surfaces, brighter armory walls and rack lighting, clean prop finishes, and zero clipping or dark fixtures.

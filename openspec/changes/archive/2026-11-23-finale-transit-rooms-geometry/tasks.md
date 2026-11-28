# Tasks

> **Implementation workflow**: Execute this change using the `threejs-game-director` skill (routing kit/level geometry through `threejs-gameplay-systems` + `docs/modular-grid-standard.md`, and browser/visual verification through `threejs-qa-release`).

## 1. Transit Area Palette & Structural Greybox Kit Pieces

- [x] 1.1 Add the `transit` area palette in `src/world/kit/palettes.ts` (clean industrial walls/floors/trim for `R11`, `R13d`, `R15a`, and `R16a`–`R16c`) and verify `npm test -- src/world/kit/palettes.test.ts` passes.
- [x] 1.2 Audit `wallTile` in `src/world/kit/structure.ts` at `height: 8.0` (backing, trim rails, UV tiling, and colliders) and fix any scaling/gap issue; verify with `npm run typecheck` and a unit check or headless build test.
- [x] 1.3 Create `src/world/kit/transit.ts` implementing the greybox structural pieces (`transit_train_shell`, `concourse_pillar`, `checkin_booth`, `track_bed`, `seam_header`) with real colliders, floor surface tags, and nav nodes, register them in `src/world/registry.ts`, and add `src/world/kit/transit.test.ts` verifying bounding boxes, colliders, interior walkability, and zero missing materials (`npm test -- src/world/kit/transit.test.ts`).

## 2. Overhaul `R11` Power Bay & Detach/Clear `R13d` Maintenance Corridor

- [x] 2.1 Update `R11` in `scripts/gen-slice01.mjs`: rename to "Power Bay", set `area: 'transit'` and `height: 5.0`, strip old control-room console banks/chairs and all `r11_climax` spawns, keep existing doors (`D_R10_R11`, `D_R13d_R11`) and required anchors (`final_console`, `r11_giles_task`, `r11_hold`, etc.) plus clean greybox lighting; regenerate `src/data/levels/slice01.json` with `node scripts/gen-slice01.mjs`.
- [x] 2.2 Update `R13b` and `R13d` in `scripts/gen-slice01.mjs`: remove `D_R13b_R13d` so Launch Hall's east wall is solid, set `R13d` to `area: 'transit'` (keeping its `rustBlotch`/`diamondRusty` overrides for now), remove the blocking south-wall `pipe_run`, `pipe_labels`, `pipe_leak`, `trig_dive_leak`, and `dive_leak` anchor, and add bulkhead door `D_R13d_R15a` on cell `(10, 8, 'e')`; regenerate `src/data/levels/slice01.json`.
- [x] 2.3 Clean up sequence references to the removed door, leak, and combat spawns in `src/data/sequences/action_climax.json`, `src/data/sequences/action_restore.json`, `src/data/sequences/rounds.json`, and `src/data/sequences/quiet_restore.json`, and update `src/script/gather.test.ts`, `src/script/action.test.ts`, and `src/script/quiet.test.ts` so all three test files pass (`npm test -- src/script/gather.test.ts src/script/action.test.ts src/script/quiet.test.ts`).

## 3. Departure Boarding Bay (`R15a`) & Isolated Arrival Terminal (`R16a`/`R16b`/`R16c`)

- [x] 3.1 Author `R15a` ("Departure Boarding Bay") in `scripts/gen-slice01.mjs` east of `R13d` (`X=11..13, Z=8..11`, `12 m x 16 m`, `height: 5.0`, `area: 'transit'`): west boarding platform receiving `D_R13d_R15a`, center North-South `track_bed` and walkable `transit_train_shell` (west doorway + side windows), east `wall_window` tiles looking into the ocean abyss, greybox lighting, and anchors (`r15a_platform`, `r15a_train_inside`); regenerate `src/data/levels/slice01.json`.
- [x] 3.2 Author `R16a` ("Arrival Track Dock", `X=21..23, Z=8..10`, `12 m x 12 m`, `height: 5.0`, `floorY: -0.6`) and `R16b` ("Arrival Concourse", `X=20..24, Z=11..16`, `20 m x 24 m`, `height: 8.0`, deck `y = 0`) plus `R16c` ("Arrival Dispatch", `X=21..23, Z=17`, `height: 3.6`, connected by `D_R16b_R16c`) in `scripts/gen-slice01.mjs`: open seams across `X=21..23` between `R16a` and `R16b`, `seam_header` closing the `5.0 m`–`8.0 m` vertical step, wide south stairs (`rise: 0.6`) climbing from `R16a` onto `R16b`, matching `transit_train_shell` on `R16a`'s center track leaving `~3.5–4.0 m` clear to the west wall, three symmetrical pairs of `concourse_pillar` flanking the central path, flanking `checkin_booth` rows along both sides south of the pillars, greybox lighting, and anchors (`r16_train_inside`, `r16_train_exit`, `r16_concourse`, `r16_dispatch`); regenerate `src/data/levels/slice01.json`.
- [x] 3.3 Update `src/world/slice01.test.ts` (room list, `transit` area, Dive Bay detachment, no `D_R13b_R13d`, critical-path + transit-wing headless walk through `R11 -> R13d -> R15a -> Train A` and `Train B -> R16a -> stairs -> R16b -> R16c`, plus portal-culling assertion that `R16*` is not drawn from `R11`/`R13d`/`R15a`) and verify `npm test -- src/world/slice01.test.ts src/world/sunkenFloor.test.ts src/world/wallClearance.test.ts src/world/portalCull.test.ts` passes.

## 4. Debug Jump Targets & In-Browser Verification

- [x] 4.1 Add `?debug&jump=r15a` (`anchor:r15a_platform`) and `?debug&jump=r16` (`anchor:r16_train_exit`) to `src/app/session.ts` alongside `r11`, and verify `npm run typecheck` and `npm test -- src/app/shell.test.ts` pass.
- [x] 4.2 Run browser verification via `threejs-qa-release` (reusing a running dev server on `http://localhost:5173/` if available, and closing the session afterward): inspect `?debug&jump=r11`, `?debug&jump=r15a`, and `?debug&jump=r16` to verify room scale, `5.0 m` Power Bay & Departure Bay heights, clean `R13d` doorway and solid Dive Bay wall, train interior boarding, left-turn stair climb from `R16a` into the `8.0 m` `R16b` grand concourse, pillar sightlines, check-in booth bays, zero seam/void leaks, and zero console errors.
- [x] 4.3 Run `npm run typecheck` and `npm run build` to verify clean compilation and production bundling.

## Workflow follow-up

- After implementation and visual sign-off, archive `finale-transit-rooms-geometry` via `openspec-archive-change`.
- Follow up with Phase 2 changes for per-room detailing (`R11` Power Bay, `R13d`/`R15a` rail bay, Train + Abyssal Tunnel Ride FX, `R16b` bloody flickering concourse) and Phase 3 for the no-combat finale narrative, Giles surviving, Heins radio VO, dread music, and the new creature 3D model.

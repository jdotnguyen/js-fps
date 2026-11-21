# Tasks

## 1. Safety and imported-prop follow-ups

- [x] 1.1 Before touching level data, regenerate slice01 into a scratch file and diff it against `src/data/levels/slice01.json`; port any JSON-only edits (other sessions' work) into `scripts/gen-slice01.mjs` first; verify the scratch regeneration is identical to the committed JSON
- [x] 1.2 Set `texturePxPerM: 512` for the props 1 m or larger (`lab_cabinet`, `electrical_box_02`, `platform_trolley`, `cable_drum`, `bloom_growth_*`) and re-run `npm run props`; verify no imported texture exceeds 1024 px, the records and manifest updated together, and `src/world/kit/importedProps.test.ts` passes
- [x] 1.3 Add a `material` param to imported-prop stand-ins: the registry swaps every model material for a `keepUvs` clone of that palette slot (clones share the slot's textures); verify with a registry test that two bloom props use one texture set and keep their source UVs

## 2. Palette, light and fog

- [x] 2.1 Change the `labs` palette to clean materials (`cleanWall` main, `cleanSlate` band, `steelBrushed` trim, `rubber`/`labTile` floors, `hazardClean`) and drop R04–R06 rust overrides; verify `palettes.test.ts` and a new slice01 test that no R04–R06 wall, floor or ceiling uses a rust slot ("No rust materials")
- [x] 2.2 Relight the wing: Lab B neutral white; R05 and R06 red lockdown (pulsing) with one steady white work light over R05's middle and over Giles's panel; fog at most 0.03; verify a slice01 test for the white work light over the panel and the fog limit ("Cover-me under lockdown")

## 3. Kit pieces

- [x] 3.1 Add `coolant_line` (waypoint route, lagged pipe with bands, brackets every 1.5 m, `valve` and `sightGlass` markers, wall collars at given crossings); verify with a kit test that its length and bracket count follow the waypoints and the collars sit on the crossing planes
- [x] 3.2 Add Lab B pieces: `culture_column` (amber-lit vessel with bloom inside, coolant jacket), `biosafety_cabinet`, `freezer_ultra` (frost), `incubator_stack`, `pressure_gauge` (wall, reads red), `service_panel` (warped, wall-mounted); verify kit tests for colliders and wall keep-outs, and that wall-mounted pieces are in `WALL_MOUNTED_PROPS`
- [x] 3.3 Add R05 pieces: `emergency_shower` (with eyewash), `ppe_locker`, `hazmat_rack`, `directory_sign` (wall), `floor_drain`, `sample_cart` (`tipped` param); verify kit tests for colliders, and that the tipped cart's top is below 0.35 m
- [x] 3.4 Add R06 pieces: `bulkhead_wheel`, `pressure_manifold`, `status_board` (listens for the door opening and turns green), `pump_skid` (1.2 m), `cylinder_cage` (1.4 m), `trench_grate`, `ruptured_duct`; verify kit tests for colliders and heights, and that `status_board` switches on its door event
- [x] 3.5 Add bloom placement support: imported bloom props and `bloom_decal` take a `reveal: 'spread'` param and stay hidden until `bloom:spread` (shown again on `level:reset` rules as the drop dictates), and two masses take `breathe: true` (4–6 s, ±2 %, dynamic); verify with a test that hidden pieces add no visible meshes until the event fires

## 4. Rooms and sequences

- [x] 4.1 Lay out R04 Lab B per design D4 (column replaces the specimen tank, equipment against the east and south walls, service panel on the west wall at z 28, quarantine tape and gauge); keep `labb_victim`, Voss's benches and key light; verify a slice01 test that no new prop crosses the line from the glass to `labb_victim` at chest height ("Voss stays visible")
- [x] 4.2 Lay out R05 per design D5 (decon corner, lockers, rack, directory, drain grate, tipped cart, dropped PPE decals, floor arrows); rename the floor spawn to `r05_drain` at the grate and update `contact`; verify `script/action.test.ts` and a slice01 test for the three R05 sources ("Floor spawn has a source")
- [x] 4.3 Lay out R06 per design D6 (bulkhead dressing, panel at the south wall on the line, pump skid, cylinder cage, switchgear, cable drum); move the wall vent and add the duct and trench; replace `r06_cover` spawns with `r06_duct` (1), `r06_trench` (2), `r06_vent_e` (2), `r06_corridor` (1); move `r06_panel` and `r06_hold`; verify slice01 tests for the 1.2 m lane to Giles's spot and for the hold point seeing the three in-room sources ("Every source in view but one")
- [x] 4.4 Route the coolant line through R04, R05 and R06 per D2, and place the bloom along it per D3 (density per room); verify a slice01 test of the bloom counts per room and that every bloom piece lies within 1.5 m of the line ("The bloom follows the line")
- [x] 4.5 Add `emit bloom:spread` at the drop's burst and re-emit it in the action restore when `drop_done` is set; verify script tests "Before the drop" (no spread before the burst) and "After the drop" (spread on load)
- [x] 4.6 Regenerate `slice01.json`; update `slice01JumpTops.test.ts`'s review list for new 0.35–1.0 m tops and `mapModel.test.ts` for moved vents; verify `slice01.test.ts` (including the 60-call budget), `slice01JumpTops.test.ts`, `wallClearance.test.ts`, `spots.test.ts` and `mapModel.test.ts` pass

## 5. Verification

- [x] 5.1 Run the R06 cover group in the enemy simulation (and R05's trickle); verify every enemy reaches a target or is resolved and both groups complete ("The fight still resolves")
- [x] 5.2 In the dev build, take screenshots at eye height from each entry door and from the R06 hold point, with and without post, plus the gallery view of Lab B before the drop and the checkerboard pass (surface-dressing §7); verify they read as described and close the tab afterwards
- [x] 5.3 Measure GPU texture memory with the memory probe at the loaded title and after the wing has been drawn (scratch session, `?jump=r06`), and record both in design.md (runtime-memory); verify the increase is within the D7 estimate or explain it
- [x] 5.4 Update `docs/PLAYTEST.md` for R05 (three sources, drain grate) and R06 (four sources, hold point, status board, Giles on the line); verify the listed URLs and anchors exist
- [x] 5.5 Run `npm run typecheck`, each touched test file, then the full suite once at the default concurrency; verify all pass and record the counts in design.md

## Workflow follow-up

- Justin reviews the screenshots and plays `?jump=r05`, then commits.
- Archive after review. `lab-wing-story-beats` (Voss's log, her badge, the initials on the tag) builds on this.

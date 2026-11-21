# Tasks

## 1. The doorway rule

- [x] 1.1 Add a level test in `src/world/slice01.test.ts`: no R02 anchor that a sequence or level NPC rests at lies within `GIVE_WAY.doorReach` (1.2 m) in front of an R02 door; verify it fails today on `priya_exit` in front of `D_R02_R13a`

## 2. Priya leaves for the medical bay

- [x] 2.1 In `intro_shift_change.json`, replace the closing `npcMoveTo priya -> anchor:priya_exit` with a walk out through `D_R02_R03` (add a walk-out anchor just past the door in `scripts/gen-slice01.mjs` if needed), then, once she is out of the player's view, an instant move to `priya_r08`; regenerate `slice01.json` and verify with a case in `src/script/intro.test.ts` for "She walks out"
- [x] 2.2 Make the skip end state put Priya at `priya_r08` (the "Skip during the hand-off" scenario); verify with the intro skip test
- [x] 2.3 In `quiet_restore.json`, place Priya at `priya_r08` when `priya_met` is set and the R08 scene has not played; verify "Load after the intro" with a restore test
- [x] 2.4 Check that the admin booth's CAM 04 medbay feed (`rounds.json`, `medbay_figure`) does not show Priya at `priya_r08`. If she is in frame, park her at another spot out of the camera's view and out of the player's reach, and use that spot in 2.1-2.3. Verify by checking the camera frustum in a test, or by eye in the browser. (She was in frame: she waits at `priya_offstage` in R08b instead.)
- [x] 2.5 Playtest fix (2026-11-21): she stood at `priya_walkout` in the gallery until Jay looked away. `whenUnseen` now fires the moment she leaves Jay's view, mid-walk: outside a 70 degree view cone (the screen edge is about 56 degrees at the default FOV) or behind a wall. Verify with an `npcs.test.ts` case that she is moved as she crosses the cone's edge, before her walk ends

## 3. Bram stays at his station

- [x] 3.1 In `rounds.json` (`rounds_commons_changes`) and `quiet_restore.json`, move `cook` to `anchor:cook_stand` with his `idle` pose instead of `priya_exit`; verify "Bram at his station" with a sequence test
- [x] 3.3 The squad waits in the gallery, not its doorway: in `commons.json` (`commons_free`), send Giles and Okafor to `brief_giles` / `brief_okafor` at 2.2 m/s as soon as the intro ends ("Briefing's in the gallery in ten"), and at the 45 s call bring Giles back to `dawdle_call` beside the door to call; drop the `gallery_door` waits; verify with the commons free-time test in `quiet.test.ts`
- [x] 3.2 Remove the `priya_exit` anchor from `scripts/gen-slice01.mjs` once nothing references it, and regenerate `slice01.json`; verify by grep that no sequence uses `priya_exit` and that test 1.1 passes

## 4. Integration

- [x] 4.1 Run `npm test -- src/world/slice01.test.ts src/script/intro.test.ts` and `npm run typecheck`; verify both pass
- [ ] 4.2 Play the intro to the end, and again with a skip, in the browser (reuse a running dev server). Verify by eye that Priya walks out through the gallery door, that the Wet Vestibule door is clear, and that Bram is at his station after the first round

## Workflow follow-up

- Archive after the playtest in 4.2.

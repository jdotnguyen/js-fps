# Tasks

## 1. Rounds and trigger

- [x] 1.1 Remove the two `npcFollow ... stay` steps at the end of `rounds_return` in `src/data/sequences/rounds.json`. Verify: `npm test -- src/script/quiet.test.ts` still passes the rounds tests and `round_return` still targets `drop_jay`.

- [x] 1.2 Raise the Lab B blinds instantly at the end of `rounds_return` (`blinds:set labb up, instant`), and in `quiet_restore.json` raise them for `rounds_done`, not only `drop_started`. Verify: a load after the rounds shows open blinds with Voss visible; `npm test -- src/script/quiet.test.ts`.
- [x] 1.3 Change the drop trigger to `trigger:gallery_brief_spot` and make `?jump=drop` in `src/app/session.ts` place Jay inside that box. Verify: the doorway does not start the drop, a few steps in does, and `?jump=drop` starts it.

## 2. New opening in `drop.json`

- [x] 2.1 Replace `playerControl { move: 'slow', look: 'free' ... }`, `npcMoveTo` x2, `gatherIn` and the 1 s wait with: rails control, `playerWalkTo drop_jay` (wait, timeout ~6, speed ~1.6) in parallel with `squadCatchUpIn R03 at gallery_enter`, then `npcMoveTo` to `brief_giles` and `brief_okafor`. Verify: `?jump=drop` from the Commons side shows bars, the walk and both squadmates beside Jay without anyone popping in view.
- [x] 2.2 Seal `D_R02_R03` with `ifAllIn: R03` after the walk. Verify: with Giles forced far away, the door still seals only once he is inside.
- [x] 2.3 Remove `drop_heins_01` and the `blinds:set` emit and click from `drop.json` (the blinds are already up). Verify: no `drop_heins_01` or `blinds:set` in the drop; `npm test -- src/script/quiet.test.ts`.

## 3. Voss starts distressed, free roam through the kill

- [x] 3.0 In `src/data/kills.json` `grownInside` scratch beat: `max` about 16 and `voss_panic_breath` repeats about every 2.8 s; in `drop.json` the `kill` step's `lines.scratch` closes the beat on `drop_okafor_01`. Move `drop_okafor_02` to `kill:panic` in `drop.json`. Start the `kill` step at the top of the sequence in `parallel` with a `loop count: 1` branch holding the walk, catch-up, seal and `say drop_okafor_01`, and drop `drop_heins_01` and the blinds emit. Verify: `npm test -- src/ai/killProfile.test.ts src/ai/npcKills.test.ts src/script/quiet.test.ts`; in the browser Voss scratches and breathes from the start, and runs to the glass right after Okafor's line.

- [x] 3.1 After Okafor's line, set `playerControl { move: 'free', look: 'free', weapons: false, interact: false }` and delete the `playerLookAt` on `researcher_b`. Verify: bars drop, Jay can walk and look through the whole kill, and fire and interact do nothing.
- [x] 3.2 Check `drop_okafor_01` and the rest of the kill lines read with Jay facing away, and that the scratch, flicker and alarm beats are still noticeable from the north walkway. Verify: playtest the kill facing the north wall and facing the glass.

## 4. Hold at the ambush

- [x] 4.1 Hold Jay's controls for about 3 s across the lights-out, vent rip and first duct bang with bars off, working out which `playerControl` fields give "held, no bars" (design decision 6). Verify: the pistol is drawn on the first `ductBang` whichever way Jay was facing, and control returns before `cp_drop`. If bars cannot be avoided, report it to the user before continuing.
- [x] 4.2 Keep the existing `gunDrawn` and `playerControl { weapons: true }` step and the checkpoint as they are, merging with the Lab B rework's edits to the same file. Verify: `git diff src/data/sequences/drop.json` shows only the opening, control and hold changes beyond the rework.

## 5. Tests

- [x] 5.1 Update `src/script/gather.test.ts` ("the gallery seals only after the gather"): assert `squadCatchUpIn R03` before `doorState D_R02_R03 ... ifAllIn R03`, no `gatherIn R03`, and the two squadmate moves after the catch-up. Verify: `npm test -- src/script/gather.test.ts`.
- [x] 5.2 Update the drop tests in `src/script/quiet.test.ts`: bars on during the walk, `skippable` still false, no `playerLookAt` toward `researcher_b`, controls free during the kill, held at the ambush, free with the pistol at `cp_drop`. Verify: `npm test -- src/script/quiet.test.ts`. Use `trigger:gallery_brief_spot` in the drop tests, and assert the kill starts with the sequence and the scratch beat ends on `drop_okafor_01`.
- [x] 5.3 Check `?jump=drop` in `session.ts`, `quiet_restore` and `test_drop.json` still reach the post-drop state with the squad and door correct. Verify: `npm test -- src/script/quiet.test.ts` and a load of `cp_drop` and of a mid-drop death in the browser.

## 6. Docs and playtest

- [x] 6.1 Update the drop notes in `docs/PLAYTEST.md` for the new opening, free kill and ambush hold. Verify: the notes match what the playtest in 3.2 and 4.1 showed.
- [x] 6.2 Run `npm run typecheck` and the touched test files, then play through rounds, gallery return and drop in one browser tab, closing it afterward. Verify: typecheck is clean and the scene plays start to checkpoint without Giles or Okafor ever visibly appearing.

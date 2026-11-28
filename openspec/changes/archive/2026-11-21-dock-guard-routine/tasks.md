# Tasks

## 1. Waiting and scanning

- [x] 1.1 Bind the guard's checkpoint motion to `dock_guard` and author his relaxed low carry. Exercise motion selection for the guard and a second crew NPC. Review the guard on his actual body in the cast motion sandbox, front and side, through a full idle cycle. Follow `docs/mocap-sources.md` and update credits if importing a take.
- [x] 1.2 Cue his head and weight shift on each approach. Replace the repeated high pose during Ruiz's scan with a continuous reach, sweep and recovery. Verify in R01 that the wand stays in his hand through the sweep and the beep lands during the pass. Exercise the existing full-scan and quick-pass scenarios in `src/script/intro.test.ts`.

## 2. Returning to the desk

- [x] 2.1 Stage the approach, wand placement, chair grip and final seat against the existing R01 desk and chair in the level generator and runtime level data. Verify in the room that the route clears the counter, Jay and the waiting squad and that the final chair faces the keyboard.
- [x] 2.2 Keep the wand in the guard's hand through the walk, then transfer it to the desktop at contact. Exercise the transition on consecutive frames and verify exactly one wand is visible before, during and after release.
- [x] 2.3 Animate the reach, pull, turn and sit. Keep the chair mesh and collider aligned and the hand on the chair back through the pull. Review at quarter speed from the side for a planted foot, continuous hand contact and hips settling on the seat.
- [x] 2.4 Trigger the return after Giles clears the arch, alongside Jay's exit. Replace the intro test's permanent-post assertion with checks that the guard stays through the final clearance and reaches the desk. Play the dialogue and exit at normal speed to check the two paths and their timing.

## 3. Seated endpoint and alarms

- [x] 3.1 Apply one seated endpoint for completion, skip and post-intro restore. Extend intro tests to compare guard position and pose, wand ownership and chair placement after a full watch and after skips during scan, walk, pull and sit. Load an existing post-intro checkpoint and verify the same arrangement.
- [x] 3.2 Direct the free-play alarm reaction toward Jay from the desk. Exercise armed, unarmed and repeated passes in `src/script/quiet.test.ts` and verify the guard remains seated during his spoken response.
- [x] 3.3 Run typecheck and the affected tests. Play the opening from Jay's booth in a scratch slot and compare a watched ending with a skipped one. Confirm that the idle reads across the booth and the desk routine completes while the coffee scene continues.

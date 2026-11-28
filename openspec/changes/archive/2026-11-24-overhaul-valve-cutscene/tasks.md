# Tasks

## 1. Scream asset

- [x] 1.1 Convert `C:\Users\justi\Downloads\freesound_community-monster-roar-02-102957.mp3` to mono, loudness-matched per `docs/audio-assets.md`, save under `public/assets/audio/ambience/`, and verify the file plays at the expected length (about 4.9 s).
- [x] 1.2 Map it in `src/audio/sounds.ts` (new id, `flooded` reverb, positional) and verify the audio-asset tests pass with `npm test -- src/audio`.
- [x] 1.3 Add the `CREDITS.md` entry (source page and licence supplied by the user; "freesound_community" until then) and verify the entry follows the table format.

## 2. Level data: anchors and trigger

- [x] 2.1 In `scripts/gen-slice01.mjs`, add anchors for the scream origin (around the bend, about x 10), the elite's charge start (back of the straight stretch, about x 16 to 18), Jay's run stop, and the closer pry position. Regenerate `src/data/levels/slice01.json` and verify the diff holds only these anchors and the trigger.
- [x] 2.2 Replace `trig_r10_ambush` with a larger box in R10 beside both doors, beyond Jay's run stop. Verify with a level test that the run-stop anchor is outside the box and the box lies inside R10.
- [x] 2.3 Verify the sightline: a raycast from Jay's run-stop to the elite's charge start is clear through the open door. If it is blocked, move the charge start forward and re-check.

## 3. Valve cutscene rewrite (`valve_turn`)

- [x] 3.1 Reorder to: beacon, view turns to the open door, scream, `playerWalkTo` run to the run-stop, elite appears and charges, Okafor_01, Okafor_02, door seals as the line ends. Verify the order with the ordering test in `src/script/action.test.ts`.
- [x] 3.2 Tune the elite's speed so it reaches the top of the stairs just after the leaves meet, and verify no door line starts after the seal.
- [x] 3.3 Move the view release, `valve_done`, the objective change and `cp_valve` to the slam beat; leave the pounds, the retreat, Giles's "Is it gone?" and the `floodOut` cue after it. Verify Jay can move during the pounds and that restoring `cp_valve` still seals the door and places the squad.
- [x] 3.4 Check the skip path (replay, hold to skip) leaves the same end state, including Jay's position, and verify with a sequence test.
- [x] 3.5 Playtest follow-up: spawn the elite beside the ammo crate (x 17, clear of its collider), scream from it at gain 16, hold the view on it, and force the flashlight on when the run ends with a new `playerFlashlight` step. Verified by the ordering test (`flashlight on` between the run and the charge) and the sightline test.

## 4. Ambush rewrite (`r10_ambush`)

- [x] 4.1 At the start of `r10_ambush`, silence speech and stop the rest of `valve_turn`, then play the `floodOut` cue and start the pry on the same frame. Verify with a test that fires the trigger while Giles's line and the pounds are still going.
- [x] 4.2 Raise `doorPry` to about 0.5, move the elite closer to the door, lengthen the wrench slightly, and edit the three `pry_*` poses in `src/data/poses.json` so the forearms reach through. Verify in the browser from R10 that the arms are well past the door plane before the slam.
- [x] 4.3 Add a test that the door collider is still on at the maximum pry, and update the `r10_ambush` ordering test in `src/script/action.test.ts`.

## 5. Docs and playtest

- [x] 5.1 Update the valve and ambush notes in `docs/PLAYTEST.md` and the `flooded-tunnel` notes in `docs/HANDOFF.md` if they describe the old order, and verify no stale mention of the R11 bulkhead trigger remains.
- [x] 5.2 Playtest with `/?level=slice01&debug&jump=r10_flood` on the running dev server (use `?slot=scratch`): scream first, Jay's run, the elite visible down the hall, free view from the slam, and the pry firing as Jay nears the doors. Close the browser afterwards.

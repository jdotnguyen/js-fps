# Tasks

## 1. Measure Bram's neck, collar and lips

- [x] 1.1 From the current asset and the source scan (`previews/chef_t_pose_src.glb`, before decimation), measure in the source frame: the neck axis, `collarY` (where the neck skin starts in the column), the chest line (top of the jacket collar, ~1.62), the neck column radius (neck skin in, back collar out), `jawLineY` (chin underside) and `faceRadius`. Also measure the lip seam on the midline. Write the values with a one-line source each into the comments next to `J` in `scripts/fix-bram-glb.mjs`. Verify: every design D1-D3 parameter has a measured value in that comment.
- [x] 1.2 Confirm the lip seam on a close-up of Bram's row, talk column, in `/sandbox/cast-motion.html`. Reuse the dev server at `http://localhost:5173/` if one answers; close the tab afterwards. Save a "before" screenshot of the talk and idle cells for the PR. Verify: the seam height in 1.1's comment matches what the close-up shows, and the screenshots are saved.

## 2. Face: chest off the head, neck rule, jaw at the lip seam

- [x] 2.1 Add `bram` to `NECK_BODIES` in `src/actors/bodyModel.test.ts`, adding a hunk without touching the rig-necromorph edits in that file. Verify: `npm test -- src/actors/bodyModel.test.ts` fails on `scan body bram: neck owns the neck...` against the current asset (chest weight in the neck column, lower-face vertices off head and jaw).
- [x] 2.2 Export `applyNeckRule` from `scripts/lib/scan-body.mjs` with no other change. Verify: the diff is the `export` keyword only, and `skinScan` still calls it as before.
- [x] 2.3 In `scripts/fix-bram-glb.mjs`, sample each vertex's base colour from the scan's colour texture and tell skin from clothes (design D2). Penalise `Hips`, `Spine` and `Spine1` in the capsule scoring on skin above `collarY` and on everything above the collar's top, next to the existing arm/torso penalty. After smoothing, move any trunk weight above the collar's top to the head. Verify: no vertex above the collar's top carries chest or spine weight, and the collar-coloured vertices are the ones wrapping the sides and back of the neck.
- [x] 2.4 Call `applyNeckRule` after the smoothing passes with 1.1's parameters and the skin colour gate (design D1). Follow it with the collar rule (design D2), then the jaw mask, whose top edge moves to the lip seam and lower bound to the chin's underside (design D3). Update the script's header comment to list these steps. Verify: the rebuild logs the neck rule's and the collar rule's vertex counts, all non-zero. The upper lip carries no jaw weight, and the lower lip and chin are mostly on the jaw. A simulated look-at turn leaves the face rigid with the head and keeps the collar on the neck, and no edge round the collar stretches past 2.5x (D2).
- [x] 2.5 Rebuild with `node scripts/fix-bram-glb.mjs previews/chef_t_pose_src.glb`. Verify: `npm test -- src/actors/bodyModel.test.ts` passes the bram neck test, the bram jaw test (at least 20 vertices mostly on the jaw, none high on the head) and the other bram tests. The body joint positions are unchanged from the current asset.

## 3. Left hand: pin the thumbs, check the mirror

- [x] 3.1 Add the mirror test to `src/actors/bodyModel.test.ts` (design D5). For every `body-models.json` entry whose prepared model (`detailHands: true`) has finger bones on both hands, the rest-pose index-to-pinky direction (falling back to ring) must match the other hand's, mirrored left to right, with cosine ≥ 0.5. Verify: against the asset from 2.5 it fails only for `bram`, and passes for every other listed body.
- [x] 3.2 In `scripts/lib/hand-rig.mjs`, add an opt-in option on `splitHands` (passed to `planHand`) that keeps the `thumbToward` guess for the listed sides and skips the bend-check flip. It throws when a pinned side's width axis is side-on to `thumbToward` (`|facing| < 0.25`). Correct the `BEND_SURE` comment (Bram reads -4.4 cm / +2.0 cm on his left hand and is now pinned). Verify: with the option absent, `planHand` behaves as before (no change to any other call site). If Heins's source scan is on this machine, a rebuild of her into the scratchpad gives the same finger bone positions as her committed asset.
- [x] 3.3 In `scripts/fix-bram-glb.mjs`, pass `thumbToward` +Z for both hands and pin both. Rebuild as in 2.5. Verify: the build log has no "thumb side flipped" line; the left hand's `Thumb1` sits at the front of the hand (+Z of the index base in the source frame), as the right hand's does. `npm test -- src/actors/bodyModel.test.ts` passes the mirror test and the bram fist test (no edge past 2.5x).

## 4. Review in motion and land

- [x] 4.1 In `/sandbox/cast-motion.html`, solo Bram's row with the detail pass on. Check: idle and relaxed hands curl toward the palms on both sides; in the talk column the upper lip stays with the head while the lower lip and chin follow the jaw; turning the head doesn't shear the face; the jacket collar doesn't ride up with the neck. Save "after" screenshots matching 1.2's. Close the tab. Verify: each check holds, and both sets of screenshots are saved.
- [x] 4.2 In the game, open the intro kitchen with `?slot=scratch` and walk around Bram while he talks and his look-at follows you, as in `docs/PLAYTEST.md`'s intro steps. Close the tab afterwards. Verify: no face shear or backward fingers in the playthrough.
- [x] 4.3 Run `npm run typecheck`, then `npm test` before opening a PR (leave `TEST_CONCURRENCY` at its default). Verify: both pass.
- [x] 4.4 Commit only this change's files and hunks (the script, `scan-body.mjs`, `hand-rig.mjs`, `bram.glb`, this change's hunks in `bodyModel.test.ts`, and `openspec/changes/fix-bram-rig/`), following the shared-checkout commit practice, with a plain-language subject naming `fix-bram-rig`. Verify: `git show --stat` lists only those paths, and the rig-necromorph edits are still uncommitted in the working tree.

## Workflow follow-up

- Archive the change after review, which syncs the new hand scenario into `openspec/specs/imported-body-models/spec.md`.

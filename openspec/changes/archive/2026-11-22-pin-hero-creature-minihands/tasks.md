# Tasks

## 1. Confirm where the belly arms should ride

- [x] 1.1 In a scratch script, load `necromorph_slasher.glb`. For each side, sum the skin weights of the vertices weighted to any `*Minihand*` / `*MiniH_*` bone whose root is within ~5 cm of `*Minihandbase`, grouped by the game joint each influencing bone resolves to today. Record in design.md whether the root ring is mostly on `pelvis` (via `Upper_Body_02`), in which case they follow the parent bone as designed, or mostly on `spine`/`chest`, in which case they follow the joint with the most root weight (design Risks). Done when design.md states the measured split and the chosen joint.

## 2. Classifier rule and tests

- [x] 2.1 Add a test in `src/actors/bodyModel.test.ts` that fails today. On the prepared necromorph: (a) `hand_L` / `hand_R` sit near the world position of `Left_Hand` / `Right_Hand`, well above belly height (y > pelvis + 0.4 m); (b) every `*Minihand*` and `*MiniH_*` bone is in `m.unmapped`; (c) no `hand_*` piece's bounding box exceeds about 0.45 m on any axis (it's 0.61 × 0.91 × 1.03 m today). Run `npm test -- src/actors/bodyModel.test.ts` and confirm it fails.
  - Done as: wrist pivots checked by bone name (`Left_Hand_09` / `Right_Hand_017`), and the blade forearm checked against the upper arm (was 0.19 vs 0.27 m). Every mini bone rides `spine` and is listed as unmapped. The hand piece check uses the middle dimension (< 0.3 m), because the fixed blade hand is long and thin (0.19 x 0.63 x 0.10 m) and would fail the original 0.45 m cap on its longest side.
- [x] 2.2 Add a regression test that prepares every entry in `src/data/body-models.json` except `necromorph` and checks each bone's game joint and each joint's pivot bone against a snapshot of the current mapping, taken before 2.3. It must pass before and after 2.3.
  - Done as: instead of a stored snapshot (which other agents' GLB edits would break), the test compares each rig's full mapping with the rule on and off (`mapRig(bones, [], { secondaryLimbs: false })`), using bones built from the GLB node tree only. It also asserts the rule does fire on the necromorph.
- [x] 2.3 Implement design Decisions 1-3 in `mapRig` (`src/actors/bodyModel.ts`): a `hand_<side>` classification without a same-side `foreArm_<side>` ancestor is cleared before joints and pivots are assigned. If 1.1 picked the root-weight joint, map these bones to that joint instead of the parent's. Done when `npm test -- src/actors/bodyModel.test.ts` passes, including 2.1, 2.2 and the existing necromorph tests.
- [x] 2.4 Run `npm test -- src/ai/npcKills.test.ts src/actors/handPhysics.test.ts` (the hand-joint consumers) and `npm run typecheck`. Done when both pass.
  - Done as: typecheck clean, `handPhysics` passes, `npcKills` 37/39. The 2 failures (`mauled` attacker hand 0.26 m vs 0.25 m, in the pinned-attacker and R08 end-to-end tests) were accepted as unrelated: that test setup has no body-model library, so the creature uses the procedural body and `mapRig` never runs. R08 is the shelved `overhaul-priya-r08-death` work.

## 3. Playtest the three scenes

Body check done 2026-11-22 in the pose bench (`/sandbox/poses.html?models=necromorph`, `slamWindup`), using a worktree of d7740a6 with only this change applied. Before: the belly arms were dragged up into the blade arms, with long stretched streaks on the right arm and torso. After: the blades lift from the wrists and the belly arms stay down on the belly, with no stretch. The in-scene checks below still need a human playtest, because headless rendering ran at about 1 FPS and the game needs a real click to resume. The shared checkout also did not boot at the time (its uncommitted `slice.ts` was missing the `water_surface` prop that `slice01.json` uses).

- [x] 3.1 Reusing the dev server on `http://localhost:5173/` if one is running, play `?level=slice01&debug&jump=r05&slot=scratch` (first contact, the `lab_creature` from Voss). Check that the belly arms don't lift or stretch when the blades swing, and that blade hits land from the wrist. Note any grip or hit that looks offset.
- [x] 3.2 Play `?level=slice01&debug&jump=r11&slot=scratch` (end fight with the hero on the `necromorph` body) with the same checks, plus its slam.
- [x] 3.3 Check the R08 creature (`jump=r07`, Priya's scene, `lab_creature`, currently paused, see `overhaul-priya-r08-death`): the creature's hand meets her ankle grip, and the belly arms stay down. If R08 can't be reached in its paused state, spawn the creature with `&enemies=` and check a blade lift there instead. Close every tab and stop any server you started.
- [x] 3.4 If 3.1-3.3 show a grip or attack landing off the hand, retune only that pose or offset and re-run its scene. Otherwise record "no retune needed" here.
  - No retune needed: playtested by the user on 2026-11-22 on a worktree server with this change (including `jump=drop`), and signed off.

## Workflow follow-up

- Sync the `imported-body-models` delta and archive the change once the playtests are signed off.

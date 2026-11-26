# Tasks

## 1. Baseline

- [x] 1.1 Add `src/actors/blade/measure.test.ts`, which builds the `lab_creature` and `flood_elite` bodies in Node and measures the lowest foot point, the ankle height and the jaw's skin weight. Confirm the design's figures and that planting the ankle at the model's own height stops the sinking (design D7). Verify by running the file; if the cause differs, update the design before group 4
- [x] 1.2 Record the R06 and R11 fight baselines (resolved or not, duration, shots to sever, shots to kill) with the existing enemy simulation at fixed seeds, and verify the same seeds give the same figures twice
- [x] 1.3 Capture reference screenshots of the creature in the Lab B pounding, the R08 impale and the R10 scream and charge (`?slot=scratch`, one tab, closed afterwards), and verify each is saved under `previews/` for the before and after comparison

## 2. Jaw repair (design D2, D5)

- [x] 2.1 Add `scripts/fix-necromorph-glb.mjs` with its usage line, the source copy command, a `--check` mode and no fixes yet. Verify that its output loads in three.js with the same meshes, joints, weights and extensions as the source
- [x] 2.2 Add the `Jaw` joint and the mandible weights. Verify with `scripts/fixNecromorph.test.ts`: only vertices that carried head weight changed; every other joint, inverse bind matrix and weight matches; at 30 degrees open the skull stays still and no edge of 3 mm or more passes 2.5 times its length (spec "Wide open"). If the seam fails after splitting it, stop and ask
- [x] 2.3 Measure shoulder edge stretch with the arms raised overhead from the prepared rest pose (design D5). If it passes 2.5 times, apply the shoulder weight fix in the script. Verify by test, and record the result in design D5
- [x] 2.4 Run the script to replace `necromorph_slasher.glb`, verify `--check` reports a match and the file stays under 600 KB, and update the model's row in `CREDITS.md` to say what was changed. Run `npm test -- src/actors/bodyModel.test.ts`

## 3. Sandbox (design D10)

- [x] 3.1 Add `sandbox/blade-creature.html` and `src/sandbox/bladeCreatureSandbox.ts` with the two sizes beside the 1.78 m figure, pose and jaw controls, floor, hit shapes, orbit, pause, step and speed, and `window.blade`. Controls for later groups are added by those groups. Verify each control in the browser, then close the tab
- [x] 3.2 Write `docs/blade-creature.md` covering the repair script and the sandbox, and verify every command in it runs as written

## 4. Rig (design D1, D3, D7)

- [x] 4.1 Add `src/data/blade-creature.json`, its type and validator, and the profile name on the `necromorph` entry of `body-models.json`. Verify by test that it rejects an unknown bone, joint or pose, naming it, and that every bone it names exists in the model
- [x] 4.2 Preserve the segment and limb detail bones for a profiled body. Verify by test: neck and spine bends spread with no segment taking more than half; all 28 weighted belly bones carry skin and stay rooted when the blades lift; the bone count is at most `MAX_BONES`; every other body model prepares exactly as before. Update the belly-arm test in `bodyModel.test.ts`
- [x] 4.3 Drive the jaw range and the seeded belly-arm layer (idle, flare, clench). Verify by test the spec's "At rest" and "Screaming" belly-arm figures and that two runs with one seed give identical poses; add the amounts to the sandbox
- [x] 4.4 Give `FootIkSolver` a per-body ankle height and use the profile's. Verify by test that standing feet are within 3 cm of the floor and that a human body's foot positions are unchanged
- [x] 4.5 Replace the creature's hit shapes with the profile's, including the blades. Verify by test the spec's "Shot at the middle of a blade" and "Shot past the body", and a severed forearm taking its blade; show the shapes in the sandbox

## 5. Poses and motion (design D4, D6, D8)

- [x] 5.1 Print the retargeted joint angles of the authored node pose from the repair script, and author `blade_scream` and `blade_stance` in `poses.json`. Verify by test the spec's "Standing still" figures, that the stance fits under 3.2 m at 2.15 m tall, and that every `blade_*` pose keeps its upper arms inside the design D5 envelope (extend `src/actors/blade/shoulders.test.ts`); review both in the sandbox with the user
- [x] 5.2 Add the pose map, applied wherever a profiled body looks up a pose or sequence step, with the one-warning fallback. Verify by test that a creature asked for `kill_glass_0` takes its own pose while Voss takes hers, and that an unmapped pose falls back without throwing
- [x] 5.3 Add the motion layer's idle and turn off capture, human gaits and the broken-limb skew for profiled bodies. Verify by test that no human clip or human gait runs on the creature standing, scripted or getting up, and that `mocapPhysics.test.ts` and `castMotionCoverage.test.ts` still pass
- [x] 5.4 Add the prowl and charge gaits with ground-matched stride, foot contacts and footfalls. Verify by test at 1.1, 1.35, 3.2 and 7.2 m/s that a planted foot slides under 10 cm and sinks under 3 cm, and that standing to charge and back has no joint step over 30 degrees at 60 fps; add speed controls to the sandbox
- [x] 5.4a Keep the foot IK on for the creature during kills and at any distance from the camera, and make `gaitRate` lengthen its stride instead of slowing its feet (design D6a). Verify by test that a creature held in a kill, and one 20 m from the camera, keeps planted-foot slide under 10 cm at 3.2 m/s; that at `gaitRate` 0.6 and 7.2 m/s the slide stays under 10 cm (spec "A kill that slows its steps"); and that a human body's foot IK and walk are unchanged
- [x] 5.4b Add stepped turns, starts and stops (design D6a). Verify by test the spec's "Turning to stare" (each foot replaced at least once, no planted foot twisting more than 30 degrees) and "Stopping from a charge" (a settling step, both feet planted once stopped), and add a turn button to the sandbox
- [x] 5.4c Add a Node test that walks the creature along R08's marks at the scene's speeds (the sped-up approach and walk back at 7.2 m/s, the carry at 1.35), through the real NPC movement, with the kill's `gaitRate` and grip, and verify the spec's "Priya's death, start to finish": planted-foot slide under 10 cm and no foot sinking more than 3 cm on every frame. Review the prowl, charge, turns and stops in the sandbox with the user
- [x] 5.4d Make the body move with its steps (design D6b): a bob that drops onto each landing and rises through the stride, a push-off surge, swing feet lifted clear, the hips rolling over the planted leg, the trunk pitching with each step, and the blades and head following through; the charge far more violent than the prowl. Add a contact-sheet view to the sandbox (a follow camera, frames in a grid). Verify by test the spec's "Not gliding" figures at 1.35, 3.2 and 7.2 m/s, that the foot tests above still pass, and review contact sheets of the prowl and charge with the user
- [ ] 5.5 Author the unfold, stare, pound, maul, slam, pry and attack poses, keeping today's timings. Verify by test that every mapped name resolves and that a windup shows a blade drawn back before the strike; review each in the sandbox with the user
- [ ] 5.6 Add performances and `scream`. Verify by test the spec's "A full scream" figures, a stretched hold of 5 s, and that `setPose`, a move and a skip each end it cleanly; add it to the sandbox and document the profile and performance formats in `docs/blade-creature.md`

## 6. Combat (R06, R11)

- [ ] 6.1 Check attacks, grabs, hero slams, stomps, severing, crawl and drag on the profiled body. Verify with `src/ai/enemy.test.ts` and `enemySim.test.ts` that timings, reach and damage are unchanged, and add cases for both fights resolving
- [ ] 6.2 Compare the R06 and R11 fights with the 1.2 baselines and narrow the blade shapes if either stops resolving or its duration moves more than a quarter (design D7). Verify by test, and record the figures in the change
- [ ] 6.3 Play both fights (`?level=slice01&debug&slot=scratch&jump=r06` and `&jump=r11`): attacks read as blade attacks, no blade covers the view during a grab, the legs lesson still plays. With physical interaction on, check a severed arm's debris. Verify no console errors, then close the tab

## 7. Scenes (design D8, D9)

- [ ] 7.1 Confirm the `adopt-physics-engine` and `livelier-cart-slam` edits to `npcKills.ts`, `npcs.ts`, `kills.json`, `types/kills.ts` and `action.test.ts` are committed. Verify with `git status` that none of those files has someone else's pending edits
- [ ] 7.2 Add the blade clearance test helper (both blades sampled each frame against level colliders) with a test that it catches a blade driven into a wall
- [ ] 7.3 Lab B drop: unfold, walk to the glass and pound with the blade on the pane from the profile's distance. Verify in `npcKills.test.ts` the spec's "Blades meet the pane", the clearance helper over the whole pounding, and that the escape and restore scenarios still pass
- [ ] 7.4 R08: add the `blade` grip fraction, tune the impale, carry and reach, and add the scream after the throw. Verify by test "The blade goes through her", "Then it leaves", no step over 0.3 m per frame, both faces toward the glass on each slam, the surgery door passed with blades clear, and the existing `medbay-attack` tests
- [ ] 7.5 R10 and R11 door: add the `scream` step to `action_tunnel.json` and tune the charge and pry. Verify in `action.test.ts` that the scream runs while it waits and gives way to the charge, the door still slams before it arrives, both forearms sever, the pry's blades reach into the pump room, and skip and restore leave the same end state
- [x] 7.5a The charge throws water (design D6c): the creature's own footsteps from its foot contacts (a stomp on landing, a lift on leaving the ground, each with a splash amount from its speed); `WaterDisturbances.footstep` churning harder and throwing new `stomp` and `kick` sprays at any depth; their sounds in the session's splash table. Verify by test in `src/world/waterDisturbances.test.ts` that a creature landing in 0.75 m of water throws a stomp spray larger than a body landing and a lift throws a kick spray, and that a person's step is unchanged; and in the browser (`?level=slice01&debug&slot=scratch&jump=r10_flood`, a build served by `vite preview` so other agents' edits do not reload it) that the charge up R09 throws spray on every step, with screenshots for the user
- [ ] 7.6 Update the R04, R06, R08, R10 and R11 creature lines in `docs/PLAYTEST.md`, and verify the documented jumps work as written

## 8. Integration

- [ ] 8.1 Play the drop, R08 from the viewing strip and the far corner, and R10 through the ambush in the browser. Compare with the 1.3 screenshots and confirm every scenario in this change's specs, with the program watch logging nothing new. Capture screenshots or clips for the pull request, close the tab, and ask the user to review the motion
- [ ] 8.2 Run `npm run typecheck`, `npm test` and `npm run build`, and verify all pass
- [ ] 8.3 Run `openspec validate rig-necromorph --strict` and verify it passes

## Workflow follow-up

- Before release, check the model's provenance with the user (see `proposal.md`, open risk).
- Archive the change after review.

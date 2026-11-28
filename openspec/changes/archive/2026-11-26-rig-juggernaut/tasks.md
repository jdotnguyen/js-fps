# Tasks

## 1. Prerequisite

- [x] 1.1 Confirm `stop-midgame-shader-stalls` has landed: `git log -- src/render/fx/juggernaut.ts` shows a commit, and its task 4.1 is checked. Verify `npm test -- src/render/fx/juggernaut.test.ts` passes on that commit before starting.

## 2. Repair the model (design D1-D4)

- [x] 2.1 Write the source copy, `git show 900e513:public/assets/models/infected/monster_juggernaut.glb > previews/sources/monster_juggernaut_src.glb`. Add `scripts/fix-juggernaut-glb.mjs` with its usage line, a GLB read and write, and a `--check` mode. Verify that with every fix switched off it writes a model three.js loads with the same meshes, joints and weights.
- [x] 2.2 Find and bake each face part's correction (D2): one similarity fit per placeholder group, with the acceptance checks. Verify with `scripts/fixJuggernaut.test.ts`:
  - in the bind pose each eye, teeth and tongue mesh lies inside the head's skinned bounds;
  - every face vertex mirrors across the midline within 1 cm;
  - each group lies on its joints;
  - the teeth sit between the jaws, upper row above lower;
  - the tongue stays behind the front teeth.
  
  If any part fails, stop and ask the user to approve downloading the Sketchfab original.
- [x] 2.3 Move `arm3.L/R` under `arm2.L/R`, `leg4.L/R` under `leg3.L/R`, and `head_ik_094` under `head_09`, each keeping its world transform, with the head marker's offset taken in the exported pose (D3). Verify by test:
  - the joint list, its order, the weighted joints' inverse bind matrices and every vertex's indices and weights match the original;
  - the head marker's world position in the exported pose matches the original's within 1 mm.
- [x] 2.4 Reset the node transforms to the bind pose and write the old ones as `exported_rest` into `src/data/creatures/juggernaut.poses.json`: rotations, plus scale where it is not 1 (D4). Add translations only if they turn out to be needed. Verify by test:
  - the repaired model in neutral puts every skinned body vertex within 1 mm of its modelled position;
  - applying `exported_rest` reproduces the original's skinned body within 1 mm.
- [x] 2.5 Run the script to replace `public/assets/models/infected/monster_juggernaut.glb`, and verify `node scripts/fix-juggernaut-glb.mjs --check` reports a match. Fix the Monster Juggernaut row in `CREDITS.md` to name sanyaork and `https://sketchfab.com/3d-models/monster-juggernaut-a36b8b8d97ac4f68ac2759591bfcf95f`, and verify both match the GLB's `asset.extras`.

## 3. Creature data (D5)

- [x] 3.1 Add the creature definition and pose types, with a validator in `src/data/types/` modelled on the existing ones. Verify by test that it rejects:
  - an unknown joint, naming the pose or chain and the joint;
  - a missing role a solver needs;
  - a limit whose minimum is greater than its maximum.
- [x] 3.2 Write `src/data/creatures/juggernaut.json`: chains by role, starting limits, hinge axes measured from the bind pose (the plane through joint, parent and child), pole hints, the look-at split, and the height of 5.1 m. Verify by test that it validates and that every joint it names exists in the repaired model.

## 4. Rig core (D6-D8)

- [x] 4.1 Add `src/actors/creature/rig.ts` with neutral, apply and blend for named poses, and the D7 evaluation order. Verify by test:
  - in neutral every left joint mirrors its right within 1 cm;
  - a 0.5 s blend is part-way at 0.25 s and exact at 0.5 s;
  - the same inputs evaluated twice give identical joint quaternions;
  - `exported_rest` is available as a named pose.
- [x] 4.2 Add hinge and swing-twist limits, clamped on every write. Verify by test:
  - a knee driven against its hinge stops at its limit;
  - 1,000 random poses, blends and IK targets never leave a joint outside its limits.
- [x] 4.3 Verify by test that the limbs and face parts ride their bones:
  - a 45° upper-arm swing in any direction keeps the gap from the forearm's end to the hand within 1 mm, with the fingers following;
  - a 30° thigh swing keeps the foot on the leg's last segment within 1 mm;
  - a 30° head turn keeps each eye's offset from the head within 1 cm.
- [x] 4.4 Add the `jaw_open`, `tongue_extend` and `tongue_curl` partial poses and their amounts (D8). Verify by test:
  - at jaw 1 the lower mouth and both side jaws sit at their open limits symmetrically, and the lower teeth have moved with the lower mouth;
  - the upper and lower teeth overlap no more than in neutral;
  - with the jaw open, the fully extended tongue reaches past the front teeth, every tongue joint within its limits.
- [x] 4.5 Add a test that neither `src/data/body-models.json` nor the motion capture library lists the Juggernaut, and that `prepareBodyModel` is never called with its URL.

## 5. Solvers (D12, D6)

- [x] 5.1 Add arm IK (a hinge-preserving limb solve in `limbIk.ts` instead of `solveTwoBone`, see design D12), then clamp. Verify by test:
  - a reachable hand target is met within 1 cm, with the elbow on the pole's side and every arm bone's length kept within 1 mm;
  - an out-of-reach target leaves the arm pointing straight at it with no stretch.
- [x] 5.2 Add `src/actors/creature/limbIk.ts` (arms and legs share it), the pantograph solve with the foot laid on a ground normal. Verify by test:
  - on level ground the foot reaches a reachable target within 1 cm, with its sole within 5° of the ground, the ankle behind the knee and every bone's length within 1 mm;
  - with the ground tilted 15° the sole follows within 5°, within the ankle's limits.
- [x] 5.3 Add `src/actors/creature/lookAt.ts`, the neck and head split followed by the four eyes. Verify by test:
  - a target 20° to the side is faced within 2°, with both neck and head turned and every eye aimed within 2°;
  - for a target past the head's limit, the head stops at its limit and the eyes go further, up to theirs.
- [x] 5.4 Expose the rig's aim point from `head_ik_094`. Verify by test that after a 30° head turn its offset from the head is unchanged within 1 cm.

## 6. Finale and rendering (D9, D11)

- [x] 6.1 Make `src/render/fx/juggernaut.ts` build the rig, apply `exported_rest` before the warm-up, stop hiding the `details` meshes, measure the 5.1 m scale from the body in that pose, and aim from the rig. Update `src/render/fx/juggernaut.test.ts` and verify:
  - the face meshes are visible after load;
  - the height is 5.1 m;
  - the aim point at the end of the glide is within 2 cm of the pre-rig value, recorded from the original GLB in the test;
  - the reveal still creates no object, material or geometry.
- [x] 6.2 Add `clearcoatMap`, `clearcoatNormalMap` and `clearcoatRoughnessMap` to `TEXTURE_SLOTS` in `src/render/tiers.ts`. Verify with a test in `src/render/tiers.test.ts` that the repaired model's face material counts 8 units with a scene environment, and that High's light budget is unchanged.
- [x] 6.3 Verify `npm test -- src/script/action.test.ts` still passes for the R16 finale.
- [x] 6.4 Reusing a running dev server if one answers, open `?level=slice01&debug&slot=scratch&jump=r16_finale` and verify on CAM 10:
  - the eyes, teeth and tongue show and the flashlights light the face;
  - the creature clears the foreground right pillar;
  - the program watch logs nothing at the reveal.
  
  Capture a screenshot for the pull request, then close the tab.

## 7. Sandbox and tuning (D10)

- [x] 7.1 Add `sandbox/creature-rig.html` and `src/sandbox/creatureRigSandbox.ts`:
  - the creature beside a 1.78 m human figure;
  - target and pole gizmos;
  - per-chain rotation, the pose list with a blend time, and jaw and tongue sliders;
  - limit drawing and mesh toggles;
  - pause, step and speed controls;
  - the readout of remaining distance and joints at a limit;
  - `window.creatureRig`.
  
  Verify in the browser that each control works and that dragging a foot target across the floor matches the spec scenario, then close the tab.
- [x] 7.2 In the sandbox, tune each limit and hinge axis against the creature's mesh (no self-intersection at the extremes, plausible knuckle-walk reach with the hands on the floor), updating `src/data/creatures/juggernaut.json`. Verify that the rig and solver tests still pass, and capture before and after screenshots of the extremes.
- [x] 7.3 Write `docs/creature-rig.md` covering:
  - how to re-run the repair, with the source copy and `--check`;
  - the creature data and pose formats;
  - how to use the sandbox.
  
  Verify that every command it gives runs as written.

## 8. Integration

- [x] 8.1 (Marked complete by the user. typecheck and every touched test file pass; the full `npm test` was stopped for low memory and `npm run build` was not run.) Run `npm run typecheck`, `npm test` and `npm run build`, and verify all three pass.
- [x] 8.2 Run `openspec validate rig-juggernaut --strict` and verify it passes.

## Workflow follow-up

- Archive the change after review.
- Next change: Juggernaut motion on this rig. It covers walking and knuckle-walking with planned, planted steps, turning, breathing and flesh springs, face life, the roar, swipe, slam, peek and lunge as key-pose data, and the finale's step-out in place of the glide.
- After that: Juggernaut encounters. They cover AI, pathfinding at giant scale, attacks, weak points and hit volumes, hit reactions, physics bodies (after `adopt-physics-engine`) and arena-scale spaces.

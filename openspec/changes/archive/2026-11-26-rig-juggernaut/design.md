# Design

## Context

See `proposal.md` for the motivation. These measurements of the shipped `monster_juggernaut.glb` (Sketchfab export of `future monster_low.fbx`) shape the approach. At the game's 5.1 m height, one model unit is about 0.35 m.

- **Skin.** One skin of 137 joints covers all five meshes. 84 joints carry weight and 43 are `_end` leaf markers. Ten IK control and target joints carry no weight: `leg_IK`, `knee_IK`, `elbow_IK` and `arm_IK` per side, plus `head_ik_094`. The model has no animations or morph targets. Every vertex's weights sum to 1, with at most 4 influences.
- **Detached face parts.** The eyes, teeth, tongue and tongue teeth (material `details`) skin to positions about 300-1000 units from the head. They were exported in a different space from the body's bind space. Their placeholder nodes (`Object_8`, `Object_10`, `Object_12`, `Object_14`) carry scales of 130 and 175, small X rotations of about 6° and 16°, and translations of about (0, 12, 3.6) body units, which is near the head. Applying these matrices directly does not recover the right placement. Fitting the four eye joints alone gives a scale of about 0.04 and lands each eye within about 0.05 units of its joint.
- **Hands and feet on control bones.** `arm3` (the hand) hangs under `arm_IK`, and `leg4` (the foot) under `leg_IK`. Both are children of `_rootJoint`, so in the rest pose the hand sits 0.073 units and the foot 0.034 units from the end of its limb. The file has no constraints to tie them together.
- **The rest pose is posed.** In the node transforms, 63 weighted joints are more than 10° from their bind pose:
  - the head and everything on it, about 31°;
  - the side jaws, 34-42°;
  - the right foot, 36°;
  - the tongue, also scaled to 1.228.
  
  The bind pose is the symmetric modelled stance. The finale shows the posed frame today.
- **Bone lengths.** Shoulder 1.42 m, upper arm 2.02 m, forearm 1.62 m, hand to fingertip about 1.0 m. Thigh 1.22 m, shin 1.20 m, third segment 1.21 m, foot 0.56 m. The fingertips hang about 1 m off the floor.
- **Current owner of the creature.** `stop-midgame-shader-stalls` (uncommitted) moved the creature into `src/render/fx/juggernaut.ts`. That module loads it with the session, adds it hidden for the warm-up, hides the `details` meshes, scales the body to 5.1 m from its bounds, glides between `r16_monster_hide` and `r16_monster_reveal`, and aims from `head_ik_094` plus 0.8 m.
- **Existing helpers.** `src/actors/ik.ts` has `solveTwoBone`, an analytic, world-space solve that respects joint scale. `src/actors/springs.ts` and `noise3.ts` exist for the later motion change. Human poses are XYZ Euler-degree data validated in `src/data/types/`. Sandboxes are plain pages under `sandbox/` with a module in `src/sandbox/`.

## Goals / Non-Goals

**Goals:**
- One deterministic rig evaluation per frame. It is a pure function of the pose inputs, so every requirement in `specs/creature-rig/spec.md` can be checked in a node test without a GPU.
- A creature definition stored as data, so a second creature means a new model and a new data file, not new rig code.
- The finale looks the same apart from the restored face parts (the scenario in `specs/transit-wing/spec.md`).

**Non-Goals:**
- Any motion over time beyond pose blending. Locomotion, breathing, flesh springs, face life and set pieces belong to the motion change.
- Hit volumes, damage, physics bodies, ragdolls and AI.
- Re-encoding the model's textures (7.7 MB GLB, JPEG and PNG). That can follow on its own.
- Spreading spine bends across `spine1`-`spine4`. Look-at uses only the neck and head here.

## Decisions

### D1. Repair offline in a script; the original comes from git history

`scripts/fix-juggernaut-glb.mjs` reads the original GLB and writes `public/assets/models/infected/monster_juggernaut.glb`, following the `fix-*-glb.mjs` scripts. It reads and writes the GLB JSON and binary directly, as `fix-gamechar-glb.mjs` does. The original is the file as committed in `900e513`. The script's usage line says how to get it: `git show 900e513:public/assets/models/infected/monster_juggernaut.glb > previews/sources/monster_juggernaut_src.glb` (gitignored, like the crew sources). That way it can always be re-run from the same input.

A `--check` mode rebuilds the model in memory and reports whether the shipped file matches. Tests check the shipped file's properties (D2-D4).

*Alternatives:* fixing it at load in `fx/juggernaut.ts` (every session pays for it, and the fix hides in runtime code); fixing it by hand in Blender (not installed, and it cannot be re-run).

### D2. Face parts: find each part's correction, accept it only if it measures right

For each `details` mesh, the script finds a transform from the mesh's exported space into the body's bind space and bakes it into the vertex positions, normals and tangents. The skin indices and weights stay as they are.

*As built:* the placeholder matrices do not place the parts on their own. They do show which parts belong together: `Object_8` and `Object_10` share a rotation (-83.9° about X) and a scale (130), and `Object_12` and `Object_14` share theirs (-73.9°, 175.7). So each group gets one correction, a least-squares similarity fit (Umeyama) to correspondences from one of its parts:

- **Eyes and teeth.** Each eye's vertices carry one influence each, and their centroid is that eye joint's pivot. Fit scale 0.0398, rotation 0.6°, eyes within 0.5-1.2 cm of their joints. The same correction puts the teeth between the jaws.
- **Tongue and tongue teeth.** The centroid of the vertices blended evenly (weights within 0.4 of each other) between a tongue joint and its parent rings that joint. Fit scale 0.0283, rotation under 0.1°, joints within 5.4-7.2 cm. The tongue lands behind the teeth, with its teeth on its tip.

The four eye centres are coplanar, so the fit's SVD completes the missing singular vector with the plane's normal.

A part is accepted only if it meets all of these conditions:
- in the bind pose, it lies inside the bounds of the body vertices with at least 10% weight on the head or its children, within 2 cm;
- every vertex has a mirror partner across the midline within 1 cm;
- each group's correspondences lie within 2 cm of their joints for pivots, and within 10 cm for rings;
- the upper teeth row is above the lower, both between the lower and upper mouth joints;
- the tongue stays behind the front teeth.

A "mouth cavity" could not be defined from the mesh, so the last two conditions replace the planned check against it. The repaired model was also checked by eye in a scratch viewer: the teeth ring the round mouth, the side tusks sit on the jaw lobes, and the eyes sit in their sockets.

If any part fails, the script writes nothing. The fallback is downloading the original from Sketchfab (CC BY 4.0), with the user's approval first. It does not ship a guessed placement.

### D3. Reparent hands, feet and the head marker; keep the joint list

The script moves `arm3.L/R` under `arm2.L/R`, `leg4.L/R` under `leg3.L/R`, and `head_ik_094` under `head_09`. Each joint keeps its world transform in the pose it is measured in (D4), so the skinned surface does not move. The skin's joint array, its order, the inverse bind matrices of weighted joints, and every vertex's indices and weights stay byte-identical. That satisfies "Repaired creature models stay ready for clips".

The control joints (`*_IK`, `knee_IK`, `elbow_IK`) stay in the file as unweighted joints, now unused. Removing them would renumber the joints.

`head_ik_094`'s offset from the head is taken in the exported pose. Its position at the end of the finale glide is then unchanged, and in every other pose it rides the head. Its inverse bind matrix is recomputed to match. It carries no weight, so this changes no vertex.

### D4. Neutral = bind pose; the exported frame becomes a named pose

The script sets every joint's node transform to its bind pose, recovered from the inverse bind matrices. The model then loads in its modelled stance. It writes the old node transforms into the Juggernaut's pose data as the named pose `exported_rest`: rotation per joint relative to neutral, plus scale where it is not 1 (the tongue's 1.228).

The test for this pose: applying `exported_rest` to the repaired model reproduces the original's skinned body within 1 mm per vertex. If that needs per-joint translations too, the pose format gains an optional translation as well.

*Alternative:* keep the posed frame as the file's rest pose. Every later pose would then be relative to a head turned 31° and a jaw open, and mirrored chains would not mirror.

### D5. Creature definition is data; rig code is generic

`src/data/creatures/juggernaut.json` names:
- the model and its height (5.1 m, measured as today in D9);
- each chain by role: `spine`, `neck`, `head`, `jaw`, `tongue`, `eyes`, `lashes`, `crown`, `fat`, `stomach`, `arm.L/R` (shoulder, upper, fore, hand), `fingers.L/R`, `leg.L/R` (thigh, shin, third segment, foot);
- each joint's limit (D6);
- IK pole hints;
- the look-at split;
- the face's partial poses (D8).

`src/data/creatures/juggernaut.poses.json` holds the named poses. The rotations are XYZ Euler degrees, the same convention as the human pose files.

Both files are validated by a validator in `src/data/types/` in the style of the others. The validator rejects an unknown joint by naming the pose or chain and the joint, rejects missing roles a solver needs, and rejects limits whose minimum is greater than their maximum.

The code goes under `src/actors/creature/`. `rig.ts` holds the joint table, neutral, poses, blending, the evaluation order and clamping. `limits.ts` holds the swing-twist limits. `limbIk.ts` holds the limb solve, which the arms and legs share (D12). `lookAt.ts` holds look-at. `juggernaut.ts` builds the Juggernaut's rig from its data.

*As built:* poses also carry optional per-joint `offsets` (model units, parent frame). The exported frame slides the jaw, the tongue root, the hands and the feet as well as turning them.

### D6. Limits: hinges on one axis, ball joints as swing cone plus twist

There are two kinds of limit:
- **Hinges** (elbow, knee, third leg segment, finger joints, jaw joints) store one axis in the joint's local frame and a minimum and maximum angle.
- **Ball joints** (shoulder, upper arm, thigh, spine, neck, head, eyes, tongue base) store an elliptical swing cone, two half-angles about the bone axis, and a twist range. A swing-twist decomposition applies them.

Each hinge's axis is first measured from the bind pose: the normal of the plane through the joint, its parent and its child. The values are tuned in the sandbox.

Every write (pose, blend, IK, look-at) clamps the joint it writes, so no step can leave a joint outside its limits.

*Alternative:* per-axis Euler minimum and maximum. It is simpler, but a 2 m arm swinging 45° or more runs into gimbal flips.

### D7. One evaluation order per frame

The rig evaluates in this order:

1. neutral;
2. base pose, a named pose or a blend of two;
3. partial face poses (jaw, tongue) at their amounts;
4. per-joint adjustments (`setAdjustment`: the sandbox's joint rotation, and a slot for the motion change's layers);
5. arm and leg IK;
6. look-at;
7. one `updateMatrixWorld`.

Each step writes local quaternions only, and nothing carries over from the previous frame except blend timers. The same inputs therefore always give the same pose, which keeps tests exact and leaves room for the motion change to add layers between steps 2 and 5.

### D8. Jaw and tongue are partial poses with an amount

`jaw_open`, `tongue_extend` and `tongue_curl` are named poses that list only their own joints:
- `jaw_open` lists `lowermouth`, `uppermouth` and `jaw1`-`jaw3` on both sides;
- the tongue poses list `tongue1`, `tongue2`, `tongueup` and both `tongueleft` joints.

An amount from 0 to 1 slerps each listed joint from the base pose toward the partial pose, then the joint's limit clamps it. The teeth follow, because they are already weighted to those joints.

### D9. Finale: the fx module becomes the rig's first user

`src/render/fx/juggernaut.ts` keeps its load, hide, reveal, glide and dispose behaviour from the shader-stalls change. On load it:
1. builds the rig from the data;
2. applies `exported_rest` at once, before the session's warm-up;
3. stops hiding the `details` meshes;
4. measures the 5.1 m scale from the body mesh in that pose, as today. That matters because three.js computes a skinned mesh's bounds from its current pose.

`aimPoint` reads the rig's aim point (`head_ik_094`, now riding the head). The glide, the anchors and `yaw: 95` stay as they are.

### D10. Sandbox

`sandbox/creature-rig.html` and `src/sandbox/creatureRigSandbox.ts` are modelled on the pose bench. The page has:
- the creature on a floor grid with a 1.78 m human silhouette for scale;
- three.js `TransformControls` gizmos for the four limb targets, the look target and each limb's pole;
- a per-chain rotation panel;
- a named-pose list with a blend time;
- jaw and tongue sliders;
- limit drawing (hinge arcs, swing cones);
- per-mesh toggles;
- pause, step and 0.25x-1x controls.

A readout shows each solver's remaining distance to its target and lists the joints resting at a limit. `window.creatureRig` exposes the rig and its state for console checks.

### D11. Count clearcoat maps in the texture budget

`materialTextureUnits` in `src/render/tiers.ts` adds `clearcoatMap`, `clearcoatNormalMap` and `clearcoatRoughnessMap` to its slots. With them counted, the face material needs 8 units, the same as the heaviest lit materials today, so High's lights are unchanged. A test builds the face material the way GLTFLoader does from the shipped GLB's material slots (headless tests cannot decode its images), asserts its count of 8, and checks that High keeps its 6 shadow lights. The session measures its heaviest material before the creature loads, so today the creature's materials do not feed the clamp.

### D12. Limb IK: pure hinges, and a pantograph for three-segment legs

*As built:* `solveTwoBone` aims the lower bone by the shortest rotation, which tilts it off the elbow's hinge, and the limit clamp then pulls the hand off its target. So arms and legs share one solver in `limbIk.ts`:
1. it finds the hinge angle by bisection over the joint's range, so the root-to-end distance matches the target;
2. it swings the root (upper arm, thigh) so the limb points at the target;
3. it rolls the root about that line so the elbow or knee lies on the pole's side;
4. everything is clamped.

A leg's knee and hock turn by the same angle, the hock plus a fixed offset that makes the third segment keep the data's `hock` angle to the thigh. Measured on the model, the thigh and the third segment are 5.8° apart in neutral. This is the pantograph below, solved numerically instead of in closed form, which also copes with legs that are not quite planar.

The original plan follows.

The third segment is held at a fixed angle to the thigh in the bend plane. That angle is taken from the bind pose and is a per-leg value in the data. With it fixed, the hip-to-ankle vector is `T·u + S·v + M·R(θ₀)·u`, where `T` is the thigh's length, `S` the shin's and `M` the third segment's. `(T + M·R(θ₀))·u` has a constant length and a constant angle to `u`, so the chain reduces to a two-bone problem with lengths `|T + M·e^{iθ₀}|` and `S`, solved analytically.

The rig then:
1. recovers the knee and ankle, the knee bending toward the pole and the ankle behind it;
2. sets each segment's rotation;
3. turns the foot so its sole lies on the target's ground normal, within the ankle's limits;
4. clamps.

The foot target is the sole contact point. The ankle target is that point minus the foot vector in the ground's frame.

*Alternatives:* FABRIK or CCD with limits (iterative, can jitter, and the limits fight the iterations); a free three-bone analytic solve (needs an extra rule anyway to fix the ankle's angle).

## Risks / Trade-offs

- [The face parts' correction cannot be found from the file alone] → D2's acceptance checks stop the change before a guessed placement ships. The fallback is the Sketchfab original, downloaded only after the user approves.
- [The bind-pose reset changes how the model looks wherever the default pose is shown] → Only the finale uses the model, and it applies `exported_rest` (D4, D9). The `transit-wing` scenario holds the head marker to within 2 cm.
- [Limits and hinge axes tuned by eye are wrong for poses not yet tried] → They are measured from the bind pose first, then tuned in the sandbox. The motion change will exercise them again and may retune them in data, without code changes.
- [The pantograph leg solve (D12) cannot reach a crouch where the third segment must fold further than the thigh] → The fixed angle offset is data, so the motion change can vary it per gait. A free third segment can be added later as an option without changing the spec.
- [`stop-midgame-shader-stalls` is still in progress and owns `fx/juggernaut.ts`, its test and the warm-up] → This change starts after that one is committed. The program watch must log nothing at the finale reveal with the face parts showing.
- [The sandbox and finale checks need a browser on the shared machine] → Use one tab, `?slot=scratch` where saves are involved, and close it after each check. Run only the touched test files while iterating.

## Migration Plan

1. After `stop-midgame-shader-stalls` is committed, run the repair, ship the new GLB with the rig and data, and update `fx/juggernaut.ts` and its test.
2. To roll back, revert the change's commit. The GLB, the module and the data return together.

## Open Questions

- The final limit values and hinge axes. They are tuned in the sandbox and live in data.
- Whether `exported_rest` also needs per-joint translations (D4). That is found when the repair runs and extends only the pose format's optional fields.

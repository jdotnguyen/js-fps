# Creature rig

Creatures have a rig of their own, outside the 21-joint humanoid skeleton and its body pipeline (spec `creature-rig`, change `rig-juggernaut`). The Juggernaut is the first. It walks and roars (spec `creature-motion`, change `juggernaut-walk-and-roar`); its other set pieces and its fights are later changes. This page covers the model repair, the data, the walk and sequences, and the sandbox.

## The Juggernaut model

`public/assets/models/infected/monster_juggernaut.glb` ("monster juggernaut" by sanyaork, CC BY 4.0) is built from the Sketchfab export by `scripts/fix-juggernaut-glb.mjs`, which:

- **moves the face parts onto the head.** The eyes, teeth, tongue and tongue teeth were exported at another scale, hundreds of units off. The script fits one similarity transform per placeholder group and bakes it into them.
- **attaches the hands and feet.** It moves the hands under the forearms, the feet under the last leg segment, and the aim marker `head_ik_094` under the head.
- **sets the neutral pose.** It sets every weighted joint to its bind pose, the symmetric modelled stance. The exported, posed frame becomes the pose `exported_rest`, which the R16 finale shows.

The face parts must pass the script's checks, or it writes nothing:
- inside the head;
- mirrored across the midline;
- on their joints;
- teeth between the jaws;
- tongue behind the teeth.

Joint names, their order, weighted inverse-binds and every vertex's skin stay as they were, so clips keyed on the original names can still be added. `scripts/lib/juggernautRepair.mjs` holds the details.

The source is the export as committed in `900e513`. To rebuild:

```
git show 900e513:public/assets/models/infected/monster_juggernaut.glb > previews/sources/monster_juggernaut_src.glb
node scripts/fix-juggernaut-glb.mjs            # writes the model, exported_rest and scripts/fixtures/juggernaut-source.json
node scripts/fix-juggernaut-glb.mjs --check    # exit 1 unless the shipped files match a rebuild
```

The fixture records what the tests need about the source: its joints, hashes of its skin and inverse-binds, and its exported joint matrices. `scripts/fixJuggernaut.test.ts` can then check the shipped model without the source.

## Data

`src/data/creatures/juggernaut.json` defines the rig. It is validated by `src/data/types/creatures.ts`, and the rig code in `src/actors/creature/` is generic.

- **`chains`**: joints by role. The solvers need `spine`, `neck`, `head`, `jaw`, `tongue`, `eyes`, `arm.L/R` (shoulder, upper arm, forearm, hand) and `leg.L/R` (thigh, shin, third segment, foot). `lashes`, `crown`, `fat`, `stomach` and `fingers.L/R` gather the rest. Every joint that carries skin is in exactly one chain.
- **`limits`**: one per chained joint, relative to neutral, in degrees.
  - `hinge` has an `axis` in the joint's neutral local frame, a `range` (positive bends further) and `play` (the wobble allowed off the axis).
  - `ball` has `twist` about its `axis` (default local +Y, the bone) and a `cone`: the half-angles of the swing ellipse about local X, with its part along the bone removed, and the bone crossed with that.
  
  Every write is clamped.
- **`ik`**: each limb's `pole` (the direction the elbow or knee bends toward, in the model frame) and each leg's `hock`. The hock is the angle the third segment keeps to the thigh: the knee and hock bend together like a pantograph.
- **`lookNeckShare`**: the share of a look-at turn the neck takes. The head takes the rest, then each eye aims.
- **`face`**: the partial poses that open the jaw and move the tongue.
- **`height`**, **`heightPose`**: the creature is scaled to `height` metres, measured on its body in `heightPose`.

`src/data/creatures/juggernaut.poses.json` holds named poses. Each one gives `joints` (XYZ Euler degrees relative to neutral) and optionally `offsets` (model units, in the parent joint's frame) and `scales`.

- `exported_rest` is written by the repair script; don't edit it by hand.
- `jaw_open`, `tongue_extend` and `tongue_curl` are partial poses. The rig slerps their joints from the base pose by an amount from 0 to 1.

A pose naming a joint that is in no chain fails to load, and the error names the pose and the joint.

Each `update` evaluates in a fixed order, with nothing carried between frames except the blend timer:

1. neutral;
2. the base pose, or a blend into one;
3. the jaw and tongue;
4. per-joint adjustments;
5. arm and leg IK;
6. look-at.

## Walking and sequences

**Walk.** `CreatureGait` (`src/actors/creature/gait.ts`) owns a root object: the creature's ground point and facing. Call `walk(path, speed)` with world points on the floor, then `update(dt)` before `rig.update(dt)` each frame.
- **Steps.** It steps in a diagonal-sequence knuckle-walk: left leg, right hand, right leg, left hand.
- **Plants.** Each hand and foot is planted by the rig's IK for 70% of the cycle, then swings on an arc to where its standing place will be halfway through its next stance.
- **Phase.** The phase follows the distance walked, so plants never slide.
- **Body.** The body bobs (4 cm) and rolls (2°) with the steps.
- **Stopping.** At the path's end, the swings in flight finish, then any limb more than 15 cm from its standing place takes one settling step.
- **Touchdowns.** `onTouchdown(side, point, kind)` fires once per landing.
- **Tuning.** The stride, duty, lifts, bob and roll are in `DEFAULT_GAIT`.

**Sequences.** A pose file's `sequences` are lists of steps. Each step has:
- `pose` (a name, or `null` for neutral);
- `blend` and `hold` in seconds;
- optionally `jaw`, `tongueExtend` and `tongueCurl`;
- optionally `tremble` (degrees on the neck, head and jaw);
- optionally `hands` (0 lets the pose lift the hands off their plants);
- optionally `look` (0 frees the head from the look target).

Amounts are reached over the step's blend. `SequencePlayer` (`src/actors/creature/sequences.ts`) plays them over the walk, because the limbs stay with the gait. A step naming an unknown pose fails when the data loads. The Juggernaut has:
- `roar_walk` (2.9 s, upper body, for the CCTV roar);
- `roar_full` (5.25 s: wind up, rear up with the jaw wide and the hands off the floor, a trembling 2.9 s hold, settle).

**Footfalls.** `juggernautStep` (4 variants) and `juggernautKnuckle` (3) come from `scripts/footsteps-generate.ts` (ElevenLabs; `npm run footsteps:generate -- --id juggernaut-step-1`). The finale plays them on each touchdown.

**The finale.** `src/render/fx/juggernaut.ts` drives the gait and the sequences: `reveal` walks the creature from the hide anchor to the reveal anchor at 0.9 m/s (about 5.2 s with the start and the settle), and the event `transit:juggernaut_act` plays a sequence. `docs/PLAYTEST.md` has the R16 finale check.

## Sandbox

`/sandbox/creature-rig.html` on the dev server (`npm run dev`) shows the Juggernaut in its neutral pose beside a 1.78 m figure. `?view=face` starts on its face.

- **Drag:** pick a handle (a hand, a foot, the look target, or a limb's pole) and move it with the gizmo. Tick it under **Targets on** to make the rig follow it.
- **Pose:** blend into a named pose over the given seconds.
- **Face:** jaw, tongue out, tongue curl.
- **Rotate a joint:** pick a chain and a joint, then turn it on X, Y and Z. **limit** draws its range (a hinge's arc or a ball joint's cone).
- **Parts:** show or hide the body, eyes, teeth, tongue and tongue teeth.
- **Walk and act:** **Walk to look handle** walks the creature at the given speed to a body length short of the look handle. **Play** runs a sequence (`roar_walk` over a walk, `roar_full` standing). **Stand still** gives the limbs back to the handles.
- **Time:** pause, step one 1/30 s frame, play at 1x, 0.5x or 0.25x.

The readout shows how far each solver is from its target, whether the creature is walking, how many footfalls it has made, and which sequence is playing. It also lists the joints resting at a limit. From the console, `window.creatureRig` has the rig, the creature, `motion`, `select(joint)` and `view('full' | 'face' | 'faceSide')`.

Tune limits and hinge axes in the data while watching the sandbox, then run `npm test -- src/actors/creature/*.test.ts src/data/creatures/juggernaut.test.ts`. The tests check that the exported pose stays inside every limit. Close the tab when you are done.

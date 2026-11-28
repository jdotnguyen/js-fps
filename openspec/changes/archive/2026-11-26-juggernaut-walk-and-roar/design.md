# Design

## Context

`rig-juggernaut` gave the Juggernaut a creature rig (`src/actors/creature/`). It has named poses with blends, jaw and tongue amounts, per-joint adjustments, limb IK that plants a foot's sole on a target with the knee and hock as a pantograph, and look-at. Its neutral pose is a knuckle stance: the fists rest on the floor, each wrist 1.6 m up, and each hand can be planted from 1.2 m behind to 0.6 m ahead with the torso upright. `src/render/fx/juggernaut.ts` scales it to 5.1 m, holds `exported_rest` and glides its root between two anchors.

On CAM 10 today (`src/data/sequences/action_climax.json`):
1. the feed cuts in;
2. 1.15 s later the creature appears and glides for 5.2 s;
3. 1.75 s after it appears, the CCTV roar (4 s) starts;
4. 4.65 s after it appears, the scene cuts to black;
5. the 5.5 s roar plays in the dark and black holds for 6 s;
6. `story:cliffhanger`.

The squad's scripted fire is 13 bursts 0.32 s apart, starting just before CAM 10.

## Goals / Non-Goals

**Goals:** a gait that later fights can drive along any path; set pieces as data; the finale walking and acting both roars with a hard cut after the second.

**Non-Goals:** turning on the spot, running, uneven ground (the ground is a flat height for now), breathing and flesh springs, the other set pieces, squad choreography beyond holding fire.

## Decisions

### D1. The gait owns the creature's root and its limb targets

`CreatureGait` (`src/actors/creature/gait.ts`) moves a root object along a path (a polyline in world metres at ground height) at a speed, facing along it. It owns the root's position and yaw. Each frame it sets the rig's four limb targets. A planted limb keeps its world target; a swinging limb follows an arc.

The body's bob is an offset on the root's height, and its roll is a small rotation of the root about its forward axis. Because the limbs are planted by IK to world points, moving the root bends the limbs without sliding them.

*Alternative:* root motion baked into poses. That would need authored clips per speed, and the planted feet would drift on any path but the authored one.

### D2. Diagonal-sequence knuckle-walk, phase-driven

One cycle covers four landings. The limbs' phase offsets are: left leg 0, right hand 0.25, right leg 0.5, left hand 0.75. Each limb is planted for a duty factor of 0.7 of the cycle and swings for the rest. The cycle time is the stride divided by the speed, with a stride of 1.2 m per limb.

A swinging limb lands where its standing place (its neutral contact point, held relative to the root) will be halfway through its next stance. That keeps each plant centred under its hip or shoulder. The swing eases forward and lifts on a sine arc: 0.25 m for feet, 0.3 m for hands. The phase advances with the distance walked, not with time, so the limbs never slide when the speed changes.

### D3. Start and stop

A walk starts with every limb planted at its standing place and the phase at 0, so the left leg lifts first. When the path's end is reached:
1. the root stops;
2. limbs in flight finish their swing, landing at their standing place;
3. any planted limb more than 15 cm from its standing place takes one settling step there, in the gait's order;
4. then the gait reports that it is standing.

### D4. Touchdowns as callbacks

`onTouchdown(limb, point, kind)` fires once per landing, at the moment the swing ends. `kind` is `'foot'` or `'hand'`. The finale plays a footfall or knuckle thud there.

### D5. Pose sequences in the pose file, played over the gait

`juggernaut.poses.json` gains `sequences: { name: Step[] }`. Each step has:
- `pose` (a name, or null for neutral);
- `blend` and `hold` in seconds;
- optional `jaw`, `tongueExtend` and `tongueCurl` (0..1), ramped over the blend;
- optional `tremble` in degrees.

The validator checks that every named pose exists.

`SequencePlayer` (`src/actors/creature/sequences.ts`) calls `rig.setPose(pose, blend)` at each step. It ramps the face amounts, and drives the tremble as adjustments on the neck, head and jaw: summed sines at unrelated frequencies, seeded so tests are exact. When the sequence ends it leaves the last pose held.

Base poses move the spine, neck, head and shoulders. The limb IK then overrides the arms and legs, so an upper-body roar plays over a walk without breaking the plants. The gait's roll and bob are on the root, so they don't collide with the roar.

The Juggernaut's sequences:
- **`roar_walk`**, about 2.9 s: the head lifts and the jaw opens to the CCTV roar, upper body only. That roar is loud for its first 2.0 s.
- **`roar_full`**, about 5.25 s: `roar_windup` (head down, shoulders up) 0.6 s, then `roar` (chest up, head thrust forward and up, arms out and hands off the floor, jaw 1, tongue 0.6) held 2.9 s with a 2.5° tremble, then `roar_settle` (head lowered in a growl, jaw 0.3). The long roar is loud only for its first 3.3 s, then fades into its reverb tail. The hold covers the loud part, and the cut lands before the settle shows.

*As built:* a step can also set `hands` (how firmly the hands keep their IK plants, 0..1) and `look` (how much the head follows the look target). The roar lifts the hands off the floor and frees the head from the look-at, then puts both back as it settles. The limb solver and look-at gained a weight for this.

### D6. The finale drives the gait and the sequences through events

`Juggernaut.reveal(hide, peek)` places the root at the hide anchor and walks it to the peek anchor. The speed is chosen so the walk, its start and its settle take about 5.2 s. The head looks at the squad's midpoint.

A new event, `transit:juggernaut_act { sequence }`, plays a sequence. `Juggernaut.update(dt)` steps the gait, the sequence and the rig. Touchdowns call back into `session.ts`, which plays `juggernautStep` or `juggernautKnuckle` as plain one-shots. The CCTV feed is the listener here, as it is for the roars.

### D7. CAM 10 beats

The new order:
1. CAM 10 cuts in; wait 1.15 s.
2. Reveal: the walk starts.
3. At +1.75 s: `r16MonsterRoar` and `roar_walk`. Also a second scripted fire volley (12 bursts at the face anchor), so the shooting covers the whole walk.
4. At +5.3 s (walk settled): `roar_full` starts. A third volley (13 bursts, `gain: 0.6`) keeps the shooting going under the roar. Giles screams `r16_giles_05` ("What the hell is that?!").
5. At +6.05 s, as the jaw opens: `r16MonsterRoarBlackout`.
6. 3.3 s later, on the roar's last loud beat: fade to black, CAM 10 off, the creature hidden, the lights off, every bus hushed.
7. Wait 1 s, then `story:cliffhanger`, about 10.4 s after the reveal (10.8 s before).

At +6.3 s, over the roar, Okafor screams `r16_okafor_04` (an overlapping line).

The exact waits are tuned by ear and eye on the feed.

*As built, after review:* the user asked for the squad to keep firing through the long roar, quieter so the roar overpowers it, and for Giles and Okafor to scream "What the hell is that?!". So:
- **Quieter fire.** `squad:scripted_fire` takes an optional `gain`, carried on each `squad:fired` shot and multiplied into the squad gunshot's level.
- **The screams.** Two radio lines, emote `scream`, line gain 0.8, recorded on each speaker's pinned Gemini model (`gemini-2.5-flash-preview-tts`; Algenib and Charon) and passed by the local word check.
- **Stop.** `bursts: 0` still stops a volley, but the finale no longer uses it.
- **Second review: yells, a retreat, slower and quieter fire.** The first takes, with the `scream` emote, came out breathy and quiet. The lines are now "What the fuck is that?!", with the `urgent` emote, direction asking for a full-voice yell, and line gain 1.3. Measured, the new takes sit higher in pitch and brighter than the old ones, like the squad's other shouts. Both yell before the long roar, Okafor 0.45 s after Giles.

  All three finale volleys now fire 0.65 s apart: 0.6 gain for the first two, 0.4 under the roar.

  The squad backs away 1.6 m at 0.3 m/s as it walks out (`npcMoveTo` with `face: "aim"`, to the top of the R16a stairs). This adds:
  - **`face` on `npcMoveTo`.** `"aim"` is the body's live aim target; any other value is a target reference.
  - **`face` on `Humanoid.steer`.** The body turns toward that heading while moving along the path.
  - **`Humanoid.backward` and `Animator.reverse`.** The walk cycle runs backward, so the feet step back.
  - **No snap on a moving mate.** A volley no longer snaps a moving mate's heading.
- **The hush lets them through.** The hush before the CCTV roar (which cuts the score) now names `speakers: ["engineer", "medic"]`. A hush with no speakers lets nobody be heard and drops their lines, and the sequence tests could not see that. `action.test.ts` now checks that the latest hush before each scream lets its speaker through.

### D8. Footfalls from the footsteps pipeline

`scripts/footsteps-generate.ts` gains entries for 4 heavy, wet creature footfalls (`juggernaut-step-1..4`) and 3 knuckle thuds (`juggernaut-knuckle-1..3`). Like the other footsteps they are dry, trimmed and peak-matched. They are registered in `src/audio/sounds.ts` as `juggernautStep` and `juggernautKnuckle`, and generated with the user's agreement (ElevenLabs credits).

## Risks / Trade-offs

- [The walk looks mechanical] → The stride, duty, lift, bob and roll are constants in one place, tuned in the sandbox. The finale shot is short, and the face is what is lit.
- [Hands or feet reach their limits mid-stride] → A 1.2 m stride fits within the measured reach. The gait tests check that planted limbs stay within 2 cm.
- [The roar on camera is less eerie than in the dark] → This was the user's request. The hard cut and silence keep the shock.
- [The CAM 10 shot runs about 8 s longer] → The music and stinger follow `story:cliffhanger`, which only moves later.

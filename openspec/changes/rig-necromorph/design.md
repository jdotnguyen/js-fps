# Design

## Context

See `proposal.md` for the motivation. The creature is the `necromorph` entry in `src/data/body-models.json` (`necromorph_slasher.glb`, unchanged since `822dddf`: 67 joints, one welded skinned mesh, meshopt and quantized). It is worn by the `lab_creature` look (the Lab B drop, R06, R08; 1.85 m), the `flood_elite` look (R10; 2.15 m, build 1.25) and the hero tier (R11; `HERO_MODEL` in `enemyDirector.ts`). All are `Humanoid` bodies.

Measured with the game's own preparation code, at the 1.78 m reference height unless noted:

- **Preparation.** `prepareBodyModel` folds the rig onto the 21 game joints. Three neck joints become `neck`, three spine joints become `spine` and `chest`, and the belly arms (36 bones, 28 of them weighted) ride `spine` rigidly. It then stands the model upright with the arms hanging.
- **Jaw.** No bone is named for it and the `jaw` joint carries no weight. The lower jaw is modelled as a visible loop below the skull.
- **Authored stance.** The file's node pose is a crouch with both blades raised overhead. The bind pose is a T-pose. Preparation discards the node pose.
- **Arms.** Forearm 0.48 m (human reference 0.26 m). The blade runs about 0.63 m past the hand joint, which sits at its root. The belly arms reach 0.6 m forward.
- **Feet.** The ankle rests at 0.172 m. `footIk.ts` plants every ankle at 0.065 m. Its foot IK runs only for a body near the camera, and there the lowest point sat 5-11 cm below the floor standing and at 3.2 m/s; away from the camera it stayed within 1.3 cm. Placing each frame's ankle at 0.172 m (scaled) puts the lowest point within 2 cm of the floor in every case measured (`src/actors/blade/measure.test.ts`).
- **Hit shapes.** `buildCapsules` uses the human reference capsules, so the forearm shape ends about halfway and the blade has none.

Driving today:

| Use | Role | What animates it |
| --- | --- | --- |
| Lab B drop | npc, infection 0 | human get-up poses, human walk capture, Voss's `kill_glass_*` poses to pound |
| R08 | npc, in a kill | `maul_*` poses over the procedural human walk |
| R10 scream | npc | idle; only the sound plays |
| R10 charge | npc, infected | procedural human walk |
| R06 | enemy | shamble capture and the infected layers |
| R11 | enemy, hero | `heavy` gait and `slam*` poses |

Bodies are limited to `MAX_BONES` 96. The creature needs about 61 (21 joints, 9 stumps, about 31 detail bones).

## Goals / Non-Goals

**Goals:**
- One creature profile, attached to the body model, that every appearance picks up without its scene asking.
- Other bodies behave exactly as before: every new path is reached only through a profile.
- Rig, pose and motion work that can land without touching files other open changes hold.
- Everything about the creature's look tunable in data and judged in a sandbox.

**Non-Goals:**
- The creature rig of `rig-juggernaut`, or any edit under `src/actors/creature/` or `src/data/creatures/`.
- Captured or downloaded animation, and recovering the model's 19 dropped clips.
- New sounds, ragdolls, AI, damage or health changes, new scene timings, textures.

## Decisions

### D1. Stay a humanoid body and add a creature profile

The creature keeps the 21-joint skeleton. A new data file, `src/data/blade-creature.json`, holds its profile: detail bones, pose map, gait, ankle height, hit shapes, jaw range, blade geometry and performances. `body-models.json` names the profile on the `necromorph` entry. Code lives under `src/actors/blade/`. The word "blade" keeps it apart from the non-humanoid creature rig.

*Alternative:* move it to the `rig-juggernaut` creature rig. That rig is deliberately outside the humanoid pipeline, so severing (which R10 uses on both forearms), hit regions, crawling, kills, enemy AI and ragdolls would all have to be rebuilt.

### D2. Repair the model offline, only for what the file lacks

`scripts/fix-necromorph-glb.mjs`, using `@gltf-transform`, reads the source (`git show 822dddf:public/assets/models/infected/necromorph_slasher.glb > previews/sources/necromorph_slasher_src.glb`) and writes the shipped file with the same compression. It adds one joint, `Jaw`, under `Head_013`, pivoted at the back of the lower jaw, and moves head weight to it for the mandible's vertices, with a smooth falloff at the hinge. `mapRig` already maps a bone named `jaw` to the `jaw` joint, so no mapping code changes. A `--check` mode reports whether the shipped file matches.

The mandible is chosen by a region in bind space written in the script. Acceptance: only vertices that already carry head weight change; at 30 degrees open no edge of 3 mm or more passes 2.5 times its length. If the welded seam cannot meet that, the script splits the seam's vertices. If that fails too, stop and ask.

*Alternative:* assign jaw weights at load. Every session would pay for it and the fix would hide in runtime code.

### D3. Detail bones for neck, spine and belly arms

Preparation gains a profile option beside `detailHands`, producing two more kinds of detail bone in `ExtraBoneDef`:

- **segment**: an extra neck or spine bone that takes a set share of its game joint's rotation, spreading bends (the existing "Twist and spine segments share the motion" requirement);
- **limb**: a belly-arm bone with its own parent chain, rooted on the host joint chosen by today's boundary-weight rule, and posed by the profile.

All 28 weighted belly bones are kept. Triangles still belong to a game joint, so severing and gore are unchanged. Limb bones are driven by a seeded, deterministic layer: idle twitch and grasp, with named amounts for flare and clench.

*Alternative:* add belly-arm joints to the shared skeleton. Every body, pose file and test would carry them.

### D4. Keep the rest pose; express the stance as poses

The shared rest pose (upright, arms hanging) stays, because poses, foot IK and hit shapes are defined from it. The authored node pose is retargeted once, by a helper in the repair script that prints joint angles, as the starting values for two poses: `blade_scream` (blades overhead, as authored) and `blade_stance` (the same crouch with blades lowered to the ready).

The profile holds a **pose map** from generic names to creature poses (`idle`, `hulk`, `shamble`, `stare`, `getUp_0..2`, `maul_*`, `kill_glass_0/1`, `slamWindup`, `slamImpact`, `pry_*`, and the attack poses). The map is applied where a body looks a pose up, so scene data, `kills.json` and AI keep naming what they name today, and a victim in `kill_glass_0` is unaffected. New poses are `blade_*` entries in `poses.json`. A missing mapped pose logs once and uses `blade_stance`.

*Alternatives:* rename poses in the scene data (conflicts with open changes, and every future scene must remember); change the creature's rest pose (breaks the pose convention).

### D5. Arms raised from a hanging rest

Preparation bakes the arms 90 degrees down from the bind pose, and raised poses rotate them back through linear skinning, which can pinch the shoulders.

*As measured* (`src/actors/blade/shoulders.test.ts`, on the 2.15 m body): with the model's own weights, an upper arm raised sideways up to 140 degrees from hanging, or swung forward up to about 100 (95 forward and 35 out together), keeps every edge of 3 mm or more within 2.5 times its length. Past that, short edges behind the shoulder tear: 2.51 at 110 forward, 2.77 at 165 forward. Smoothing the chest, collar and upper-arm weights round the shoulder (several radii and pass counts) and sharing the raise with the collar each helped one direction and made another worse, so neither is used.

So the weights stay as they are, and the creature's poses keep the upper arm inside that envelope. Height comes from the elbow: with 1.1 m of forearm and blade, an upper arm raised sideways to 120-140 degrees and the elbow bent up puts both blade tips well above the shoulders, which is what the scream needs (spec "A full scream"). Task 5.1 adds a test that every `blade_*` pose's upper arms stay inside the envelope.

*Alternative kept in reserve:* a rest arm angle of the profile's own (arms out, as bound). It costs every unmapped pose (corpses, crawling) a 90-degree offset, so it is only worth it if the envelope proves too tight in the sandbox.

### D6. A creature motion layer replaces the human ones

For a profiled body the animator never turns on motion capture, idle life, speech acting, the human walk, shamble, flail and heavy gaits, or the infected "broken limb" skew. In their place, `src/actors/blade/motion.ts` gives:

- **idle**: breathing, weight shifts, head snaps, jaw slack;
- **prowl** below about 2 m/s and **charge** above about 2.5 m/s, blended between, with stride length set from ground speed so planted feet hold, contacts fed to `FootIkSolver`, and the footfall flag raised as the heavy gait does (R11 stomps);
- **attacks**: the existing `charge` value and the slam phases drive blade windups and strikes with today's timings.

Crawl and drag stay the shared gaits, with the pose map covering their poses. The layer is deterministic from the body's seed and time.

### D6a. Footing the scenes can see

How R08 and R10 drive the creature today undoes a ground-matched gait unless three things change:

- **Foot IK runs for the creature in kills and at any distance.** `Humanoid.solveIk` resets the foot IK while a kill runs, and `FootIkSolver` runs only for a body near the camera. In R08 the creature is in the kill from its spawn, and in R10 it charges from far down the hall, so neither scene would plant its feet. For a profiled body the foot IK stays on during a kill, and its `near` gate is lifted. The cost is one solve a frame for one body; the kills that move the victim or the attacker by script (grip, haul, throw) only place the root, which the IK follows like a walk.
- **A slowed step lengthens the stride.** R08's kill sets `gaitRate` 0.6 for the rush so the steps read as heavy. For a profiled body `gaitRate` scales the stride length the other way (stride / rate), so the cadence slows while the feet keep up with the ground. Other bodies keep today's behaviour.
- **Turns and starts are stepped.** When the creature turns faster than its stride can absorb, at low speed or standing, the layer runs a short turn cycle: each foot lifts and is placed round toward the new heading, the swing foot first. Starting from a stand ramps the stride over the first step; stopping finishes the stride in progress and takes a settling step so both feet end planted.

*As built:* the gait tracks each planted foot against the body's actual movement each frame (the body reports how far it moved and turned), so the animated foot stays where it landed through braking and corners. A foot that ends up out of reach takes a quick corrective step (0.22 s) instead of dragging. The foot IK holds a planted creature foot where it landed (`holdPlanted`, up to 0.45 m) instead of settling it toward the animated foot. A slowed step rate lengthens the stride only up to 3.6 m, a bounding leap: past that, at R08's 0.6 a foot hung in the air across the whole rush. No leg joint turns faster than 900 degrees a second, so lift-offs and settles never snap.

The R08 check walks the creature along the scene's actual marks and speeds (`r08_lurk` through the rush, the haul to the cart and the walk back) in a Node test with the kill's `gaitRate` and grip, and measures planted-foot slide and sinking every frame. The R08 attack was sped up: the whole approach and the walk back now run at 7.2 m/s (only a stare drops the approach to 1.4), and the carry at 1.35. The test drives the creature through the real NPC movement (`NpcActor.moveTo`, its acceleration and turn rate) at those speeds, not its own steering.

### D6b. A body that moves with its steps

Feet that hold the floor are not enough: a body carried at a steady speed and height over them glides. The gait drives the body from the step cycle:

- **Bob:** the pelvis drops onto each landing (weight taken on a bent knee) and rises through the stride; in the charge it also rises through the flight phase. The leg solve includes the bob, so the planted knee bends to absorb it rather than the foot leaving the floor.
- **Surge:** the pelvis is pushed forward on each push-off and held back on each landing, a few centimetres, over the body's steady travel.
- **Weight transfer:** the hips roll and turn over the planted leg; the trunk pitches forward on each landing and the head counters it.
- **Clearance:** each swinging foot lifts well clear (a high, deliberate step in the prowl; a long, tucked swing in the charge).
- **Follow-through:** the blades swing against the legs, lag behind the body's movement and jolt on each landing; the belly arms flail with the impacts.
- **The charge** (from about 2.5 m/s) is far more violent: lower, longer, with bigger bob, roll and blade pumping. This is what R10 shows as the elite tears up the hall.

Each is tuned in the sandbox from contact sheets (a follow camera, a grid of frames over a stride), and held by the spec's "Not gliding" test.

### D6c. The charge throws water (R10)

The creature reports its own footsteps from its foot contacts: a heavy stomp on each landing, and a lift on each foot leaving the ground. Each carries a splash amount that grows with speed. `WaterDisturbances.footstep` takes the amount: a landing churns the surface harder and throws a new large `stomp` spray at any depth (a person's step throws only a small spray, and none past 0.35 m), and a lift throws a `kick` spray as the leg tears out of the water. R09's water is about 0.75 m deep where the elite screams, so without this its whole charge would throw nothing. The two sprays get their sound in the session's splash table.

### D7. Footing and hit shapes from the profile

`FootIkSolver` takes the ankle height as a parameter, 0.065 by default. The profile gives the creature's, measured from the prepared model. A first check confirms this is the cause of the sinking before anything else changes.

The profile replaces the capsules for `foreArm_*` and `hand_*` (forearm to the blade root, then a thin tapered shape along the blade, both region `foreArm_*`) and refits head, torso and legs. The blade root and tip are stored in hand-joint space at preparation, for hit shapes, contact tests and grips. Longer shapes make forearms easier to hit and let a raised blade shield the torso, so the R06 and R11 fights are simulated before and after. If a fight stops resolving or its length changes by more than a quarter, the blade shape is narrowed first.

### D8. Screams are timed performances

A performance is a short timeline in the profile (phases with pose, blend, hold, jaw amount, tremor and belly flare) played by the animator over the current stance, ended by `setPose`, a move or a skip. `scream` runs coil, rear, held shake and settle, with the hold stretched to a requested length.

- R10: `action_tunnel.json` gains an `npcAnim` `scream` beside the `creatureScreamFar` step. The following `npcMoveTo` cuts it into the charge.
- R08: the `still` beat gains an attacker performance event at the scream's time. It ends before the walk at 3.4 s.

`npcAnim` and the kill event accept a performance name only for a body that has it; otherwise they warn once and do nothing.

### D9. Blade contact in scenes

- **Impale.** A `grip` event takes an optional `blade` fraction (0 is the root, today's behaviour). The impale uses about 0.4, so the blade runs through her; the head slams stay at the root. The impale and carry poses and the kill's reach are tuned together so her chest meets that point without exceeding today's grip step limits.
- **Pounding.** The strike point and the sound come from the blade, and the profile gives the standing distance from the pane, so the tip lands on it.
- **Clearance.** A test helper samples both blade segments each frame against the level's colliders in headless runs of the three scripted scenes. Doorways are handled by a pose amount the profile raises near a door or low ceiling. Fixed poses are tuned to fit; no runtime arm solver is added.

### D10. Sandbox

`sandbox/blade-creature.html` with `src/sandbox/bladeCreatureSandbox.ts`, modelled on the pose bench: the creature at 1.85 m and 2.15 m beside a 1.78 m figure, buttons for every pose, gait speed, attack, performance and jaw amount, hit shapes, blade points and floor, and pause, step and speed. `window.blade` exposes it for console checks.

## Risks / Trade-offs

- [The welded jaw seam tears when opened] → D2's acceptance test, seam splitting, then ask.
- [Raised arms pinch the shoulders] → D5 measures first and has two fallbacks.
- [A 2.15 m body with raised blades is estimated at 3.4 m to the tips, taller than a 3.2 m room] → The stance is set under the ceiling, the scream's arm height is per-size data, and the clearance test covers R10.
- [Longer hit shapes change combat feel] → D7's simulation and a hand playtest of both fights.
- [`limbContact` self-collision pushes the long arms off the torso hull] → Check in the sandbox; the profile can turn it off for this body.
- [A severed forearm with a 0.63 m blade behaves badly as debris] → Check the R10 sever with physical interaction on; the debris shape is derived from the piece and may need the blade shape.
- [Open changes hold `npcKills.ts`, `npcs.ts`, `kills.json`, `types/kills.ts` and `action.test.ts`] → Groups 2-5 avoid them; group 7 starts only when `adopt-physics-engine` and `livelier-cart-slam` work there is committed.
- [Browser checks on a shared machine] → One tab, `?slot=scratch`, closed after each check; run only touched test files while iterating.
- [The model's provenance may not support its licence] → Raised with the user before release. The profile is keyed by bone name, so a replacement model needs a new profile and poses, not new code.

## Migration Plan

1. Rig, sandbox and motion land first; each is visible only on the creature.
2. Scene wiring lands after the open changes are committed.
3. Rollback is reverting the change's commits; the model, profile and code return together.

## Open Questions

- The final pose angles, gait timings and performance holds. They are data, tuned in the sandbox with the user's eye.

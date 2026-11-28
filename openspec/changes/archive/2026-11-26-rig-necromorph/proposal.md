# Proposal

## Why

The blade creature that bursts out of Voss, kills Priya and charges the R10 door moves like a stiff man holding two poles. It is the Necromorph Slasher body, forced into the human rig and driven by human poses and walks:

- It has no jaw, so every jaw movement authored for it does nothing.
- Its belly arms (36 of its 67 bones) are frozen to the torso.
- Its modelled attack stance is thrown away: the game stands it upright with its blades hanging.
- Its feet sink 5-11 cm into the floor.
- When it screams down the R09 hall it just stands idle. After that it charges with a human walk.

## What Changes

- **Repaired model.** A repair script rewrites `public/assets/models/infected/necromorph_slasher.glb` so the lower jaw opens on its own bone.
- **Creature rig on the shared skeleton.** The body keeps the 21 game joints, so severing, kills, combat and gore work as now. On top of them:
  - the jaw opens;
  - extra neck and spine segments curve the back and neck;
  - the belly arms move on their own bones;
  - the feet are planted at the creature's own ankle height;
  - hit shapes fit the long forearms and blades.
- **Its own stance and motion.** One stance, prowl, charge and set of attack poses, based on the model's authored attack pose. It never plays human captured motion or human walk cycles.
- **Believable footing in every scene.** Its feet stay planted while a kill runs and when it is far from the camera, as in R08 and the R10 charge. It steps round when it turns on the spot, and takes a step or two to get going and to settle. Where a kill slows its steps, it lengthens its stride instead of skating.
- **Visible screams.** It rears, opens its jaw and screams down the R09 hall in R10, and over Priya's body in R08.
- **Staging in all five appearances.** The Lab B drop, the R06 fight, Priya's death in R08, the R10 charge and pry, and the R11 fight all use the new body. Its blades strike the Lab B glass and run through Priya where they are drawn. Scene routes, speeds and timings stay.
- **Review sandbox.** A new `/sandbox/blade-creature.html` page plays each stance, gait and performance, so the creature can be judged by eye.

## Capabilities

### New Capabilities
- `blade-creature`: how the four-armed blade creature looks and moves wherever it appears. It covers its stance, gaits, jaw, belly arms, footing, blade contact and clearance, screams, hit shapes and review sandbox.

### Modified Capabilities
- `imported-body-models`: a secondary limb may move on its own bones, relative to the body part it grows from.
- `infection-kills`: the creature behind the Lab B glass strikes it with its blades.
- `medbay-attack`: the blade goes through Priya, and the creature screams over her body before it leaves.
- `flooded-tunnel`: the far scream is seen as well as heard, and the charge uses the creature's own run.

## Impact

- **Model and tools:** `necromorph_slasher.glb`, a new `scripts/fix-necromorph-glb.mjs`, `CREDITS.md` (the changes made to the model).
- **Code:** `src/actors/bodyModel.ts`, `bodyModelLibrary.ts`, `bodyGeometry.ts`, `humanoid.ts`, `animator.ts`, `footIk.ts`, new modules under `src/actors/blade/`, and `src/ai/npcKills.ts` and `npcs.ts`.
- **Data:** a new `src/data/blade-creature.json`, new `blade_*` poses in `src/data/poses.json`, and small edits to `kills.json` and `sequences/action_tunnel.json`.
- **Gameplay:** the creature's hit shapes change, so the R06 and R11 fights need a balance check.
- **Order with other work:**
  - `adopt-physics-engine` and `livelier-cart-slam` have uncommitted or pending work in `npcKills.ts`, `npcs.ts`, `kills.json` and `types/kills.ts`. The rig and motion work can start first; the kill and scene work waits for both.
  - `rig-juggernaut` is a different creature on its own rig. This change does not use or edit `src/actors/creature/` or `src/data/creatures/`.
- **Not in this change:** new sounds, enemy AI, damage or health values, ragdolls, captured or downloaded animation (including the model's 19 dropped clips), and a replacement model.
- **Open risk:** the model's names suggest it may come from a commercial game, in which case its CC BY 4.0 label may not hold. This needs checking before release.

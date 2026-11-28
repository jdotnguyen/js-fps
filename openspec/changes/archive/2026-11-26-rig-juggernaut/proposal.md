# Proposal

## Why

The Juggernaut will recur through the game and be fought later, but today it is a statue that glides 3.4 m across CAM 10. Its GLB (sanyaork, Sketchfab) carries a 137-joint skeleton that cannot be used as it is:

- Its eyes, teeth and tongue are bound hundreds of units off the body, so the game hides them.
- Its hands and feet hang off IK control bones that the file has no solver for.
- Its resting pose is a posed frame, with the head turned about 31° and the jaw open, not its neutral stance.
- It has no animations.

Motion, attacks and encounters all need a sound rig first.

## What Changes

- **Repaired model.** A repair script rewrites `public/assets/models/infected/monster_juggernaut.glb` so that:
  - the eyes, teeth and tongue sit on the head and follow its bones;
  - each hand rides its forearm and each foot rides its shin;
  - the head marker the squad aims at rides the head.
  
  Joint names, the skin and the body's 5.1 m scale stay as they are, so hand-keyframed clips can still be added later.
- **Creature rig.** A new rig of its own sits outside the shared 21-joint humanoid skeleton and its body pipeline. It provides:
  - named chains for the spine, neck, head, jaw, tongue, eyes and eyelashes, the crown spines, the fat folds and stomach, both long arms with their fingers, and both three-segment legs;
  - joint limits;
  - a symmetric neutral pose taken from the bind pose, plus named poses stored as data;
  - limb IK that keeps elbows, knees and hocks pure hinges, shared by the arms and the three-segment legs, planting each foot;
  - head and eye look-at, jaw opening and tongue posing.
  
  The Juggernaut is its first user, and the contract is generic enough for later creatures.
- **Finale kept as it is.** The R16 finale still glides, but its creature is now driven by the rig. It holds the file's original pose as a named pose, so the framing is unchanged apart from the restored eyes, teeth and tongue. The squad's aim follows the real head.
- **Creature sandbox.** A new `/sandbox/creature-rig.html` page lets you pose every chain, drag the hand, foot, head and eye targets, and step through the named poses. It also shows joint limits and toggles the face parts, so the rig can be judged by eye.
- **Credit.** `CREDITS.md` names the model's author (sanyaork) and its Sketchfab page.

**Follow-up changes, not part of this one:**

1. **Juggernaut motion:** code-driven motion on this rig. That covers walking and knuckle-walking with planned, planted steps, turning, breathing, flesh springs and face life. It also covers set pieces stored as key-pose data (roar, swipe, slam, peek, lunge) and a step-out for the finale in place of the glide.
2. **Juggernaut encounters:** combat AI, pathfinding at giant scale, damaging attacks, weak points and hit volumes, hit reactions, and physics bodies (after `adopt-physics-engine`). It also covers new arena-scale spaces, because the Juggernaut stays 5.1 m and does not enter the standard 3.2 m rooms or 2.0 m doors.

## Capabilities

### New Capabilities
- `creature-rig`: rigs for non-human creatures kept outside the humanoid skeleton. It covers repairing an imported creature model, named joint chains and limits, neutral and named poses, limb IK and look-at, and a sandbox for judging the rig. The Juggernaut is the first creature.

### Modified Capabilities
- `transit-wing`: the CAM 10 face reveal shows the Juggernaut with its eyes, teeth and tongue in place, and the squad's flashlights follow its real head.

## Impact

- **Model and tools:** `public/assets/models/infected/monster_juggernaut.glb`, a new `scripts/fix-juggernaut-glb.mjs`, and `CREDITS.md`.
- **Code:** a new creature rig module and Juggernaut rig definition under `src/actors/`, and `src/render/fx/juggernaut.ts`, which becomes the rig's user.
- **Sandbox:** a new `sandbox/creature-rig.html` and `src/sandbox/creatureRigSandbox.ts`.
- **Tests:** colocated tests for the repair, the rig and IK, and the Juggernaut module.
- **Depends on `stop-midgame-shader-stalls`.** That change is in progress and not yet committed. It moved the creature into `src/render/fx/juggernaut.ts` and loads it with the session (its D4). This change starts once that work is committed. The restored face material must join the session's shader warm-up.
- **Rendering budget:** the restored face material binds a clearcoat normal map, which `materialTextureUnits` (`src/render/tiers.ts`) does not count yet. Counted properly, it needs 8 units: 5 maps, the clearcoat normal, `dfgLUT` and the scene environment. That matches the heaviest lit materials today, so High stays at its 16 with nothing to spare. Nothing on High has to give way, but the counter must learn the clearcoat maps.

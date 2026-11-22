# Proposal

## Why

Every character in Thalassa moves the same way. All bodies run on one 21-joint skeleton and one 10-clip library (`src/data/mocap-clips.json`, a single Quaternius performer), so Giles, Okafor, Priya and every crew member share the same idle, walk, jog and talk. The only differences are formal vs normal walk and seeded procedural fidgets. Priya's cast entry already points at her own clips, but none have been baked. For a game aiming at immersive horror, the named cast has to read as different people from how they stand, walk, talk, sit and work, and the imported bodies' finger and twist bones should move instead of hanging stiff.

## What Changes

- **Every named character gets its own motion profile.** Named means every character with a name: Giles, Okafor, Priya, Voss, Bram, Ruiz, Heins, Hale and Sung, plus any named character added later. A profile names that character's clips for **every activity they perform** (idle, talk, walk, jog, turn, sit, lean, kneel, crouch, aim, drink, gestures and so on), plus style values (tempo, posture, fidget rate, arm carriage, head carriage). It replaces today's 4-slot `MotionSet`.
- **Scene variants.** Each named character also gets the extra clips its cutscenes and scripted beats need (Bram serving coffee, Ruiz holding his arms out for the checkpoint scan, Priya struggling as she is dragged, Hale briefing). A variant applies only while its scene, task or story state is active, then the character returns to their everyday motion.
- **Giles's injured arm shows only when it should.** He is hiding a cut forearm, so his everyday motion stays normal. The injured, favouring version of his left arm comes through when he thinks nobody is watching, when a task loads that arm, and more often as his infection stage rises, and fully only at the reveal.
- **Generic crew get two default profiles,** masculine and feminine, picked from each body's recorded gender, with seeded per-NPC tempo and posture variation, so a room of crew doesn't move in lockstep.
- **Characters stay in character outside locomotion.** Authored poses (`poses.json`) stay as the targets that scripts and sequences ask for, but each character holds them in their own way: their own idle-life clip layered under the pose where one exists, and their style values where none does.
- **Detail bones move, and every named character's hands are their own.** The existing hand solver (`handPhysics.ts`: per-finger springs, grip shapes, forearm twist sharing, hand personalities) extends to every named character. Each profile carries its own hand personality (Giles's restless mechanic's hands that start twitching as his infection rises, Okafor's steady surgeon's hands, Hale's nervous fidgets), finger tracks from clips that record fingers drive it where they exist, and spine and neck bend is spread over rigs with extra segments. The named bodies on the thin 24-bone scan rig (Bram, Heins, Ruiz, Sung) are re-prepared with weighted finger and twist bones, so every named character has the richer rig.
- **The shared 21-joint skeleton stays the driver for everyone.** Gore, kills, foot IK, hand physics, speech, look-at, authored poses and the planned ragdolls keep working unchanged.
- **New motion sources, all free.**
  - The CMU Graphics Lab Motion Capture Database (no restrictions; 144 performers): idles, talking, sitting, drinking, kneeling and daily actions, so each named character's everyday motion comes from a different real person.
  - Bandai Namco Research Motion Dataset 1 and 2 (CC BY-NC 4.0): styled walks, turns, runs and hand gestures (masculine, feminine, exhausted, elderly, youthful, active).
  - 100STYLE (CC BY 4.0): selected walk styles, including asymmetric and injured-looking gaits for Giles.
  - Quaternius UAL (CC0), already in use.
  - Every clip gets a `CREDITS.md` row and an in-game credit. The project accepts non-commercial licences (it already ships `zombie_walk.glb` under CC BY-NC).
- **The bake pipeline reads BVH as well as glTF,** and every bake source lives under `previews/sources/` (gitignored), next to the model sources, instead of a tool's scratch folder outside the repo.
- **A cast motion sandbox:** a grid with each named character in a row and copies of them performing a different activity in each column, so the cast can be compared side by side.

## Capabilities

### New Capabilities
- `character-motion`: how each character moves: named profiles, scene variants, Giles's concealed injury, gendered crew defaults, per-NPC variation, activity coverage, holding authored poses in character, fallbacks, and the cast motion sandbox.
- `mocap-library`: the baked clip library: allowed sources and licences, where sources live, retargeting from glTF and BVH onto the shared skeleton, finger tracks, credits, and size limits.

### Modified Capabilities
- `imported-body-models`: adds requirements that detail bones (fingers, twist, extra spine and neck segments) follow the shared pose, and that every named character's body carries weighted finger and twist bones, including the scan bodies.

## Impact

- **Code:** `src/actors/mocap.ts` (profiles replace `MotionSet`, finger tracks), `src/actors/animator.ts` (activity clips, pose-holding layer, style values; procedural arm scaling), `src/actors/bodyModel.ts` (detail-bone driver), `src/actors/castLooks.ts` and `squadLooks.ts` (profiles on every named entry), `src/actors/humanoid.ts`, `src/ai/squad.ts` (infection stage and observation feed Giles's injury weight), the sequence runner (scene variants), the crew look pool (gender per body), a new cast motion sandbox under `src/sandbox/`.
- **Scripts:** `scripts/bake-mocap.mjs` (BVH reader, per-character bake list, finger tracks), `scripts/lib/scan-body.mjs` and the `fix-*-glb.mjs` scripts for Bram, Heins, Ruiz and Sung (weighted finger and twist bones).
- **Data:** `src/data/mocap-clips.json` grows, or splits into per-character files loaded with the body; `data/body-models.json` gains a gender field.
- **Dependencies:** none new at runtime. Source datasets are downloaded by hand into `previews/sources/`.
- **Licences and credits:** `CREDITS.md` Animations section and the in-game credits.
- **Tests:** existing pose, kill and skinning tests stay green. New tests: every named profile resolves; crew pick a gendered default; detail bones follow the pose; the library stays within its size limit.
- **Other changes:** `adopt-physics-engine` (powered ragdolls) builds on the shared skeleton and is unaffected. Its motor targets come from whatever pose the character's profile produces.

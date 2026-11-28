# Tasks

## 1. Okafor & Giles Pistol Clips

- [x] 1.1 Update `okafor_pistol` and `giles_pistol` in `src/data/mocap-core.json` (wired in `src/data/motion-profiles.json`) so both pitch the pistol level/slightly downward (`bore.y` pitch in `-5°..+3°`), Okafor's `hand_R` cancels `doctor.glb`'s rest-hand roll, and both Okafor's and Giles's `hand_L` cup directly beneath `hand_R` / the pistol grip without protruding forward; verify with a `Humanoid` pose check.
- [x] 1.2 Update the regression test in `src/actors/heldProps.test.ts` to assert level/slightly downward bore pitch (`-5°..+3°`) and left-hand support proximity for both Okafor and Giles, and run `npm test -- src/actors/heldProps.test.ts`.

## 2. Idle Gun Carriage

- [x] 2.1 Update `Squad.restPose()` in `src/ai/squad.ts` to return `'idle'` so squadmates put their pistols down when idle out of combat and only raise `aim_pistol` when engaging in combat.
- [x] 2.2 Add a test in `src/ai/squad.test.ts` verifying that mates return to `idle` (no pistol showing) when combat ends even when `gunDrawn` is true, and run `npm test -- src/ai/squad.test.ts` plus `npm run typecheck`.

## 3. Visual Verification

- [x] 3.1 Inspect both Okafor and Giles in-game (at idle and in combat) to confirm they lower their guns at idle and hold the pistol level with both hands properly cupped in combat.

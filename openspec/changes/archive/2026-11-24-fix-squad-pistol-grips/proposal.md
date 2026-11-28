# Proposal

## Why

In `aim_pistol`, both squadmates currently share the generic `pistol_idle` mocap clip, which causes two visible posture defects:
1. Dr. Tomas Okafor's model (`doctor.glb`) has a ~42° roll on its rest `hand_R` bone relative to the canonical skeleton, so `pistol_idle` tilts his palm upward (+0.61 Y) and pitches the pistol barrel +33.5° up, forcing `aimHeldPistol` to twist his right wrist downward up to the 30° `AIM_CLAMP` limit.
2. August Giles's left hand (`hand_L`) sits ~6.3 cm below and ~4.7 cm behind his right hand (~7.5 cm below the pistol grip), cupping under his right wrist/forearm instead of supporting directly beneath his right hand and pistol grip.

## What Changes

- Add a character-specific `okafor_pistol` mocap clip in `src/data/mocap-core.json` (derived from `pistol_idle` with `hand_R` compensated for `doctor.glb`'s rest-hand roll, bore pitched level/slightly down, and `upperArm_L`/`foreArm_L`/`hand_L` adjusted so his left hand cups beneath his right hand/pistol grip) and wire `"aimPistol": "okafor_pistol"` in Okafor's motion profile.
- Add a character-specific `giles_pistol` mocap clip in `src/data/mocap-core.json` (derived from `pistol_idle` with `hand_R` pitched level/slightly down and `upperArm_L`/`foreArm_L`/`hand_L` adjusted so his left hand cups directly beneath his right hand/pistol grip without protruding forward) and wire `"aimPistol": "giles_pistol"` in Giles's motion profile.
- Update `Squad.restPose()` in `src/ai/squad.ts` so squadmates return to `'idle'` (putting their guns down) when out of combat, entering `'aim_pistol'` only when engaging in combat.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `character-motion`: Add pistol-aiming clip overrides (`okafor_pistol` and `giles_pistol`) so Okafor's right wrist sits level with his forearm and Giles's left support hand sits directly beneath his right hand and pistol grip.

## Impact

- `src/data/mocap/okafor.json` (`okafor_pistol` clip)
- `src/data/mocap/giles.json` (`giles_pistol` clip)
- `src/data/motion-profiles.json` (`okafor.clips.aimPistol`, `giles.clips.aimPistol`)
- Existing tests: `src/actors/heldProps.test.ts`, `src/actors/heldGrip.test.ts`, `src/actors/mocapPhysics.test.ts`, `src/actors/castMotionCoverage.test.ts`

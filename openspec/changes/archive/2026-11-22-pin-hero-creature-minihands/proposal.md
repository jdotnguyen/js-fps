# Proposal

## Why

The four-armed creature (`necromorph_slasher.glb`) is used three times: as the hero-tier enemy in the end fight, as the creature that bursts out of Voss, and in Priya's R08 death. When its top blade arms lift, its small belly arms lift with them and the skin around their roots stretches badly. The bottom arms aren't animated on purpose. The rig mapper binds them to the blade arm's hand joint because their bones (`Left_Minihandbase`, `Left_Minihand1/2`, `Left_Minihand_Wrist`, and the right-side copies) contain "hand". The same mistake moves the blade's `hand_L/R` pivot down to belly height (y ≈ 1.17 m, just above the 1.01 m pelvis), so the blade also swings from the wrong point.

## What Changes

- On an imported rig, a bone with a hand-like name maps to `hand_<side>` only if it hangs below that side's forearm. Any other hand-like bone, such as the creature's belly arms, is treated as a detail bone. It and its children ride the joint of the bone they hang from.
- The creature's belly arms then ride its body and never lift with the blades. The top blade arms remain its weapons, unchanged in role.
- The blade's `hand_L/R` pivot goes back to the real wrist (`Left_Hand` / `Right_Hand`). This changes slightly how blade swings look and where the hand joint sits. The hit capsules and the kill-grip point on the hero body follow the joint, so they move with it.
- Every other body in `src/data/body-models.json` maps exactly as before. A check of all 21 rigs found the creature to be the only one with hand-named bones outside a forearm chain.
- Out of scope: any deliberate motion for the belly arms (the "twitch" option B from exploration). It can be layered on later if playtests show they read as dead weight.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `imported-body-models`: add a requirement that secondary limbs on an imported rig never bind to a primary limb joint and never move a primary joint's pivot.

## Impact

- Code: the rig classification in `src/actors/bodyModel.ts` (`classify` / `mapRig`). It has no data or asset changes, and the GLB is untouched.
- Tests: `src/actors/bodyModel.test.ts` (necromorph rig tests).
- Gameplay that reads the hero body's `hand_*` joint: blade attacks, hit capsules, and the kill grips in `src/ai/npcKills.ts`. These need a playtest in the end fight, Voss's death and the R08 creature.

# Proposal

## Why

When a character holds a mug, the mug lies on its side and the named characters' fingers pass through it. A headless measurement of Giles, Okafor, Priya, Hale and Bram across all six mug poses found the mug 77-92° from vertical, and knuckle joints 1.5-3.9 cm inside the mug wall. The intro's kitchen scene and Priya's "Take coffee" hand-off are framed close-up on exactly this. The existing grip test passes while all of this is wrong, which is why repeated attempts never converged.

## What Changes

- The held mug's orientation in the hand is corrected: its up axis runs along the hand's thumb-and-index side, and its handle no longer points into the palm.
- Held mugs stay upright in hold and hand-off poses for every body, including unrigged and crowd bodies, despite wrist springs, hold clips and speech gestures. Drink poses tip the mug toward the face instead.
- For characters whose body has finger bones, the mug sits in the hand where that rig's own palm and knuckles are, instead of at one fixed offset tuned for none of them.
- For those characters, each finger and the thumb wrap the mug's surface: they touch it and never enter it. The thumb opposes the fingers.
- The grip test is replaced with a geometric check (mug tilt, finger-to-wall distance, handle clearance) per named rigged character and per mug pose, measured over several seconds of animation.

## Capabilities

### New Capabilities
- `held-props`: how small items held in a character's hand (mug, scanning wand) are oriented, kept steady and gripped.

### Modified Capabilities
<!-- None. The in-flight `per-character-motion` change adds "Fingers follow the character's hands" to `imported-body-models`, with a "Holding a mug" scenario. This change keeps that text and adds the measurable grip requirements in `held-props`, so the two changes do not edit the same requirement. -->

## Impact

- Code: `src/actors/heldProps.ts` (mug orientation, grip frame), `src/actors/handPhysics.ts` (wrap for held items), `src/actors/humanoid.ts` (upright correction after the hand solve), `src/actors/bodyModel.ts` (per-rig grip frame derived when the body is prepared), and possibly `src/data/poses.json` (right-hand angles in mug poses).
- Tests: a new geometry test for held mugs; the curl-only part of `handPhysics.test.ts` "finger tracks and grips" is replaced. The test loads the four rigged cast models (Giles, Okafor, Priya, Hale), so it is one of the heavier test files.
- Scenes: the intro kitchen (Bram serving Giles and Okafor, both leaning back with mugs) and Priya's mug hand-off; any ambient crew in mug or drink poses get the upright fix only.
- Out of scope: crowd and unnamed bodies' finger wrap; Bram's finger wrap, since his model has no finger bones (it applies once a rig is added); the player's own hand; and the `adopt-physics-engine` change (this needs none of it).

# Tasks

## 1. Geometric test that fails today

- [x] 1.1 Move `loadWithoutTextures`, `loadMainCast` and `makeLib` from `src/actors/handPhysics.test.ts` into `src/actors/castModelTestKit.ts`, keeping its model cache, and verify `npm test -- src/actors/handPhysics.test.ts` still passes unchanged
- [x] 1.2 Add the measurement helpers to `src/actors/heldGrip.test.ts` (design D1). They read the mug's radius, height and handle torus from its geometry; take tilt from vertical and toward the head; sample points along each phalanx (joint to next joint, distal to estimated tip); compute depth inside the cylinder and handle; compute tip-to-surface distance; and determine which side the thumb comes round. Verify with a unit test on a synthetic mug and hand: a point placed 5 mm inside reads -5 mm, and a mug tilted 30° reads 30°
- [x] 1.3 Add the per-character checks from the `held-props` spec: Giles, Okafor, Priya and Hale in every mug and drink pose for 3 s at 60 fps with the hold clip and one spoken line, plus tilt-only checks for Bram and one crew body. Mark each requirement's test `{ todo: true }` so the suite stays green on the shared branch. Verify the run prints failing numbers matching the exploration (tilt about 77-92°; knuckles 1.5-3.9 cm inside for Giles, Priya and Hale)

## 2. Mug orientation (D2)

- [x] 2.1 Replace `MUG_IN_HAND.rotation` in `src/actors/heldProps.ts` with a rotation built from named axes (mug +Y to grip axis, mug +X to handle direction; canonical: hand -Z and hand -X), and verify with a unit test that the mug's up maps to hand -Z and its handle to hand -X
- [x] 2.2 Re-run `npm test -- src/actors/heldGrip.test.ts` and verify every character's tilt drops to roughly the 20-47° range the exploration measured with the corrected rotation. Record the numbers in the test's comment

## 3. Upright and drinking (D3)

- [x] 3.1 Retune the right-hand angles of `idle_mug`, `offer_mug` and `lean_back_mug` in `src/data/poses.json` so the authored hand holds the mug near level, and verify with a test (`Humanoid.heldSwing`) that the leveling swing in hold poses, standing still, is under 15° for all five characters
- [x] 3.2 Add the post-hand-solve upright swing on `hand_R` in `src/actors/humanoid.ts` (alive, mug visible, right arm not limp or severed), with the drink-pose tilt table and the eased target in `src/actors/heldProps.ts`. Verify by removing `todo` from the "A held mug stands upright" and "Lowering the mug" tests and seeing them pass
- [x] 3.4 While the right hand holds a mug, speech gestures use the left hand (D3b). Verify with a test that the speech primary side is L in every mug and drink pose, and that the leveling swing over a spoken line in `lean_back_mug` stays under 25° for all four rigged characters
- [x] 3.5 Drink reach (D3c): in drink poses, solve the right arm with two-bone IK so the leveled mug's rim reaches the mouth, eased in with the pose blend. Verify by removing `todo` from "A drinking pose tips the mug toward the mouth" (30-70° toward the face, rim within 6 cm of the mouth) and seeing it and the lowering test pass
- [x] 3.3 Verify `npm test -- src/actors/motionHolds.test.ts src/actors/placedPoses.test.ts src/actors/handPhysics.test.ts` still passes (the hand stays pinned on the counter in `lean_counter`, and the mug stays in hand in `lean_back_mug`)

## 4. Rig calibration and grip frame (D4)

- [x] 4.1 Check Okafor's (`doctor`) calibrated right-hand curl axis: drive a full curl on each finger in a test and verify the fingertips move along his palm normal. If they sweep sideways, fix the axis derivation in `src/actors/bodyModel.ts` and verify the existing "30 calibrated finger bones" test and the new curl-direction test both pass for all four rigs
- [x] 4.2 Compute `gripR` (axis along the knuckle row, centre offset along the palm normal by the mug radius plus half a finger, provisional handle direction) when a finger-rigged body is prepared, carry it on `PreparedBodyModel`, and use it in `makeHeld`, falling back to the canonical frame. Verify with a test that each of the four rigs' mug centre lies within 1 cm of its own palm surface, and that unrigged bodies are unchanged
- [x] 4.3 Verify the "The mug sits in each character's own hand" test (todo removed) passes for Giles and Okafor, and that no tilt test regressed

## 5. Finger and thumb wrap (D5)

- [x] 5.1 Implement the once-per-(rig, item) contact solve (per-phalanx bisection against the cylinder and handle with a 2 mm skin margin, phalanx lengths and distal tip from the rig, rest-curl compensation folded in), cached on the body. Verify with a unit test that every cached phalanx sits within 2-5 mm of the surface on all four rigs
- [x] 5.2 Add the thumb opposition search (thumb-1 splay and curl grid, then bisection for thumb 2 and 3), and verify with a unit test that each rig's thumb tip is within 1 cm of the surface on the side opposite the middle finger
- [x] 5.3 Spin the grip frame so the handle sits in the widest gap between the contacts, re-solve once, and verify with a unit test that no finger point lies inside the handle and the handle is on the side away from the palm
- [x] 5.4 Drive held-hand phalanx springs from the cached per-phalanx targets in `src/actors/handPhysics.ts` (eased in over at least 0.1 s; personality and fidget may only open the grip, clamped at the contact angle), keeping the wand on `wrapCurl`. Verify by removing `todo` from the remaining `held-props` tests (no entry, closed grip, fidgeting hands with Hale and with Giles at infection stage 3, picking up and putting down) and seeing them pass
- [x] 5.5 Remove the curl-only mug assertions from the "finger tracks and grips" test in `src/actors/handPhysics.test.ts` (keep its clip-finger-track and empty-hand checks) and the mug use of `wrapCurl`. Verify `npm test -- src/actors/handPhysics.test.ts src/actors/heldGrip.test.ts` passes and `npm run typecheck` is clean

## 6. In-game check

- [x] 6.1 Reuse the dev server at `http://localhost:5173/` (start one only if none answers) and open `/sandbox/cast-motion.html`. Check the drink and "lean back with mug" columns for every named row: upright mug, fingers on the mug, thumb opposed, handle clear. Set the drink tilt by eye (any value from 30° to 70°), and verify by attaching screenshots of Giles, Okafor, Priya and Hale close up
- [x] 6.2 Play `/?level=slice01&slot=scratch` through the kitchen scene (Bram serving Giles and Okafor, both leaning back with mugs) and Priya's "Take coffee" shot. Verify by eye that the mugs stay upright through the hand-offs and do not clip the counter, and record the result in `docs/PLAYTEST.md`. Close the tab and stop any server you started **Closed 2026-11-27:** no recorded run; the product was accepted as it is.
- [x] 6.3 Run `npm test` and `npm run build`, and verify both pass

## Open items (2026-11-21)

- 5.2 and 5.4: done. Priya's thumb root sits beside her index, and no clear pose within its curl and opposition range reaches the far side, so (decided 2026-11-21) the spec lets her thumb rest along the mug beside the index, tip at the rim; Giles, Okafor and Hale's thumbs come round the opposite side.
- 6.1: done. With Giles's finger skinning fix (commit fa5a2cb, applied here from `refs/heads/claude/suspicious-diffie-a7881b` as uncommitted changes) all four wrap their mugs in the sandbox, upright in `lean_back_mug` and at the mouth in `drink` (45° tilt kept). Okafor's white coat sleeve still stretches at the cuff when his hand turns to level the mug (his rig's hand sits 42° rolled).
- 6.2: not done (the intro playthrough).

## Workflow follow-up

- Bram's finger wrap applies once `per-character-motion` gives his body finger bones (D4 and D5 key off the rig); re-run `heldGrip.test.ts` with Bram added to the rigged list then.
- Archive the change after review.

# Proposal

## Why

Bram's face stretches diagonally when he turns his head or talks, and his left-hand fingers curl backward. Both faults come from his prep script (`scripts/fix-bram-glb.mjs`), not from the animation code. A rebuild from the source scan reproduces them:

- **Face.** The script predates the shared scan pipeline's neck rule, so the chest capsule (`Spine1`) keeps 20-25% of the weight from the nose down to the upper lip. It also keeps 28% of the neck. Under the look-at turn (head 22°, neck 8°), the nose and upper lip trail a rigid head by 16 mm on average (up to 22 mm), while the forehead trails by under 2 mm. On a 15° jaw opening, the band just above the mouth line moves 14 mm (up to 30 mm), so the upper lip goes partly with the jaw. This breaks two existing `imported-body-models` requirements, "The neck joint owns the neck" and "The lower face moves with the head". Bram was never checked against them: `NECK_BODIES` in `bodyModel.test.ts` lists only Okafor and Ruiz.
- **Left hand.** `hand-rig.mjs` first guesses, correctly, that the left thumb points forward. Its bend check then flips that guess, because Bram's flat T-pose fingers read -4.4 cm against a 3 cm threshold. Every left-hand label is then reversed: the real thumb is rigged as the pinky, and the pinky edge as the thumb. `bodyModel.ts` takes the palm side from the index-to-pinky direction, so the left palm reads as facing up and every curl bends backward. The fist test only checks that the skin doesn't tear, so it passed. Of the bodies with finger chains, only Bram's left hand fails a left/right mirror comparison (thumb 0.90, pinky 0.95 index-lengths apart). The next worst is Heins's thumb at 0.28, a real asymmetry in her scan.

## What Changes

- Bram's prep applies the shared neck rule after smoothing and before the jaw mask, gated to skin by the scan's colour. Chest and spine weight stop at his collar, the neck column goes to the neck joint and blends into the head, and the mouth, lips, chin and jaw line go to the head and jaw only.
- His standing shirt collar stays on the chest and neck instead of turning with the head. Smoothing passes over the neck keep the rules' edges from shearing when he turns his head.
- Bram's jaw mask stops at his lip seam and reaches down to the chin's underside, so the upper lip stays with the head while the lower lip and chin follow the jaw.
- Bram's hand rig pins both thumbs forward (his T-pose thumbs both point +Z) and doesn't let the bend check flip either hand. The shared hand rig gains an opt-in option for this; its default behaviour is unchanged, and no other body is rebuilt.
- `public/assets/models/squad/bram.glb` is regenerated. His body joints don't move; his left-hand finger joints move to the real fingers.
- Tests: Bram joins the neck-rule check, and a new rig check requires every body with finger chains to mirror its finger bases between left and right.
- The stale note on the bend threshold in `hand-rig.mjs` (it says Bram's hands read 1-2 cm) is corrected.

Out of scope: moving Bram onto the whole shared scan pipeline (arm split, elbow rule, meshopt/WebP packing), a stricter bend check for every body, and any change to `bodyModel.ts` or the hand solver.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `imported-body-models`: "Every named character's body has finger and twist bones" gains a scenario. Each hand's thumb and fingers sit on their own sides, mirrored between the left and right hands, so both hands curl toward their palms.

## Impact

- `scripts/fix-bram-glb.mjs`: the neck rule, the jaw mask edge, and the hand-rig options.
- `scripts/lib/scan-body.mjs`: exports the neck rule (`applyNeckRule`) for reuse; its own callers are unchanged.
- `scripts/lib/hand-rig.mjs`: a new opt-in option on `splitHands`/`planHand` that keeps the thumb-side guess; default unchanged; comment fix.
- `public/assets/models/squad/bram.glb`: regenerated from `previews/chef_t_pose_src.glb`.
- `src/actors/bodyModel.test.ts`: `bram` added to `NECK_BODIES`; new mirror check over the hand-rigged bodies. The file carries uncommitted rig-necromorph edits, so commit only this change's hunks.
- No runtime code changes. Bram's poses, grips and VO are unaffected; his left-hand gestures and relaxed curl will look different, for the better.

# Design

## Context

See proposal.md for why. The current pipeline, as it stands:

```
Animator (pose + mocap + hold clip; writeWithHold re-pins hand position and orientation)
  -> LimbContactSolver
  -> HandPhysicsSolver.update  (wrist springs, palm alignment, finger springs)
  -> render
held_mug: a child mesh of hand_R, at the fixed MUG_IN_HAND position and rotation (heldProps.ts)
```

- `MUG_IN_HAND.rotation = Euler(-PI/2, 0, PI/2)` (XYZ). The comment says it maps the mug's +Y to the hand's -Z (the thumb and index side, in the canonical frame where the bone points -Y and the palm faces -X). Because XYZ applies Z first, it actually maps +Y to the palm normal. That is the "sideways" mug.
- The fingers wrap with `wrapCurl(finger, radius)`: one normalised curl per finger from assumed finger lengths (`FINGER_LEN`), spread over the MCP, PIP and DIP joints by the chained springs. It ignores where the mug actually is and how long each rig's phalanges are, and it never opposes the thumb.
- Rigs differ a lot. Measured right-hand knuckle distance from the wrist is 8.6 cm for Giles (`mechanic`), 12.6 cm for Okafor (`doctor`), 8.3 cm for Priya and 7.3 cm for Hale. Okafor's calibrated curl axis is `(0.66, 0.05, -0.75)` against roughly `(0, -0.1, -1)` for the others.
- With the rotation corrected (in memory only, `Euler(-PI/2, PI, 0)`), measured tilt was still 21° (`offer_mug`), 33° (`lean_back_mug`) and 46° (`drink`). Priya's fingers came within about 0.6 cm of the wall. Giles's fingertips floated 1.5-2.4 cm off, Okafor's 2.5-5 cm, and every thumb sat 1-3.5 cm inside the mug.

## Goals / Non-Goals

**Goals:**
- A geometric test that fails today with real numbers, written before any fix.
- One grip solution per (rig, item), derived from the rig's own calibrated bones, with no per-character constants.
- A per-frame cost for named characters that stays near today's (no per-frame search).

**Non-Goals:**
- Changing the wand's grip. It keeps the current `wrapCurl` path; only shared code is touched.
- A left-hand mug, two-handed holds, or a mug passed between hands mid-animation. Hand-offs remain pose switches.
- Physics or collision for the mug. It stays a kinematic child of `hand_R`.

## Decisions

### D1. Test first, measured from the mug's real geometry
A new `src/actors/heldGrip.test.ts` builds Giles, Okafor, Priya and Hale in every mug and drink pose, runs 3 s at 60 fps with the hold clip and one spoken line, and on every frame measures:
- the tilt of the mug's axis from vertical (and toward the head in drink poses);
- for every phalanx, points sampled along the segment from its joint to the next one (or to the estimated tip), checked against the mug's cylinder and handle;
- tip-to-surface distance, and which side the thumb comes round.

The mug's radius, height and handle torus are read from the mug's geometry (vertex bounds), not from `HELD_GRIP_RADIUS`, so a wrong constant in the solver cannot also make the test pass. Bram and one unnamed crew body are checked for tilt only.

The GLB loading helpers (`loadWithoutTextures`, `loadMainCast`, `makeLib`) move out of `handPhysics.test.ts` into a shared test kit (`src/actors/castModelTestKit.ts`) so both files use them. The scratchpad probe from the exploration is the starting point for the measurement code.

*Alternative:* extending the existing "finger tracks and grips" test. Rejected: it measures curl numbers against curl numbers, which is how the bug stayed green.

### D2. Build the mug's orientation from named axes, not an Euler string
`heldProps.ts` builds the mug's rotation from a basis: mug +Y (up) goes to the grip axis, and mug +X (handle) goes to the handle direction. The canonical frame uses grip axis = hand -Z and handle = hand -X (away from the palm, since the mug centre sits on the palm side at x = -0.045). A unit test asserts the mapping directly. This alone fixes the 80-90° tilt for every body, unrigged ones included.

*Alternative:* swapping in the corrected Euler. Rejected: the same reading mistake is easy to repeat, and a rig-specific grip frame (D4) needs a basis anyway.

### D3. Keep the mug upright with a final hand swing
Authored poses and hold clips cannot be trusted to keep the hand level (the corrected mug still tilts 21-46°). So `Humanoid`, right after `handPhysics.update`, reads the mug's world axis `a` and a target axis `t`, and applies the minimal swing `setFromUnitVectors(a, t)` to `hand_R` in world space. That turns the fingers and mug with it, so the wrap is unaffected and the handle direction is mostly preserved.
- **Target:** world up in hold and offer poses. In drink poses (`/(^|_)drink(_|$)/`), up tipped toward the head bone by a per-pose tilt (default 45°), kept in a small table in `heldProps.ts` rather than a new `poses.json` field.
- **Blending:** the target tilt eases with a critically damped spring (about 0.25 s), so a pose change never jumps more than 15° per frame.
- **Weight:** the correction runs only while the mug is visible and the body is alive. It is skipped for limp or severed right arms.
- To keep the swing small (it moves the mug a few centimetres about the wrist), the right-hand angles of `idle_mug`, `offer_mug` and `lean_back_mug` are retuned in `poses.json` so the authored pose is already near level. The swing then only removes drift from hold clips and springs. Target: a residual swing under 15° in hold poses.

*Alternative:* tilting the mug mesh inside the hand. Rejected: it slides the mug through the fingers. *Alternative:* fixing it only in pose data. Rejected: hold clips and speech gestures move the wrist every frame.

### D3b. Speech gestures use the free hand
Measured during implementation: every character's speech primary side is R. While talking in `lean_back_mug`, the gestures move the mug hand so far that the leveling swing reaches 94-111° (Okafor, Hale), against 13-45° when quiet. The mug stays upright, but the wrist twists impossibly. So while the right hand holds a mug, the animator's speech primary side is L: the free hand gestures, and the mug hand keeps only its secondary share.

*Alternative:* clamping the swing. Rejected: the mug would then tilt during speech, breaking the upright requirement.

### D3c. Drink poses reach the mug to the mouth
Measured during implementation: a grid search over the drink pose's right-arm angles on the four rigged bodies got the rim no closer than 7-10 cm from the mouth (the spec asks for 6 cm), and leveling then bent the wrists 60-160°. Authored angles cannot serve hand sizes, heights and the leveled mug at once. So in drink poses, after leveling, `Humanoid` computes where the leveled mug must be (rim at the mouth, from the head bone) and from that where the hand must be (the mug is fixed in the hand). It then solves `upperArm_R` and `foreArm_R` with the existing two-bone IK (`solveTwoBone`, elbow pole down and out to the side), keeping the hand's leveled world orientation. The reach weight follows the eased drink tilt (0 when upright, 1 at the pose's full tilt), so lowering the mug blends the arm back to the authored pose. The drink poses' authored arms stay as a fallback and starting point. The mouth is measured per body from the mesh skinned to its jaw (the lower lip's top at the front of the face): rigs differ by several centimetres, and a single head-frame constant put the rim at Giles's eyes. Bodies without a jaw mesh fall back to the constant.

*Alternative:* per-character drink pose variants. Rejected: the same per-rig tuning trap D4 avoids.

### D4. A grip frame per rig, from its own palm and knuckles
When a body with finger bones is prepared (`bodyModel.ts`, beside the existing per-side frame calibration), compute a right-hand grip frame in hand-rest space:
- **Axis:** along the knuckle row (from the pinky's first knuckle to the index's), oriented toward the index and thumb side.
- **Centre:** from the midpoint of the first phalanges, offset along the calibrated palm normal by the mug's radius plus half a finger's thickness.
- **Handle direction:** provisionally away from the palm; finalised in D5.

As built, the frame is computed from the body's calibrated finger definitions when the mug is first made (`gripFrameFor` in `heldProps.ts`, cached per rig with the wrap), rather than stored on `PreparedBodyModel`: the inputs are the same, and nothing else needs it. The mug rests on whichever knuckle stands furthest out (pressing it 2 mm, within the spec's 3 mm), centred on the knuckles along the fingers. `makeHeld` uses it when present, and the canonical frame (D2) otherwise. This is what fits Okafor's 12.6 cm hand and Hale's 7.3 cm hand without constants.

*Alternative:* a per-character offset table. Rejected: it is what the iterations kept re-tuning, it breaks when a model is swapped, and it does not scale to Bram or other cast members once they gain rigs.

### D5. Solve the wrap once per (rig, item), then clamp the springs
The mug is fixed in the hand frame, so the contact pose of each finger is a constant of the rig. On a body's first mug hold, compute and cache, per finger and per phalanx, the largest curl angle for which that phalanx's sampled points stay outside the mug's surface plus a skin margin (about 2 mm). Phalanx lengths come from the rig's bone offsets; the distal length comes from the tip estimate `bodyModel.ts` already makes for auto-skinning. This is a bisection about each phalanx's own curl axis, working outward from the MCP joint, in full 3D against the cylinder and handle. It therefore copes with Okafor's oblique axis without a 2D circle assumption.
- **Thumb:** a small grid over thumb-1 splay (opposition) and curl, picking the closest contact on the side opposite the fingers. Then bisection for thumb 2 and 3.
- **Handle:** after the solve, spin the grip frame about its axis so the handle sits in the widest angular gap between finger and thumb contacts. Then re-run the solve once, which makes the "not covered by fingers" scenario hold.
- **Per frame:** while the hand holds the mug, each phalanx spring gets its own target (the cached contact angle, eased in over at least 0.1 s) instead of the MCP-to-PIP-to-DIP chain. Personality and fidget may only open the grip, by up to about 0.08 rad, and the result is clamped at the cached maximum, so twitch and fidget can never push a finger in. The rest-curl compensation (`restCurl * 0.65`) is folded into the cached angles so the solved angle is exactly what reaches the bone.
- Below the finger LOD distance nothing changes: the fingers keep their last pose and D3 still runs.

*Alternative:* solving every frame. Rejected: unnecessary, since the mug never moves relative to the hand, and it adds cost to every named character on screen. *Alternative:* a better per-finger `wrapCurl` length table. Rejected: one scalar per finger cannot place three joints on a curve, and it cannot oppose the thumb.

## Risks / Trade-offs

- [Okafor's calibrated curl axis is about 41° off the other rigs and may be a calibration fault, so a "non-penetrating" curl could sweep his fingers sideways] → An early task checks that a full curl moves his fingertips along his palm normal. If it does not, the calibration in `bodyModel.ts` is fixed before D5 is built on it.
- [The D3 swing moves the mug about the wrist and could push it into the torso or a counter in lean poses] → Retune the authored hand angles first so the residual swing stays small. The browser check covers the leaning poses against the kitchen counter.
- [The test and the solver could share a wrong idea of the mug] → The test reads the mug's dimensions from its geometry, not from solver constants (D1).
- [The new test loads four cast GLBs, which is heavy on the shared machine] → It is one file; iterate with `npm test -- src/actors/heldGrip.test.ts` and reuse the shared test kit's cache.
- [Unrigged bodies (Bram, crowd) still show mitten hands overlapping the mug] → Accepted; the mug is upright. Bram's grip arrives automatically once `per-character-motion` gives his body finger bones, because D4 and D5 key off the rig, not the character.

## Migration Plan

No data migration. `wrapCurl` remains for the wand. Its mug use and the curl-only mug assertions in `handPhysics.test.ts` are removed once the new test covers them. To roll back, revert the change. There are no save or format changes.

### D6. A thumb that cannot oppose rests on the rim
Measured during implementation: Priya's thumb root sits beside her index finger, and no clear pose within its curl and opposition range reaches the mug's far side. Rather than widen her thumb's range past the solver's anatomical limits, the thumb search keeps its fallback: the closest clear pose, which for her rests along the mug beside the index with the tip at the rim. Decided 2026-11-21; the held-props spec states it as the exception.

Giles's thumb, once his finger chains follow his skin (the mechanic skinning fix), lies across his palm and has no clear pose in that range. Only for a thumb like that, the search falls back to a wider swing (twice the opposition limit, about 48°), uncurling to the hand solver's -0.25 rad, and up to 1.5 times the usual thumb joint limits (`HELD_THUMB_REACH`, still inside a real thumb's range); the hand solver allows that reach for a held mug's thumb only. While easing in, a thumb swings out before it curls in, so it comes round the mug instead of through it.

## Open Questions

- The exact drink tilt per pose (45° by default) is set by eye in the cast motion sandbox's drink column. Any value from 30° to 70° meets the spec.

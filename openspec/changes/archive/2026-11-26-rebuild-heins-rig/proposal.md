# Proposal

## Why

Heins is going to be a long-term character, and her body does not hold up. Her face pulls diagonally when she turns her
head or talks, because her prep script bound about a fifth of her nose and mouth to her chest and gave her neck no skin
at all. She already breaks `imported-body-models` requirements on the neck, the lower face and the arms against the
torso, and was never on those tests' lists.

The artist's original files are now available: a 4K GLB and the OBJ, whose face groups mostly carry bone names. They
let her be weighted from what the artist intended instead of from distance guesses. She is kept at the source's full
fidelity: only the app's real limits apply, not the build script's size budgets.

## What Changes

- Her skin weights are guided by the bone names in the OBJ. Her neck gets its own skin, her face moves only with her
  head and jaw, and her jacket sleeves separate from her torso below the armpit.
- Her jaw opens along the real lip opening: the lower lip and chin follow it, the upper lip stays.
- Her cyber arm and hand move as rigid mechanical parts instead of bending like skin.
- Her joint positions are re-measured against the bone-name boundaries.
- Her whole body keeps its full source detail (no decimation) and every kept texture its source resolution, up to
  4096 px. Her eyeballs stay two separate whole shapes, which keeps later eye and blink work open.
- The shared arm-separation test counts only openings that posing creates, since her body is made of open layered
  pieces.
- Her build reads both source files, and they are kept in `previews/hein_src/` (not committed).
- `public/assets/models/squad/heins.glb` is regenerated. She keeps her look: purple hair, clothes, cyber arm.
- She joins the neck, face and arm-separation tests, and a new test covers rigid mechanical parts.

Out of scope, each a possible later change:

- Eye movement and blinking.
- Lip shapes for speech beyond the jaw.
- Crossed arms dropping during idle gestures. Change `keep-crossed-arms` fixes that and lands before this one.
- Any other character's body, and any new bones in the shared gameplay skeleton.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `imported-body-models`: adds a requirement that rigid mechanical parts of a body keep their shape. The existing neck,
  lower-face, arm-separation and hand requirements apply to Heins unchanged.

## Impact

- `scripts/fix-heins-glb.mjs`: reads the OBJ's bone names, new weighting, no decimation, source-resolution textures,
  32-bit indices where needed.
- `scripts/lib/`: a small OBJ label reader. Her script uses the `applyNeckRule` and `splitArms` that `scan-body.mjs`
  already exports.
- `public/assets/models/squad/heins.glb`: regenerated at full source detail, tens of MB instead of 1.9 MB.
- `src/actors/bodyModel.test.ts`: Heins added to the scan-body lists; new rigid-part and mouth checks; the arm test's
  hole check counts only openings that appear when the arms rise.
- `CREDITS.md`: the note on how her body is built.
- Her poses, grips and mocap are unchanged as data, but may sit slightly differently on the new joints, so they need
  re-review.
- Up to about 1.5 GB more GPU texture memory while she is loaded (estimate), measured and recorded in task 4.2.
- No runtime code changes planned.

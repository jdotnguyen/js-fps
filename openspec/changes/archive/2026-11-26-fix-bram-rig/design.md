# Design

## Context

See proposal.md (Why) for the two faults and their measurements. What shapes the approach:

- Bram's body is built by his own script, `scripts/fix-bram-glb.mjs`, not by the shared scan pipeline (`scripts/lib/scan-body.mjs`'s `skinScan`). Its weights run: capsule scores, then a softmax, then four Laplacian passes, then the jaw mask, then `splitHands`/`rigHands`. The shared pipeline's neck rule (`applyNeckRule`, not exported) runs between smoothing and the jaw mask, and Bram's script has no such step.
- His chest capsule (`Spine1`, segment from `Spine1` at y 1.34 to `Neck` at y 1.56, radius 0.21 m) is wide enough to score close to the head capsule up to the eyes. That is where the 20-25% chest share on the face comes from; smoothing then spreads it.
- Measured on the source scan (source frame: Y up, facing +Z, metres), with skin told from clothes by texel colour: Bram wears a dark shirt with a standing collar under a white bib apron. The collar opens into a V at the front, where the throat skin shows from y ~1.57, 3-4.5 cm in front of the neck axis (x 0, z -0.015). At the sides and back it wraps the neck up to y ~1.685 (5-14 cm out), with a strip of skin and then hair above it. The neck's own skin at the sides sits 5-5.6 cm out. The chin's underside is at y 1.650, the lip seam at 1.689 (upper lip 1.692-1.712, lower lip 1.680-1.688), the nose tip 15 cm out at y 1.73, and the jaw hinge at (0, 1.735, -0.01). The decimated output is too sparse at the midline to resolve the lips; the source isn't.
- With the neck rule and a flat chest line alone, the collar would follow the head 80-99% at y 1.65-1.70, against 30-59% from the capsules today. The neck rule's face part takes the collar where it wraps the neck in front of the axis, its column takes the collar's inner edge, and a flat line above y 1.65 strips the chest from the collar's upper part.
- `hand-rig.mjs`'s `planHand` guesses the thumb side from `thumbToward` (default +Z), then lets the bend check flip it when the fingers seem to bend more than 3 cm (`BEND_SURE`) away from the implied palm. Bram's flat T-pose left hand reads -4.4 cm on the correct side and +2.0 cm on the wrong one, so it is flipped. His right hand isn't.
- `bodyModel.ts` takes each hand's palm side from its labels (across = index base to pinky base, crossed with the middle finger's direction, mirrored by side). A flipped labelling therefore flips the curl, and nothing in the build or the tests notices.
- The source scan is `previews/chef_t_pose_src.glb`, which is gitignored and present on this machine only. A rebuild from it reproduces the committed asset's faults, so the script is the source of truth.
- `bodyModel.ts` and `bodyModel.test.ts` carry uncommitted rig-necromorph edits by another agent. This change edits only the test file there, and adds hunks without touching theirs.

## Goals / Non-Goals

**Goals:**
- Bram meets the existing neck and lower-face requirements, with the same test that Okafor and Ruiz pass.
- Bram's left hand is labelled like his right, mirrored, so both hands curl toward their palms.
- A one-sided hand flip like this one fails a test for any hand-rigged body in future.

**Non-Goals:**
- No change to how any other body is built or to its asset; Heins is not rebuilt.
- No change to runtime code (`bodyModel.ts`, the hand solver, the look-at, speech acting).
- No re-measuring of Bram's skeleton: the joint table `J` stays as it is.

## Decisions

### D1. Reuse the shared neck rule from Bram's script

Export `applyNeckRule` from `scan-body.mjs`, unchanged, and call it in `fix-bram-glb.mjs` after the smoothing passes and before the jaw mask, the same place `skinScan` calls it. It replaces the weights in the neck column with a neck-to-head gradient and makes the lower face head-only (the jaw mask then hands the mouth and chin to the jaw). That is exactly what the two requirements ask for.

Alternatives considered:
- **Move Bram onto `skinScan` and `packBody` wholesale, like Ruiz.** One pipeline, but it also changes his arm weights (arm split, elbow rule), vertex layout, compression and textures. That is far more change, and more re-review of his poses, than these faults need.
- **Copy the rule into Bram's script.** Two copies of the same rule would drift apart; exporting costs one keyword.

Parameters, measured in task 1: axis `[0, -0.015]`, `collarY` 1.59, `jawLineY` 1.65, `radius` 0.058 (the throat and the neck's sides fully inside), `margin` 0.015, `faceRadius` 0.18 (the nose tip is 15 cm from the axis). The column is colour-gated, `include` = skin, as Ruiz's is. The collar's inner edge comes within 6-7 cm of the axis, where the column still blends in, so radius alone can't keep it out.

### D2. Keep the chest below the collar, and the collar off the head

Bram's script samples each vertex's base colour from the scan's colour texture (decoded with ImageMagick, which the script already uses for textures) and calls it skin when it is warm (red well above blue). The shirt, the hair and the apron are not. Then:

- **Chest line.** In the capsule scoring, `Hips`, `Spine` and `Spine1` get the same kind of score penalty the script already uses to keep the arms and torso apart, on skin above `collarY` and on everything above the collar's top (`CHEST_LINE_Y` 1.69). After smoothing, whatever trunk weight smoothing carried above that line moves to the head over 1.5 cm. The neck rule only covers the column and the face up to `jawLineY + 0.12`; this keeps the chest off the rest of the head (eyes, forehead, ears, the hair at the back), and off the neck's skin outside the column.
- **Collar rule.** After the neck rule and before the jaw mask, every non-skin vertex wrapping the sides and back of the neck goes to a blend that runs from the chest at its base to the neck at its top. That means 40° or more round from the front, 4-14 cm from the axis, between `collarY` - 0.03 and the collar's top, fading out over the top 1 cm. So in the look-at the collar turns mostly with the neck's 8°, not the head's 30°, whatever the neck rule's face part or column did to it.
- **Blend pass.** The rules switch on over a centimetre or two, and the colour gate switches vertex by vertex. In a simulated look-at, neighbours on different rules sheared apart: the collar's inner lip stretched to 4.5 times its rest length, against 1.7 times with today's capsule weights. Blending the collar's top toward the head barely helped (3.6x). Ten smoothing passes over the neck after the rules do, leaving the face in front of the axis out: the worst neck edge ends at 1.9x with 7 edges over 1.5x (today: 7). The collar ends 10-40% on the head (y 1.62-1.68), against 30-60% today, and the face stays rigid. Afterwards the neck column sheds any chest weight the passes brought back to the neck, and anything above the collar's top sheds it to the head. More passes stretch less but put more of the collar back on the head.

This is how "The chest and spine joints SHALL carry no weight above the collar" holds across the whole head, not just in the column the test samples, without the collar following the head.

Alternatives considered:
- **A flat chest line at y 1.65 and no colour.** The first build did this: the collar followed the head 80-99%.
- **The collar keeps its capsule weights (30-59% head, as today).** No regression, but it still half-turns with the head; the user chose neck-following.
- **A head share at the collar's top instead of the blend pass.** Stretch stayed at 3.6-3.8x: the worst edges were between neighbouring skin and collar vertices at the collar's inner lip, not along its top.
- **Shrinking the `Spine1` radius.** That would change his chest and shoulder weights everywhere, not just at the collar.

### D3. Move the jaw mask's top edge to the lip seam

Today the mask is full below y 1.678 and zero above 1.70, so the upper lip (1.692-1.712) partly follows the jaw. The mask's top edge goes to the seam (1.689, from the source scan's midline profile, confirmed on the sandbox close-up): full jaw from 2 mm under it, none from 3 mm above.

The lower bound moves to the chin's underside, as `scan-body.mjs`'s jaw mask places it: full jaw to 5 mm above `jawLineY`, fading out 3 cm below. The old bound faded out from y 1.665 down to 1.64. That was fine while the capsules gave the chin some jaw weight of their own, but the neck rule now makes the chin head-only first, so the old bound left the chin's bottom edge only 52% on the jaw (83% before). With the new bound it is 91-100%. Depth and width stay.

### D4. Pin both thumbs forward for Bram, with an opt-in in the shared hand rig

`splitHands` (which builds the plans `rigHands` reuses) gains an opt-in option. It keeps the thumb-side guess from `thumbToward` and skips the bend-check flip for the listed sides. If a pinned side's palm width axis is side-on to `thumbToward` (`|facing| < 0.25`, where the guess would fall back to the protrusion count), the rig throws instead of guessing, because the caller claimed to know the direction. Bram's script passes `thumbToward` +Z for both hands and pins both. His T-pose thumbs both point forward: the right hand's labelled thumb and the left hand's real thumb (its protrusion at the front, near the wrist) both sit at +Z.

The default behaviour is untouched, so Heins and every future scan still get the bend check. The stale comment on `BEND_SURE` (it says Bram's hands read 1-2 cm either way) is corrected to the measured -4.4 / +2.0 cm, and notes that he is now pinned.

Alternatives considered:
- **Make the bend check stricter for everyone**, e.g. reject a flip whose "thumb" reaches as far as the fingers. Ruled out by the user's scope (Bram only). The mirror test (D5) covers the failure either way.
- **Correct the palm side at runtime in `bodyModel.ts` from the mesh.** That would touch runtime code that another change is editing, and hide a bad asset instead of fixing it.

### D5. A mirror check over every hand-rigged body

In `bodyModel.test.ts`, add a test for every `body-models.json` entry whose prepared model (`detailHands: true`) has finger bones on both hands. In the rest pose, each hand's across direction (index base to pinky base, falling back to ring) must match the other hand's, mirrored across the body's left-right axis, within 60° (cosine ≥ 0.5). Measured from the assets' bone nodes, Bram's left pinky base sits 0.95 index-lengths from the mirrored right one, so he fails. Every other body with finger chains (Heins, Okafor, Hale, the mechanic, the botanists) is within 0.24, so they should pass; the test confirms it on the prepared models. The check uses the across direction rather than thumb positions because Heins's scan really does pose her thumbs differently.

Add `bram` to `NECK_BODIES`, so the existing neck and lower-face test runs on him.

Limitation: a body whose hands were both flipped would still mirror. That isn't the failure seen here (the heuristic flips one hand at a time), and the sandbox review in the tasks covers it for Bram.

## Risks / Trade-offs

- [The narrower jaw mask leaves too few jaw vertices for the talk test (≥ 20 mostly on the jaw, `bodyModel.test.ts` around line 567)] → The lower lip, chin and jaw line still carry the jaw. Check the count after the rebuild, and widen the mask sideways, not upward, if it drops.
- [The collar stays with the neck while the skin above its top edge turns with the head, so that edge stretches in the look-at] → Simulate the look-at on the built weights and check edge stretch round the collar (D2's 2.5x limit), compared with today's build. Check in the sandbox from the side and from behind.
- [The colour test misreads a shadowed bit of neck skin as shirt, leaving it out of the column] → The neck test's column check catches it. The threshold sits between the darkest neck skin measured (red 26 over blue) and the shirt and hair (8-14).
- [The rebuild changes more than intended] → Diff against a fresh build of the original script, not the committed asset: today's decimation already comes out slightly different (16165 triangles against the committed 16184), so a straight diff with the committed file is noise. Check the same body joint positions, and that weight changes are confined to the head, neck, collar and left hand. Re-run every `bram` test in `bodyModel.test.ts`, including the fist test.
- [The source scan is only on this machine] → The rebuild has to happen here. The script header already documents the command.
- [Committing in a shared checkout with another agent's edits in `bodyModel.test.ts`] → Commit only this change's hunks, as the shared-checkout practice requires.

## Migration Plan

Rebuild `public/assets/models/squad/bram.glb` from `previews/chef_t_pose_src.glb` with the updated script, and commit the asset with the script and tests. To roll back, revert that commit; nothing else depends on the asset's internal weights.


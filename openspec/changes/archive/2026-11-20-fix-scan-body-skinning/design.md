# Design

## Context

`scripts/lib/scan-body.mjs` turns a scan into a body in this order: bake and weld, scan-specific edits (cuts, head turn, finger opening), region decimation, `skinScan`, pack. `skinScan` scores each welded vertex against bone capsules (distance / radius), turns scores into soft weights, then runs 4 rounds of Laplacian smoothing over the mesh graph and applies a jaw mask. `bodyModel.ts` straightens the rig and auto-skins finger bones; it is not expected to change.

Two things in the current pipeline cause the bugs (see proposal.md, Why):

- The scans are one closed shell. Wherever an arm touched the body, the surface runs torso -> crease -> arm with no inner sleeve or body side behind it. Capsule scores are close in that band, and smoothing spreads weights along the shared surface, so a wide strip blends arm and body.
- Torso capsules are 0.19-0.2 m wide and run up to the neck joint. The neck capsule is 0.07 m. Near the collar the chest wins, and smoothing carries chest weight up to the chin and mouth corners.

```
 cross-section at chest height, today            after the split
   front crease                                     front
        \   +-----------+   torso                 +--------+  +--+
  arm ->(*)-+           |                 arm  ->| cap    |  |  | <- torso cap
        /   +-----------+                         +--------+  +--+
   back crease                                     (two closed pieces, joined
   (one loop: torso and arm share it)               only above the armpit)
```

## Goals / Non-Goals

**Goals:**
- The arm/body split, caps and neck/face rules are generic steps in the shared pipeline, driven by a few per-scan parameters (armpit height, collar line, neck column), so the older scan bodies can adopt them in a follow-up.
- The shoulder cap above the armpit stays one connected surface with blended weights, so the shoulder still deforms smoothly.

**Non-Goals:**
- Rebuilding the hidden geometry (a real inner sleeve or ribcage side). The caps are flat-ish patches, not sculpted surfaces.
- Hair weighting (Ruiz's hair on her shoulders keeps following the chest).
- Any change to `bodyModel.ts`, the animator or the poses.

## Decisions

### 1. Split after decimation, by triangle label
The split runs on the decimated mesh (about 30-40k triangles), before skinning. Each triangle gets a label: `armL`, `armR` or `body`. Below the armpit, vertices used by both an arm triangle and a body triangle are duplicated, so the two sides stop sharing them.
- Labelling triangles rather than vertices means a triangle that decimation stretched across the crease lands wholly on one side, never bridging.
- Alternative: split the full-resolution mesh before decimation. That gives a more exact seam, but we would have to carry labels through decimation and every later step re-reads positions, which is slower and more code. Rejected for now. If the cut line looks jagged at 30k triangles, that is the fallback (see Risks).

### 2. Label from capsule scores, then clean up
- Seed: each triangle centroid takes the arm chain (upper arm, forearm, hand) or the body (hips, spine, neck, head, legs), whichever capsule score is lower. These are the same scores `skinScan` uses.
- Cleanup: a few majority-vote passes over triangle neighbours remove speckle. Then only the connected arm component that contains the hand is kept; stray arm-labelled islands go back to `body`.
- Per-scan overrides go through the same colour- and region-aware `adjust` hook the scripts already use: Ruiz's tool pouches are body, and the coat panel behind Okafor's lowered left forearm is body.
- Alternative: find the crease from geometry (concave dihedral edges). It is more exact on paper, but noisy on scans. Kept as a refinement only if the score-based cut misses the crease visibly.

### 3. Cut only below the armpit, then cap each side
The cut uses the label boundary below a per-side armpit height `armpitY`. Above it the arm and shoulder stay connected. After the cut, each side has an open U-shaped edge: down the front crease, round the lowest contact point, and up the back crease, with both ends at the armpit.
- Each U is closed with a straight segment across the armpit and capped. The body's cap is a zipper strip: the opening is split into two chains at the arc-length midpoint of the U (for a closed loop, at its two farthest points), and the strip advances whichever side gives the shorter diagonal, so it follows the side of the body instead of a flat fan. Pairing by height was dropped: it joined the upper arm to the forearm across a bent elbow.
- Implementation update: the body's cap stays in view once `bodyModel` straightens an arm that was posed against the torso, and a bare zipper read as a fan of splinters there. The zipper is now the start of a membrane (`membraneCap`): interior points every 2 cm along each rung, Delaunay flips and relaxation in cylindrical coordinates about the torso axis. Within 4 cm of the cut (`band`) and over the cap, the torso's radius is relaxed toward an ellipse fitted per height plus a harmonic correction (at most 2.5 cm out), so the crease the arm pressed in fills out; normals there are recomputed. Body caps take part in weight smoothing; arm caps do not.
- The arm's cap is not a strip across the opening: each rim vertex is joined to the nearest point of the arm's bone axis (upper arm, forearm, hand), on a 5 mm grid shared by both sides of the opening, so the cap folds into the sleeve as a shallow, watertight groove whose points each ride on their own bone. A flat strip across a bent elbow turned into a fin once `bodyModel` straightened the arm.
- No ear-clip fallback was needed: closed loops (a forearm resting on the coat) use the same two caps.
- A crack in the scan (two rim vertices a millimetre apart that never welded) can break one opening into two traces; open traces that meet within 4 mm are chained into one opening before capping.
- Each cap is oriented as a whole (summed normal against the outward direction); per-triangle tests failed on collinear rims.
- Cap colour works as in the toolbox caps: every cap vertex shares the UV of one rim vertex picked by the caller. The default pick is the rim vertex nearest the cap's centre, so the cap is one flat patch of the cloth around it. Normals point away from the opposite piece (the torso cap faces out to the side, the arm cap faces in).
- Optional: bulge the cap outward by a fraction of each point's distance to the rim so it reads less flat. A per-scan number, default 0.
- Contacts lower down (Okafor's right hand on the coat skirt, his lowered left forearm on the coat front) are also label boundaries below the armpit, so the same step cuts and caps them.

### 4. Skinning respects the split
`skinScan` takes the triangle labels (passed as a per-vertex label after the split):
- Below the armpit, arm-labelled vertices may only use arm-chain bones, and body vertices may not use them. This is a hard mask, applied before smoothing.
- Smoothing already runs over the mesh graph, and the split disconnects the two sides below the armpit, so weights cannot leak across any more.
- Cap vertices take the label of the piece they close. Smoothing runs over the scan's own triangles only: cap triangles would tie the armpit corner to points on the bone axis.
- An arm's chain includes every hand bone (`Hand`, `HandMiddle1`, fingers): `bodyModel` maps them all onto the arm, so a body vertex near the hand (a tool pouch) must not keep them.
- The shoulder band above `armpitY` keeps today's soft blend. Under it, the mask eases in over `blend` (default 4 cm), so the top corner of the cut, where the pieces still share vertices, does not tear (it stretched 8x with a hard edge). The test's armpit line sits below that band.

### 5. Neck and face rules
`skinScan` gains a `neck` option: `{ collarY, axis: [x, z], radius, jawLineY }`, measured per scan.
- Inside the neck column (horizontal distance to `axis` < `radius`) and above `collarY`, chest and spine are masked out. Weight is an explicit gradient, not a capsule contest: all neck at `collarY`, blending to all head at `jawLineY` (smoothstep).
- Lower face: vertices above `jawLineY - margin` and in front of the neck column get head (and, through the existing jaw mask, jaw) weights only.
- Outside the column (the coat collar, the stethoscope, hair) the current capsule scoring is kept, so the collar and stethoscope stay with the chest.
- Alternative: just shrink the torso capsules and widen the neck capsule. Rejected: the collar and chin sit within a few cm of both capsules, so tuning radii keeps trading one artifact for another. An explicit mask states the rule directly.

### 6. Verification
- Tests in `src/actors/bodyModel.test.ts` cover the scan bodies (`doctor`, `ruiz`): mixed arm/body triangles below the armpit, posing the upper arms 30° by linear blend skinning over the prepared parts with no torso vertex moving, no edge of 3 mm or more stretching past 2.5x (sub-3 mm slivers at the cut corner and the shoulder crease reach 2.4-6x, as in the hand-rigged bodies; a fused seam reached 9x) and no open edge round the arms over 5 mm, no chest or spine weight above the collar, and lower-face vertices weighted to head or jaw only. Thresholds come from the joint positions (the armpit relative to `upperArm_*`, the collar relative to `neck`), so they hold at any body height.
- The posed preview used while exploring (arms out, look-at turns) becomes a dev script under `previews/`. It is used during tuning and is not shipped.
- A manual check in the intro kitchen and a walk, for Okafor and Ruiz.

## Risks / Trade-offs

- [The label boundary drifts off the crease and the cut shows as a jagged edge on the coat front] -> tune per side with `adjust` overrides, then judge with the posed preview from the front. If it is still visible, fall back to splitting before decimation (Decision 1) or to crease refinement (Decision 2).
- [Caps show in raised-arm poses] -> they use the surrounding cloth colour (white coat, navy coveralls), sit mostly under the arm, and can take an optional bulge.
- [The lowered left forearm's contact with the coat front is long and irregular, so the zipper misses] -> ear-clipping fallback, and the test for no open edges near the arms catches it.
- [The hand rig regresses: finger auto-skin needs hand weight >= 0.5, and the hand tests check curl axes] -> the hand stays in the arm label. The hand and body test suites run in the tasks.
- [Triangle count grows] -> caps add roughly hundreds of triangles per side, negligible next to 29-41k.
- [Hair on Ruiz's shoulders still rides with the chest] -> accepted (Non-Goals). A later neck/hair blend can come separately.

## Migration Plan

Re-run `scripts/fix-ruiz-glb.mjs` (Okafor was re-cast to a rigged model during implementation, built by `scripts/fix-doctor-glb.mjs`; see ADR-0026) with the sources in `previews/sources/`, and commit the rebuilt GLBs with the script changes. Rollback: revert the commit. The GLBs and scripts move together, and nothing at runtime depends on the new steps.

## Open Questions

- Cap bulge amount per scan (0 or a small fraction). It is tuned visually during implementation and does not affect the specs or the tasks.

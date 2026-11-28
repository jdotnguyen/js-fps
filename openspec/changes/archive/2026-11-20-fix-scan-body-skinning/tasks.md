# Tasks

## 1. Neck and face weighting (shared pipeline)

- [x] 1.1 Add a `neck` option to `skinScan` in `scripts/lib/scan-body.mjs` (`collarY`, `axis`, `radius`, `jawLineY`): inside the column and above `collarY`, mask out chest and spine and set an explicit neck-to-head gradient; above `jawLineY - margin` in front of the column, allow only head and jaw. Verify by building Okafor to a scratch path (`previews/`) and checking with the dump script that no vertex above the collar carries chest or spine weight
- [x] 1.2 Measure and set the `neck` parameters in `scripts/fix-okafor-glb.mjs` and `scripts/fix-ruiz-glb.mjs` (collar line, neck axis and radius, jaw line). Verify with a posed render of a ±40° look-at (head 22°, neck 8°) that each mouth keeps its shape and the coat collar, stethoscope and hair stay put
- [x] 1.3 Add `scan body: neck owns the neck and the lower face follows the head` tests to `src/actors/bodyModel.test.ts` for `doctor` and `ruiz`: no chest or spine weight above the collar (derived from the `neck` joint), and mouth/chin vertices weighted to head or jaw only. Verify they fail on the current GLBs and pass on the rebuilt ones
- [x] 1.4 Add the neck/face rule to the ADR-0026 addendum and verify the doc names the option and the per-scan parameters

## 2. Arm/body split and caps (shared pipeline)

- [x] 2.1 Add triangle labelling to `scan-body.mjs`: capsule-score seed (arm chain vs body), majority-vote cleanup, keep only the hand-connected arm component, plus a caller `adjust`-style override. Verify on Okafor's decimated mesh with a label-coloured render that each arm label covers sleeve and hand only
- [x] 2.2 Add the seam split: below a per-side `armpitY`, duplicate vertices shared by arm and body triangles. Verify with a synthetic two-box test (`src/actors/scanBody.test.ts`, importing the lib) that no vertex below the armpit is shared between the two labels afterwards
- [x] 2.3 Add the cap step: close each U-shaped opening with a segment across the armpit, triangulate as a zipper strip (body side; the arm side folds onto the bone axis instead, see design §3), give all cap vertices one rim texel picked by the caller, orient normals away from the other piece, and take an optional bulge. Verify in the synthetic test that both pieces have no open edges below the armpit and that cap normals face outward
- [x] 2.4 Make `skinScan` honour labels: below `armpitY`, arm vertices may only use arm-chain bones and body vertices may not, applied before smoothing; cap vertices take their piece's label. Verify in the synthetic test that no body vertex below the armpit carries arm weight after smoothing
- [x] 2.5 Turn the exploration's posed renderer (arms out, look-at turns, mixed-weight colouring) into a dev script under `previews/`, and verify it renders both bodies from a GLB path in one command
- [x] 2.6 Add the split-and-cap step to the ADR-0026 addendum and verify the doc lists the per-scan parameters (`armpitY`, overrides, bulge)

## 3. Okafor rebuild

Superseded after 3.3: the split still read as splintered on Okafor (his scanned forearm lay across the coat), so Justin re-cast him to BrushDip's rigged doctor, built by `scripts/fix-doctor-glb.mjs` without the scan pipeline. The separation tests now run on Ruiz only; the neck test still covers Okafor.

- [x] 3.1 Set Okafor's split parameters in `scripts/fix-okafor-glb.mjs`: per-side `armpitY`, overrides that keep the coat panel behind the lowered left forearm and the coat skirt under the right hand on the body, cap texel picks (white coat), and bulge. Verify with the dev script at 0° and 30° arm raises, front and back, that no coat band follows the sleeves and the cut follows the crease
- [x] 3.2 Rebuild `public/assets/models/squad/doctor.glb` and verify the existing doctor, hand-rig (30 finger bones, curl axes, weights summing to 1) and jaw tests still pass
- [x] 3.3 Add `scan body: arms move without dragging the torso` tests to `bodyModel.test.ts` (shared helper, `doctor` first): no mixed arm/body vertices below the armpit, at most 3% mixed triangles overall, a 30° arm raise moving no torso vertex and stretching no edge of 3 mm or more past 2.5x, and no open edge over 5 mm near the arms. Verify they fail on the old GLB and pass on the rebuilt one

## 4. Ruiz rebuild

- [x] 4.1 Set Ruiz's split parameters in `scripts/fix-ruiz-glb.mjs`: per-side `armpitY`, overrides that keep both tool-belt pouches on the body, cap texel picks (navy), and bulge. Verify with the dev script at 0° and 30° that the pouches stay on her hips and no coverall band follows the arms
- [x] 4.2 Rebuild `public/assets/models/squad/ruiz.glb`, extend the separation tests to `ruiz`, and verify the Ruiz, crew-body and jaw tests pass

## 5. Integration

- [x] 5.1 Run `npm run typecheck` and the full test suite, and verify everything passes apart from the two `slice01.test.ts` failures that predate this change (R02 draw calls, R12e desk/chair overlap)
- [x] 5.2 In the game, watch the intro kitchen (lean on the counter, coffee mug, talk gestures, look-at turns) and a walk with Okafor (rigged model) and Ruiz, and verify neither arm pulls the torso, no cap or hole draws the eye, and mouths hold their shape when the head turns **Closed 2026-11-27:** no recorded run; the product was accepted as it is.

## Workflow follow-up

- Archive the change once reviewed, which creates `openspec/specs/imported-body-models/spec.md`.
- Follow-up change: port Sung's, Heins's and Bram's bodies to the shared pipeline so they get the same fixes.

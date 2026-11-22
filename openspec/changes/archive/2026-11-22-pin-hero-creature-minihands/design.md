# Design

## Context

`prepareBodyModel` (`src/actors/bodyModel.ts`) maps each bone of an imported rig to one of the 21 game joints. `classify` matches bone names only. Any side-prefixed bone whose remaining name contains `hand|wrist|index|ring|pinky|thumb|finger` becomes `hand_<side>`. `mapRig` then gives each joint its pivot from the shallowest bone mapped to it.

In `necromorph_slasher.glb`, the belly arms hang from `Upper_Body_02`, which hangs from `Pelvis_01`:

```
Pelvis_01 -> Upper_Body_02 -> Left_Minihandbase -> Left_Minihand1 -> Left_Minihand2 -> Left_Minihand_Wrist -> L_MiniH_* (fingers)
          -> Spine1 ... -> Left_Collar -> Left_Upperarm -> Left_Forearm -> Left_Hand (blade)
```

`Left_Minihandbase`, `Left_Minihand1/2` and `Left_Minihand_Wrist` (and the right-side copies) all match `/hand|wrist/`, so they become `hand_L/R`. The `L_MiniH_*` fingers don't match, so they stay unmapped and follow their parent, which also puts them on `hand_L`. `Left_Minihandbase` is shallower than `Left_Hand`, so it wins the pivot. `Upper_Body_02` matches nothing and follows `Pelvis_01`.

A scan of all 21 entries in `src/data/body-models.json` found that only this rig has hand-named bones without a same-side forearm ancestor.

## Goals / Non-Goals

**Goals:**
- The belly arms ride the body part they grow from, so lifting a blade can't stretch them.
- The blade's `hand_L/R` pivot comes from `Left_Hand` / `Right_Hand`.
- A general rule, not a creature-specific name list, with zero mapping change for every other rig.

**Non-Goals:**
- Procedural motion for the belly arms (exploration option B).
- Changing how `Upper_Body_02` maps, retuning blade attacks, or editing the GLB.

## Decisions

**1. Structural rule: a hand-class bone needs a same-side forearm ancestor.** In `mapRig`, after `classify`, a bone classified as `hand_<side>` keeps that joint only if one of its ancestors is classified as `foreArm_<side>`. Otherwise its classification is cleared to "none". It then goes through the existing unmapped path: it follows its parent's joint and is listed in `unmapped`. Its descendants follow it.
- *Alternative: a name rule (`^mini`).* It's simpler, but it would only fix this one model. A future rig with, say, `Tail_Hand` or an extra pair of arms would hit the same bug.
- *Alternative: map secondary limbs to `chest`*, as worded during exploration. Rejected because the belly arms' roots sit on `Upper_Body_02`, which rides `pelvis`. Pinning the arms to `chest` would split them from the skin they grow out of whenever the spine bends, which is exactly the stretch being fixed. Following the parent keeps the arm and its root on the same rigid joint, whatever that joint is.

**2. Clear the classification before pivots are chosen.** The pivot loop then only sees real hand bones, and `Left_Hand` becomes the pivot of `hand_L` without any new pivot logic. The `handEnd` path (`/middle/`) is covered by the same ancestor check.

**3. Ancestor check by walking parents, using the already computed `cls`.** Rigs have fewer than 100 bones, and preparation runs once per model load, so the cost doesn't matter.

**4. Measured root weights (task 1.1): follow the joint with the most root weight, not the parent bone.** On `necromorph_slasher.glb`, 80 of the 587 vertices that touch a `*Mini*` bone are boundary vertices (mini weight between 0 and 0.98). Their weight outside the mini-arm is 67.3% `Spine1_03`, 25.9% `Upper_Body_02` and 6.7% `Pelvis_01`. `Spine1_03` resolves to the game's `spine` joint, while `Upper_Body_02` and `Pelvis_01` resolve to `pelvis`. Following the parent bone would therefore put the arms on `pelvis` and tear them from the two-thirds of their root that bends with the spine. So for each secondary limb (a topmost cleared bone and its whole subtree), `mapRig` sums the outside weight on its boundary vertices per bone and binds the subtree to the joint of the heaviest bone. It falls back to the parent bone's joint when the mesh has no boundary vertices. For this rig, both belly arms bind to `spine`.

## Risks / Trade-offs

- [The blade pivot moves from belly height to the wrist, so blade swings, hit capsules and the kill grips (`npcKills.ts:770`, `:813`, `:914`) now come from a different point.] → This is the intended fix, but it's visible. Playtest the end fight, Voss's death and the R08 creature, and retune only if a grip or attack lands wrong.
- [The belly arms will look rigid.] → Accepted for this change. Option B (a small, bounded twitch) remains a follow-up.
- [The skin at the belly-arm roots may be weighted partly to `Spine1` rather than `Upper_Body_02`, which would leave a seam when the spine bends.] → Task 1.1 measures the root ring's dominant weights before the rule is coded. If the roots are mostly spine-weighted, have the secondary limb follow the joint that carries most of its root weight instead of its parent bone.
- [Some other rig later relies on a hand bone outside a forearm chain.] → The "ordinary rigs are unaffected" test runs over every body-models entry and pins the current mapping.

## Migration Plan

This is a code-only change with no saved data or asset migration. To roll back, revert the classifier change.

# Design

## Context

See proposal.md (Why) for the problem. Here is how the posture currently gets into the game:

- `scripts/bake-mocap.mjs` retargets each source take onto the canonical 21-joint skeleton. After that it only blends the loop seam, re-centres the pelvis horizontally, fixes hand and leg clearance, and (for holds) subtracts the mean pose. Nothing touches the average trunk angle, so a take's posture lands in the game exactly as the performer stood.
- In the skeleton, `pelvis -> spine -> chest -> neck -> head`, with the thighs on the pelvis and the shoulders on the chest. A negative X rotation nods forward (`src/actors/skeleton.ts`).
- The world-space pitch of each segment's up vector, averaged over each standing idle and talk clip (negative is forward):

  | clip | pelvis | spine | chest | head | lower back bend | upper back bend |
  |---|---|---|---|---|---|---|
  | rest of the cast | -8..+7 | -11..+8 | -16..+10 | -21..+15 | -9..+3 | -15..+8 |
  | `bram_idle` | -16 | -34 | -10 | -7 | -18 | **+24** |
  | `bram_talk` | -11 | -16 | +14 | +15 | -5 | **+30** |

  A positive upper back bend means the chest bends backwards relative to the lower back.
- Bram's additive clips (`bram_hold`, `bram_work`, `bram_coffee`, `bram_drink`) store offsets from their own mean pose, so they carry no average tilt. Under the standing-posture-stability spec they play over `bram_idle`'s trunk, which is why every action he does shows the curve.

## Goals / Non-Goals

**Goals:**
- A bake-time correction that any clip can opt into, so the fix lives in data rather than as a special case at runtime.
- A check that keeps the limits for every pack, current and future.

**Non-Goals:**
- Any runtime posture correction in `animator.ts`. The trunk under upper-body actions stays as the standing-posture-stability spec describes it.
- Changing the turning, yaw or side-lean of any clip. Only forward/back pitch is levelled.
- Levelling locomotion clips. Walks and jogs lean into their speed on purpose, and Bram's walk and jog (Bandai) aren't the problem.

## Decisions

### D1. Level at bake time, per clip, opt-in (`"levelTrunk": true` in `mocap.sources.json`)

The correction runs after retargeting and before the seam blend, clearance fix and additive step, so every later step sees the levelled pose.

- **Alternative: runtime `style.posture` offset.** Rejected. It tilts the whole torso by one angle, while the problem is how the bend is split between pelvis and chest (forward at the bottom, backward at the top). It would also apply to clips that are fine.
- **Alternative: re-source Bram's idle and talk.** Kept as a fallback. CMU subject 80 has the kitchen character we picked it for, and an upright replacement with the same feel isn't guaranteed. Levelling keeps the takes.
- **Alternative: always on for every clip.** Rejected. Other clips pass the limits, and re-baking every pack changes motion nobody has complained about.

### D2. What levelling does

1. Measure the clip's average world pitch for the pelvis, spine and chest segments, as in the table above.
2. Choose targets:
   - Pelvis tilt goes to 0.
   - The trunk's total lean, measured at the chest, is kept within 10° forward and 3° back. A cook who leans slightly toward his work keeps a slight lean, but nobody stands leaning back.
   - The lean is spread evenly over the lower and upper back, so neither bends against the other.
3. For every frame, rotate the pelvis, spine and chest locals about X by the constant difference between average and target. Everything that moves around the average stays as it was.
4. Counter-rotate the children that should keep their world angle:
   - Thighs keep their world orientation, so feet and knees don't move. The pelvis height is then refit so the feet keep their source height.
   - Neck and head ride with the chest, like the arms, so they keep the performer's pose against the chest. A head tipped back only because the trunk was (`bram_talk`: chest 13° back, head 15° back) comes level with it. Runtime gaze still turns the head on top.
   - Shoulders are **not** counter-rotated either, so the arms ride with the straightened chest. That is the point: his arms stop hanging off a forward chest.

This touches only forward/back pitch, so turning and side-lean are untouched. Foot-contact and clearance checks run afterwards and still have to pass.

### D3. Limits: pelvis within 10°, upper back at most 12° backwards

The spec uses 10° rather than the ±8° quoted while exploring. Voss's idle sits at -8, and a limit right on a passing clip turns rounding into failures. 12° clears the cast's largest backward upper bend (+8, Priya's idle) and is half of Bram's. The check measures with the same method as the table (world pitch of each segment's up vector, averaged over frames). It reads only the baked JSON, so it is cheap in Node with no bodies loaded.

### D4. Bram's seated, crouching and kneeling holds

Keep `bram_hold` for every posture family, as before, now re-baked from the levelled take.

The first plan dropped his sit, crouch and kneel holds, so those postures would fall back to the shared treatment. Implementing it showed that was wrong:
- The whole cast layers its standing `_hold` clip onto those postures (Giles, Okafor, Ruiz, Heins, Hale, Sung).
- per-character-motion's character-motion spec requires every named profile to cover sitting, crouching and kneeling, and the cast motion sandbox marked the dropped cells as fallbacks.
- A hold is additive (offsets from its own mean pose), so it carries no average tilt and played no part in the swayback.

The user chose to restore them, and the change no longer adds a holds requirement.

### D5. Remove Bram-specific workarounds where the lean made them necessary

per-character-motion pins hands (`anchorHandsOnHips`, `anchorCrossedArms`) and notes that Bram "can't stand hands on hips". After levelling, re-run `armPoses.test.ts`:
- Keep the pins. They are general and cost nothing.
- Add Bram to the hands-on-hips coverage if he now passes it.
- Update that design note in per-character-motion only if the user asks. This change doesn't edit that change's artifacts.

## Risks / Trade-offs

- [A levelled chest moves his hands, which could break the hand-off (`bramServe.test.ts`: within 3 cm, mug within 10°)] → The hand-off poses set the arm. If his hand drifts, re-tune his `bram_offer_mug` pose override rather than loosening the test.
- [Removing a 16° pelvis tilt changes how far the legs reach and how the feet sit] → The thighs are counter-rotated and the pelvis height is refit (D2.4). The clearance and foot checks fail the bake rather than ship sliding feet.
- [The source performer's weight shifts were coupled to the tilt, so levelling could make him look stiff] → Only the constant average is removed, never the motion. Check this by eye in the cast motion sandbox against the old bake.
- [His hand-built skeleton (hips only 2 cm above the thighs) may still swing the trousers on pelvis motion] → Out of scope. If it still reads wrong after levelling, open a rig change for `fix-bram-glb.mjs`.
- [Re-baking touches the shared `bram.json` while per-character-motion is in flight] → Only Bram's clips change. Re-run `mocapPacks.test.ts` and `castMotionCoverage.test.ts`.

## Migration Plan

Re-bake with `scripts/bake-mocap.mjs`, which rewrites `src/data/mocap/bram.json`. No save or format change. To roll back, remove `levelTrunk` from Bram's entries and re-bake.

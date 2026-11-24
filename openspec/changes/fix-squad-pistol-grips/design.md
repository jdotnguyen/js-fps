# Design

## Context

See `proposal.md` for motivation. Both Okafor and Giles currently share `pistol_idle` in `src/data/mocap-core.json` for `aimPistol`. Because `prepareBodyModel` in `src/actors/bodyModel.ts` aligns `hand_R` direction to `-Y` without normalizing its roll around `-Y`, `doctor.glb` (Okafor) retains a ~42° rest-hand roll (`palm = [-0.75, 0.16, -0.64]`, `up = [0.66, 0.11, -0.74]`). Meanwhile, `pistol_idle`'s fixed left-arm angles leave Giles's `hand_L` 6.3 cm below and 4.7 cm behind `hand_R` (12.0 cm from the grip).

## Goals / Non-Goals

**Goals:**
- Compensate `doctor.glb`'s rest `hand_R` roll in `okafor_pistol` so Okafor's pistol bore and right palm match the canonical `pistol_idle` orientation without hitting `AIM_CLAMP` (30°).
- Adjust `upperArm_L`, `foreArm_L`, and `hand_L` in `giles_pistol` so Giles's left hand cups directly beneath his right hand and pistol grip.
- Keep `bodyModel.ts`, `heldProps.ts`, `humanoid.ts`, and all other poses (`biometric_scan`, `okafor_coffee`, mugs) untouched.

**Non-Goals:**
- Changing rest-pose hand roll in `prepareBodyModel` (`src/actors/bodyModel.ts`) or modifying `pistol_idle` for generic crew.
- Adding runtime two-bone IK for the left support hand when `aimHeldPistol` swings `upperArm_R` toward off-axis targets.

## Decisions

1. **Per-character `aimPistol` clips (`okafor_pistol`, `giles_pistol`) over `bodyModel.ts` rest-roll normalization**
   - *Rationale*: Normalizing `hand_R` roll in `prepareBodyModel` affects every pose and clip for `doctor.glb` (including `biometric_scan` and mug holds) and risks wrist-skinning pinch. Adding `okafor_pistol` in `src/data/mocap/okafor.json` and `giles_pistol` in `src/data/mocap/giles.json` isolates the fix to `aim_pistol`.
   - *Alternative considered*: Runtime `gripFrame`-based compensation or `solveTwoBone` left-hand anchor in `humanoid.ts` — rejected to keep the change data-driven and minimal.

2. **Computing `okafor_pistol` `hand_R` rotation mathematically from `pistol_idle`**
   - *Rationale*: Apply the relative rotation between `doctor.glb`'s rest `hand_R` frame and the canonical (`mechanic.glb`) rest `hand_R` frame to `pistol_idle`'s `hand_R` track across all frames, preserving the clip's subtle breathing/sway motion.

## Risks / Trade-offs

- **Off-axis `aimTarget` drift on Giles's left hand** → When `aimHeldPistol` swings `upperArm_R` up to `ARM_AIM_CLAMP` (15°), `hand_L` does not track `hand_R` dynamically. Acceptable for now; a runtime `solveTwoBone` anchor can be added later if needed.
- **Test assumptions on `aimPistol`** → `src/actors/mocapPhysics.test.ts` checks `aimPistol === 'pistol_idle'` only for non-`OWN_MOTION_LANDED` characters; both `okafor` and `giles` are in `OWN_MOTION_LANDED`.

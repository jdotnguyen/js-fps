# Proposal

## Why

In the intro kitchen Bram stands in a swayback: his butt sticks out and his chest pushes forward. The intro camera holds on him while he talks, so it is easy to see. The posture comes from his own mocap, not his rig. His idle (`bram_idle`, CMU `80_37`) bakes his pelvis tipped about 16° forward and his lower spine folded another 18°, with the upper back bent about 24° backwards to keep him balanced. His talk (`bram_talk`, `80_14`) has the same shape and tips his head back about 15°. Every other character's standing idle keeps the pelvis within ±8°. The bake pipeline has no way to level a take's trunk, and the posture spec keeps the idle's trunk under upper-body actions, so `offer_mug`, `typing` and his coffee layer all show the same curve. per-character-motion worked around it with hand pins (and by never giving him hands-on-hips) rather than fixing it.

## What Changes

- Add an opt-in trunk-levelling option to the mocap bake (`scripts/bake-mocap.mjs`, `scripts/mocap.sources.json`). It removes a clip's average forward/back tilt from the pelvis, spine and chest, spreads what remains evenly up the spine, and keeps the motion around that average. The legs keep the angles they had in world space, and the arms, neck and head move with the chest.
- Turn it on for Bram's standing clips (`bram_idle`, `bram_talk`, and the takes his additive holds come from) and re-bake the `bram` pack.
- Add a cast-wide check that every standing idle and talk clip stays within the cast's posture limits, so a new pack can't bring the swayback back.
- Once his chest sits back over his hips, remove the Bram-specific hand-pin allowances that existed only because of the lean, where they are no longer needed.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `standing-posture-stability`: adds a requirement that standing idle and talk mocap stays upright within cast-wide limits, with no forward-tipped pelvis and backward-bent chest, including under upper-body actions that inherit the idle's trunk.

## Impact

- `scripts/lib/bvhBake.mjs`, `scripts/bake-mocap.mjs`, `scripts/mocap.sources.json`: the new option, its bake log and Bram's entries.
- `src/data/mocap/bram.json`: re-baked (size about the same).
- Tests: a new posture check (likely next to `castMotionCoverage.test.ts` or `mocapPacks.test.ts`). Re-verify `bramServe.test.ts` (mug upright, offering hand within 3 cm) and `armPoses.test.ts` (crossed arms on Bram).
- Shares Bram's data with the in-flight `per-character-motion` change (task 6.6 landed him) without changing that change's artifacts.
- Out of scope: re-rigging `bram.glb` (`scripts/fix-bram-glb.mjs`). That only comes up if a level trunk still looks wrong on his skeleton.

# Proposal

**Status: parked** (2026-11-25). Do not start until `adopt-physics-engine` is archived and the slice has enough combat to show ragdolls off.

## Why

Every kill ends in one of three authored corpse poses (`Humanoid.die`), whatever the shot, the slope or the furniture. Corpses are not physical, so they cannot be shot apart, stomped aside or drape over anything. These blocks were planned as Blocks 3 and 4 of `adopt-physics-engine` and were moved out because `slice01` places only five enemy spawns (one in R06, four in R09), and the R09 group is removed when the valve is turned.

## What Changes

- **Death ragdolls.** A killed humanoid hands its body to a ragdoll built from its skeleton. Joints that have been severed are left out. The ragdoll settles and then freezes into a static pose, so idle corpses cost nothing. The authored corpse poses stay as the fallback.
- **Powered ragdolls.** Each body is driven toward the animator's pose (a world-space spring, since the engine trial showed joint motors cannot hold the chain), so hits push the body physically and recover. Death fades the drive out instead of switching instantly, and play-dead and get-up blend between ragdoll and animation.
- **Corpses join the interaction.** The player pushes ragdolled corpses, and a stomp moves them.
- **Budgets.** A cap on active ragdolls, and settling the oldest bodies early when the physics step runs over budget.

## Capabilities

### New Capabilities
- `ragdoll`: physical bodies for humanoids, covering death ragdolls, settling and freezing, severed-joint handling, powered (pose-driven) ragdolls, and blending with play-dead and get-up.

### Modified Capabilities
- `physics-world`: switches for death and powered ragdolls, and settling the oldest bodies when over budget.
- `physical-interaction`: the player and the stomp move corpses.

## Impact

- **Code:** `src/physics/ragdoll.ts` (new, from `trialRagdoll.ts`); `src/actors/humanoid.ts` (`die`, `playDead`, `getUp`, hit reactions); `src/actors/animator.ts` (pose targets); `src/physics/world.ts` (budget); `src/physics/interaction.ts` and `src/actors/stomp.ts` (corpses).
- **Depends on:** `adopt-physics-engine` (engine, world, level mirror, debris, switches).
- **Other work:** `per-character-motion` is archived, so it no longer blocks these files. Powered ragdolls build on the existing hand physics (`handPhysics.ts`, `limbContact.ts`) rather than replacing it. Authored kills (`infection-kills`) stay authored.
- **Known gap:** the engine trial used only the procedural body. Imported bodies need joint frames taken from their rest pose.

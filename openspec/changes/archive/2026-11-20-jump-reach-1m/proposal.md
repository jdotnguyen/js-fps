# Proposal

## Why

Jay's jump reach is an accident of the motor rather than a decision. While airborne, the motor still applies its 0.35 m
step-up on top of the jump's apex (about 0.58 m at the 60 Hz step), so Jay can get onto anything up to about 0.93 m
(desks at 0.75 m and counters at 0.90 m included), while ADR-0004 says the jump "clears knee-high props" and `jump.test.ts` only checks a
0.55 m crate. Justin decided the reach should be a deliberate, round number: **1.00 m**.

## What Changes

- Jay's jump reaches a top up to **1.00 m above the floor he jumped from** [Decided]; anything clearly higher blocks
  him, as a full-height wall does today.
- The reach is a named, tested value instead of falling out of `jumpSpeed`, `gravity` and `stepHeight` together, so
  changing one of them cannot silently change what Jay can climb.
- Everything else about the jump stays as it is: Space, ground only, not on rails, downed, wading or on a scripted walk,
  a ceiling stops the rise, landing plays a footstep.
- ADR-0004 is brought up to date: the jump row states the 1.00 m reach, and the stale "No jump means level design
  never relies on it" consequence and "linear box scan" gap note are corrected.

## Capabilities

### New Capabilities
- `player-movement`: how Jay moves through the level: walking, sprinting, stepping, and jumping (when it is allowed,
  how high he gets, what he can get onto, and what stops him).

### Modified Capabilities
- None (no specs exist yet).

## Impact

- Code: `src/actors/motor.ts` (`DEFAULT_MOTOR`, airborne step-up in `settleVertical` / `blocksBody`),
  `src/actors/player.ts` (`PLAYER_TUNING.jumpSpeed`), and `src/actors/jump.test.ts` (reach at 0.75, 0.90, 1.00 and a
  blocking height above 1.00). Enemies, squad and NPCs share the motor but never jump; their stepping must not change.
- Docs: `docs/adr/0004-player-controller.md`.
- Gameplay: desks, counters and other tops up to 1.00 m become places Jay can stand. The navmesh only climbs 0.35 m,
  so enemies cannot follow him up there. Justin accepted this for now [Decided]: it is documented, and solved later
  only if playtests show players using it to cheese fights.
- Level design: anything meant to stop Jay must be taller than 1.00 m.

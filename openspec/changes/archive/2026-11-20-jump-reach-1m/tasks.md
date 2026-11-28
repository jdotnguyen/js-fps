# Tasks

## 1. Motor: jump-only air step

- [x] 1.1 Export the fixed simulation step (`SIM_STEP = 1 / 60`) from `src/core/loop.ts` and make `Loop` default to it; verify `src/core/loop.test.ts` passes unchanged.
- [x] 1.2 Add `jumpReach` (1.00 m) to `MotorConfig` / `DEFAULT_MOTOR`, an optional `jumping` flag to `MotorState` (absent = false), and an `airStep(cfg)` helper that returns `max(stepHeight, jumpReach - hold)`, `hold` being the height the arc integrated at `SIM_STEP` keeps for its 4 highest frames; verify with new unit tests that `airStep` is ~0.422 m for the default config, that `hold` + `airStep` equals 1.00 m (within 1 mm) and apex + `airStep` stays under 1.02 m for the default and for retuned `jumpSpeed` / `gravity` pairs.
- [x] 1.3 While `jumping`, use `feetY + airStep` instead of `feetY + stepHeight` for the sideways block and the floor-probe limit, and clear `jumping` on landing; verify new `jump.test.ts` cases pass: at walking speed, 0.75, 0.90 and 1.00 m tops are mounted, a 1.10 m top, a 1.02 m top at sprint speed and a full-height wall block, a jump from a 0.50 m platform mounts a 1.50 m top, and a walk-off fall (no jump) keeps the 0.35 m limit.
- [x] 1.4 Return the height gained when an airborne body lands on a top above its feet as `stepUp` from `moveBody`; verify with a test that mounting a 0.90 m counter reports `stepUp` > 0 and a flat landing reports 0.

## 2. Motor: headroom before mounting

- [x] 2.1 Before accepting a higher top as floor, check the footprint for any underside between the top and `top + height`, and treat a top without headroom as blocking (sideways and as floor); verify new tests: a 0.90 m counter with a cabinet underside 1.20 m above it blocks the jump, the same counter in an open 3.2 m room is mounted, and a non-jumping body walking into a 0.75 m desk is blocked as before.
- [x] 2.2 Verify the shared motor did not change for walkers: `npm test` passes with every existing motor, player, enemy, squad, NPC and scripted-walk test unchanged (`motor.test.ts`, `player.walk.test.ts`, `world/slice01ScriptedWalks.test.ts`, `world/slice01Walks.test.ts`).

## 3. Player: jump wiring, feel and ADR

- [x] 3.1 In `src/actors/player.ts`, set `body.jumping` when a jump starts (the existing guards stay: ground only, not locked, downed, dead, wading or on a scripted walk) and feed the airborne `stepUp` into `stepOffset`; verify with a player test that mounting a counter eases the camera height over several frames instead of moving it in one, and that exactly one landing footstep is emitted.
- [x] 3.2 Update `docs/adr/0004-player-controller.md`: the jump row states the 1.00 m reach (with headroom), Consequences replaces the stale "No jump means level design never relies on it" line with the reachable-tops rule and the accepted enemy-reach trade-off [Decided], and the "linear box scan" gap note says `CollisionWorld` now implements `ColliderQuery`; verify by reading the ADR against `specs/player-movement/spec.md`.
- [x] 3.3 Walk test in the browser (`npm run dev`, slice01): Justin jumps onto a kitchen counter and a desk, fails to get onto anything taller than 1 m or under a cabinet, and confirms the jump arc feels the same as before; verify by Justin's sign-off. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.

## 4. Slice review: newly reachable tops

- [x] 4.1 Add a headless check (via `world/headlessSlice.ts`) that lists every collider top in slice01 between 0.35 and 1.00 m with headroom, grouped by room; verify it runs under `npm test` and prints the list.
- [x] 4.2 Add the combat-space rule to `docs/surface-dressing-standard.md` §5 (keep climbable tops, 0.35-1.00 m with headroom, out of a fight's footprint, or accept Jay can stand on them); verify the rule names the same heights as the spec.
- [x] 4.3 Justin reviews the 4.1 list once and flags any spot that must not be reachable (skipped trigger, out-of-bounds, fight cheese); verify each flagged spot has a follow-up (raised prop, blocker or trigger height) or is marked accepted. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.

## 5. Integration

- [x] 5.1 Run `npm run typecheck`, `npm test` and `npm run build`; verify all three succeed. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.

## Workflow follow-up

- Archive the change once Justin has signed off the walk test (3.3) and the reachable-tops review (4.3).
- Verify the archived result: `openspec/specs/player-movement/spec.md` exists with its Purpose and requirements.

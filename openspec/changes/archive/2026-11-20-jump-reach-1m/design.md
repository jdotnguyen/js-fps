# Design

## Context

See proposal.md (Why). The requirements are in `specs/player-movement/spec.md`.

- `src/actors/motor.ts` is shared by Jay, enemies, squad and crew. A box blocks sideways movement when its top is above
  `feetY + stepHeight` (`blocksBody`), and the floor probe accepts tops up to the same height (`settleVertical`). The
  check is the same whether the body is grounded or airborne, and nothing in `MotorState` says a body is jumping.
- With `jumpSpeed` 5 m/s, `gravity` 20 and the fixed 1/60 s step (`core/loop.ts`), the integrated apex is ~0.583 m
  (the analytic v^2/2g is 0.625 m; semi-implicit Euler loses ~4 cm). Reach today is therefore ~0.583 + 0.35 = 0.93 m.
- An airborne body that crosses onto a higher top is set to that top in one step (`s.y = ground`), and
  `settleVertical` returns `stepUp` only on the grounded branch, so the camera's step smoothing never sees it. Today
  that snap can be up to 0.35 m.
- Nothing checks headroom when a body steps or lands on a top: the ceiling check only runs while rising.
- Rooms and corridors are at least 3.2 m tall (`ROOM_H`, `CORRIDOR_H`), so ceilings are clear of a 1.00 m top
  (1.00 + 1.75 = 2.75 m). Overhead props (wall cabinets, shelves, pipes) are not.

## Goals / Non-Goals

**Goals:**
- Jay's reach is exactly what the spec says at the game's fixed step, and stays so if `jumpSpeed`, `gravity` or
  `stepHeight` are retuned.
- The jump arc and its feel stay as they are now [Decided].
- Bodies that never jump keep their exact behaviour; the existing motor tests pass unchanged.

**Non-Goals:**
- Mantling or ledge-grab animation: Jay still just lands on the top.
- Letting enemies reach a raised Jay. Accepted for now [Decided]; see Risks.
- Per-prop "not climbable" flags.
- Debris, navmesh or AI changes.

## Decisions

### 1. A jump-only air step, sized from the arc
`MotorConfig` gains `jumpReach` (1.00 m). `MotorState` gains a `jumping` flag, which the player sets with `vy` when a jump
starts and the motor clears on landing. While `jumping`, the sideways-block and floor-probe limit is
`feetY + airStep` instead of `feetY + stepHeight`, where

`airStep = max(stepHeight, jumpReach - hold(jumpSpeed, gravity, step))`

where `hold` is the height the integrated arc keeps for its `REACH_FRAMES` (4) highest frames at the loop's fixed
step (`SIM_STEP`, 1/60), computed once per config (~0.422 m today). For those 4 frames (~67 ms) the limit is at least
takeoff floor + 1.00 m, peaking ~1.006 m at the apex; earlier or later in the arc it is lower, so the player has to time
the jump, as with a real hop. The window exists because the body only gets onto a top once its floor probe is over
it: at walking speed it needs about 3 frames past the edge, so a window of the 2 apex frames alone would let only a
sprinting jump reach 1.00 m [Decided: Justin chose the window over an exact apex].

Why this shape:
- It keeps the arc (Justin chose "keep jump feel"), so headroom and the low-ceiling behaviour are untouched.
- It is relative to the feet, so reach is measured from the takeoff floor (spec: platform scenario) for free.
- The largest pop onto a top is `airStep` (~0.42 m) and only near the apex, which the camera can ease (Decision 3).

Alternatives considered:
- **Raise `jumpSpeed` to ~5.3 m/s**: simplest, but Jay jumps visibly higher and needs more headroom. Rejected by Justin.
- **Limit = takeoff floor + 1.00 m, whatever the current height**: lets a late jump, already falling to ~0.1 m, snap up
  ~0.9 m onto a top in one step, which reads as a teleport. Rejected.
- **Analytic apex (v^2/2g)**: over-estimates the real apex by ~4 cm at 60 Hz, so the 1.00 m scenario would fail.
  Rejected in favour of the integrated arc at the fixed step.
- **Exact apex (the 2 highest frames)**: reach is exactly 1.00 m, but a walking jump tops out at ~0.99 m because the
  body cannot get over the edge in 2 frames. Rejected by Justin in favour of the 4-frame window (peak ~1.006 m).

### 2. Headroom check before mounting
When the floor probe picks a top higher than the body's current feet, the motor checks the footprint for any
underside between that top and `top + height` (the same query `ceilingHeight` already does). If there is one, the top
is treated as blocking: sideways it stops the body, and vertically it is not taken as floor. This applies to every
body, but walking bodies only ever mount 0.35 m steps, where kit levels have no overhead props, so their behaviour does
not change in practice. The existing motor tests check that.

### 3. The airborne mount feeds step smoothing
`settleVertical` reports the height gained when an airborne body lands on a top above its feet as `stepUp`, as the
grounded branch does. `player.ts` already turns `stepUp` into `stepOffset`, so the camera eases up instead of popping.
For other bodies it is a no-op, since they ignore `stepUp`.

### 4. Tests own the numbers
`jump.test.ts` gains the spec scenarios: 0.75, 0.90 and 1.00 m tops mounted, 1.10 m blocked, a full-height wall,
reach measured from a 0.5 m platform, a cabinet over a counter, a walk-off fall keeping the 0.35 m limit, and a
non-jumping body against a 0.75 m desk. Each runs at walking speed from a start distance where the box is reached
near the apex. A separate check asserts `airStep` against the integrated apex, so retuning `jumpSpeed` or `gravity`
keeps the 1.00 m reach (Goal 1), plus a 1.02 m top that blocks even a sprinting jump (the window's ceiling).

### 5. Docs
ADR-0004: the jump row states the 1.00 m reach, and Consequences now says that tops up to 1.00 m with headroom are
reachable and enemies cannot follow. The stale "No jump" consequence and the "linear box scan" gap note are corrected.
`docs/surface-dressing-standard.md` §5 gains one rule: in combat spaces, keep climbable tops (0.35-1.00 m with
headroom) out of the fight's footprint, or accept that Jay can stand on them.

## Risks / Trade-offs

- [Jay can reach spots the slice did not plan for: over counters, onto desks, skipping a trigger volume] → A test lists
  every collider top in slice01 between 0.35 and 1.00 m with headroom, per room, for Justin to review once; triggers
  that matter get a height or a blocking prop.
- [Enemies cannot reach Jay on a raised top: fights can be cheesed] → Accepted for now [Decided]. Documented in
  ADR-0004 and the dressing standard; revisited if a playtest shows it.
- [`airStep` is tied to the 1/60 step: changing the loop's step changes the integrated apex by a few cm] → The apex is
  computed from the same step constant the loop uses, and the test fails if they drift.
- [Voxelised imported levels (the parked lab) have many chunky 0.35-1.00 m tops] → Out of scope; the lab is parked.

## Migration Plan

None. No saved data stores motor state. Rollback is reverting the change: `jumping`/`jumpReach` default to
off/`stepHeight`, which gives today's behaviour.

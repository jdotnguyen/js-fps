# Design

## Context

See `proposal.md` for motivation and `specs/transit-wing/spec.md` for behavioral requirements.

The 3-stage abyssal transit ride is orchestrated by `TransitRideController` (`src/game/transitRide.ts`), which coordinates three separate `transit_train_shell` props in `src/data/levels/slice01.json` (`r15a_train`, `r15b_train`, `r16a_train`) and the scrolling hallway rig `transit_sea_tunnel_rig` in `src/world/kit/transit.ts`.

Currently:
1. Stage 1 (`pullout`) accelerates `r15a_train` `14 m` over `3.8 s` on a quadratic `u^2` curve, exiting at `PULLOUT_END_SPEED = 2 * 14 / 3.8 ≈ 7.368 m/s`. At `u >= 1`, `TransitRideController` immediately emits `transit:tunnel_scroll` with `speed: TUNNEL_SPEED` (`20 m/s`), causing a 2.7x single-frame speed jump.
2. `r15a_train` and `r15b_train` have `length: 10.4` (`hl = 5.2 m`), while `r16a_train` has `length: 9` (`hl = 4.5 m`) so its tail clears `r16a_north` (`z = 30.125`) when parked at `z = 35` inside `R16a` (`z = 30..42`). Because `handoffToCabin` preserves the player's offset `dz` from car center while `trainShell` lays out the windshield, roof ribs, straps, and benches from `±hl`, the entire front half of the cabin snaps `0.7 m` backward around the player at the Stage 2 -> Stage 3 cut.
3. `transitSeaTunnelRig` integrates `gateWallZ -= speed * frameDt` in its render-loop `pb.tick`, whereas `TransitRideController` arms `rig_gate` and cuts to Stage 3 in the fixed-step `update` loop, allowing small frame-timing drift between `rig_gate` and `r16a_north` at the cut.

## Goals / Non-Goals

**Goals:**
- Make Stage 1 -> Stage 2 speed completely continuous (`PULLOUT_END_SPEED` -> smooth ramp -> `TUNNEL_SPEED` -> smooth decel -> `GLIDE_START_SPEED`).
- Eliminate the cabin-reposition jank at Stage 2 -> Stage 3 by unifying all three train cars to identical `9.0 m` shells.
- Eliminate `rig_gate` approach drift by computing `gateWallZ` analytically from `TransitRideController`'s exact remaining travel distance.

**Non-Goals:**
- Changing `R16a`'s room footprint, parked car position (`z = 35`), platform guard rail gap, or Stage 3 glide distance/duration (`15 m` / `9 s`, `5.0 m/s` start).
- Changing `TUNNEL_SPEED` (`20 m/s`) or `DEFAULT_TUNNEL_SECONDS` (`8.0 s`).
- Reworking Stage 1's `14 m` / `3.8 s` pull-out distance or duration.

## Decisions

### 1. Unify all three train shells to `length: 9` (Option A)
- **Choice**: Change `r15a_train` and `r15b_train` in `src/data/levels/slice01.json` from `length: 10.4` to `length: 9`, matching `r16a_train`.
- **Rationale**: `r16a_train` is constrained by `R16a`'s `z = 30..42` dock and `z = 35` boarding gap. Matching `r15a_train` and `r15b_train` to `9 m` requires zero layout changes in `R16a` (or in the in-flight `r16a-visual-overhaul` change), keeps `R15a`'s centered boarding doorway and `r15a_train_inside` anchor aligned, increases `r15a_train` tail clearance past `r15a_south` (`52 - 4.5 = 47.5 > 45.875`), and matches `handoffToCabin`'s `±3.6 m` clamp comfortably inside the `±4.0 m` walkable cabin interior.
- **Alternative considered**: Keeping `10.4 m` and moving `r16a_train` south to `z = 36`. Rejected because it would shift `R16a`'s guard-rail boarding gap, platform exit path, and `r16a-visual-overhaul` lighting/prop placements.

### 2. Three-phase Stage 2 speed profile (accel -> cruise -> decel)
- **Choice**: Define `PULLOUT_END_SPEED = (2 * R15A_PULLOUT_DIST) / PULLOUT_SECONDS` (`~7.368 m/s`) and `MAX_ACCEL_SECONDS = 2.2` (capped proportionally for short rides: `accel = Math.min(MAX_ACCEL_SECONDS, total * 0.35)` alongside `decel = Math.min(MAX_DECEL_SECONDS, total * 0.55)` so `accel + decel <= total` even at `MIN_TUNNEL_SECONDS = 3`).
  - **Accel phase** (`e < accel`): smoothstep S-curve `s = u * u * (3 - 2 * u)` where `u = e / accel`, `speed(e) = PULLOUT_END_SPEED + (TUNNEL_SPEED - PULLOUT_END_SPEED) * s`. Smoothstep has zero derivative at both ends, giving a gentle ramp out of Stage 1's acceleration and a soft merge into cruise.
  - **Cruise phase** (`accel <= e < total - decel`): constant `TUNNEL_SPEED` (`20 m/s`).
  - **Decel phase** (`e >= total - decel`): linear ramp from `TUNNEL_SPEED` down to `GLIDE_START_SPEED` (`5.0 m/s`), preserving the existing arrival feel and exact `5.0 m/s` Stage 3 handoff.
- **Analytical remaining distance**: Compute the exact integral of `speed(t)` from `e` to `total`:
  - Over `[e, accel]`: `∫ s(u) du = u^3 - 0.5 * u^4`, so the remaining distance through the accel phase has a simple closed form (`(PULLOUT_END_SPEED) * (accel - e) + (TUNNEL_SPEED - PULLOUT_END_SPEED) * accel * (0.5 - (u^3 - 0.5 * u^4))`).
  - Over cruise and decel: identical closed-form terms as before.
- **Alternative considered**: Linear ramp-up in Stage 2. Smoothstep was chosen because it avoids the abrupt jerk corner when entering cruise while keeping the exact same simple closed-form integral.

### 3. Analytical `rig_gate` positioning (zero render/update drift)
- **Choice**: Extend the `transit:rig_gate` event payload with an optional `wallZ?: number` field. Once `remaining <= RIG_GATE_START_Z - RIG_GATE_FINAL_Z`, `TransitRideController` emits `{ arm: true, wallZ: RIG_GATE_FINAL_Z + remaining }` each update step. In `transitSeaTunnelRig` (`src/world/kit/transit.ts`), when `wallZ` is provided, `gateWallZ` is set directly to `Math.max(RIG_GATE_FINAL_Z, wallZ)` (falling back to the existing `gateWallZ -= speed * dt` integration only if a caller arms `rig_gate` without `wallZ`, preserving backwards compatibility for unit tests like `transit.test.ts`).
- **Rationale**: Ties the visual gate position directly to `TransitRideController`'s exact remaining travel distance so `gateWallZ` is guaranteed to equal `RIG_GATE_FINAL_Z` (`10.125 m`) on the exact frame Stage 2 hands off to Stage 3, regardless of frame rate or fixed-step remainder.

## Risks / Trade-offs

- **Short `tunnelSeconds` debug overrides (e.g. `start(2.0)` clamped to `MIN_TUNNEL_SECONDS = 3`)**: If `accel + decel > total`, the speed curve would overlap. → Mitigation: Cap `accel = Math.min(MAX_ACCEL_SECONDS, total * 0.35)` and `decel = Math.min(MAX_DECEL_SECONDS, total * 0.55)` so `accel + decel <= 0.9 * total` always leaves a valid cruise window (or clean peak) and never overlaps.
- **Existing unit test assertion in `src/game/transitRide.test.ts`**: Currently asserts every `transit:tunnel_scroll` event in Stage 2 is monotonically non-increasing (because previously Stage 2 only emitted during decel). → Mitigation: Update the test to assert (1) the first Stage 2 speed matches `PULLOUT_END_SPEED` (no jump from Stage 1), (2) speed increases monotonically during accel to `TUNNEL_SPEED`, (3) speed decreases monotonically during decel to `GLIDE_START_SPEED`, and (4) `rig_gate` arrives at `RIG_GATE_FINAL_Z` at handoff.

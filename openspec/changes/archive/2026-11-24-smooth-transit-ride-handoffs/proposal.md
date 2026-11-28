# Proposal

## Why

During the 3-stage abyssal transit ride from `R15a` to `R16a`, two noticeable janks break the illusion of a single continuous train journey: (1) entering Stage 2 (`sea_tunnel`) hard-cuts the hallway speed from Stage 1's `~7.37 m/s` pull-out exit straight to `20 m/s` in a single frame, and (2) at the Stage 2 -> Stage 3 handoff right before `r16a_north` lifts, swapping the `10.4 m` `r15b_train` shell for the `9.0 m` `r16a_train` shell snaps the front windshield, roof ribs, and straps `0.7 m` backward around the player (compounded by any render-tick drift on `rig_gate`'s approach position).

## What Changes

- **Smooth Stage 1 -> Stage 2 speed transition**: Start Stage 2 (`sea_tunnel`) at Stage 1's exact pull-out exit speed (`2 * 14 / 3.8 ≈ 7.37 m/s`) and ramp smoothly up to cruise speed (`20 m/s`) before cruising and decelerating smoothly down to Stage 3's `5.0 m/s` glide start speed.
- **Unified `9.0 m` train car shell across all three ride stages**: Set `r15a_train` and `r15b_train` to `length: 9` in `slice01.json` so all three ride cars (`r15a_train`, `r15b_train`, `r16a_train`) have identical interior dimensions, ribs, straps, benches, and cabin light offsets.
- **Deterministic `rig_gate` approach positioning**: Drive `rig_gate`'s Z position analytically from `TransitRideController` (`RIG_GATE_FINAL_Z + remaining`) instead of independent render-tick integration, eliminating frame-timing drift so `rig_gate` lands at the exact `r16a_north` shutter plane at the Stage 2 -> Stage 3 cut.

## Capabilities

### New Capabilities

### Modified Capabilities
- `transit-wing`: Require Stage 2 (`sea_tunnel`) to start at Stage 1's pull-out exit speed and accelerate smoothly to cruise speed before decelerating to the Stage 3 start speed; require identical `9.0 m` cabin dimensions across `r15a_train`, `r15b_train`, and `r16a_train` so the cabin never shifts around the player at handoffs; and require deterministic gate arrival positioning with zero drift at the Stage 2 -> Stage 3 cut.

## Impact

- **Ride controller**: `src/game/transitRide.ts` (accel -> cruise -> decel Stage 2 speed profile, exact analytical `remaining` distance across all three sub-phases, analytical `rig_gate` position updates).
- **Transit kit**: `src/world/kit/transit.ts` (`transitSeaTunnelRig` accepting an explicit `gateWallZ` / distance on `transit:rig_gate` instead of integrating `gateWallZ` separately in `pb.tick`).
- **Level data**: `src/data/levels/slice01.json` (`r15a_train` and `r15b_train` `length: 9`).
- **Tests**: `src/game/transitRide.test.ts` and `src/world/kit/transit.test.ts` (verify smooth Stage 1 -> Stage 2 speed continuity, accel -> cruise -> decel profile, exact `rig_gate` placement at handoff, and matching car lengths across `slice01.json`).

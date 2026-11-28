# Tasks

## 1. Unified 9.0 m Train Car Dimensions

- [x] 1.1 Update `r15a_train` and `r15b_train` in `src/data/levels/slice01.json` from `length: 10.4` to `length: 9` so all three ride cars (`r15a_train`, `r15b_train`, `r16a_train`) share identical dimensions, and verify with a test in `src/world/slice01.test.ts` that all three train props have matching `length`, `width`, and `height` and that `npm test -- src/world/slice01.test.ts` passes.

## 2. Smooth Stage 2 Speed Profile & Deterministic Gate Handoff

- [x] 2.1 Update `src/game/transitRide.ts` so Stage 2 (`sea_tunnel`) starts at `PULLOUT_END_SPEED` (`2 * R15A_PULLOUT_DIST / PULLOUT_SECONDS`), smoothly ramps up via smoothstep to `TUNNEL_SPEED` (`20 m/s`) over `min(MAX_ACCEL_SECONDS, total * 0.35)`, cruises, and decelerates linearly to `GLIDE_START_SPEED` (`5.0 m/s`), with an exact closed-form `remaining` distance across all three sub-phases; update `src/game/transitRide.test.ts` to assert Stage 1 -> Stage 2 speed continuity, monotonic accel -> cruise -> decel, and Stage 2 -> Stage 3 speed match, and verify `npm test -- src/game/transitRide.test.ts` passes.
- [x] 2.2 Emit analytical `wallZ: RIG_GATE_FINAL_Z + remaining` on `transit:rig_gate` from `src/game/transitRide.ts` once armed, and update `transitSeaTunnelRig` in `src/world/kit/transit.ts` to honor explicit `wallZ` (falling back to `gateWallZ -= speed * dt` when omitted); add unit coverage in `src/world/kit/transit.test.ts` and `src/game/transitRide.test.ts` verifying `rig_gate` lands at `RIG_GATE_FINAL_Z` with zero drift at handoff, and verify `npm test -- src/world/kit/transit.test.ts src/game/transitRide.test.ts` passes.
- [x] 2.3 Extend `R15a`'s `transit_tunnel_shroud` in `src/data/levels/slice01.json` from `length: 18` (`pos.z = 55.2`) to `length: 36` (`pos.z = 64.2`) so the deep lit tunnel is visible as soon as `r15a_south` opens rather than appearing only at the end of an 18 m stub.
- [x] 2.4 Pre-warm `R15b` at departure and stagger `render:warm` for `R16a` and `R16b` during Stage 2 deceleration in `src/game/transitRide.ts`, and extend `render:warm` in `src/app/session.ts` to pre-upload loaded mesh textures via `renderer.initTexture` so `R16a`/`R16b` do not stall for ~1 s when the shutter opens; verify with `npm test -- src/game/transitRide.test.ts`.

## 3. End-to-End Verification

- [x] 3.1 Run `npm run typecheck` and playtest `?debug&jump=transit_ride` in the browser to confirm smooth acceleration entering the tunnel and zero cabin or shutter jump at the Stage 2 -> Stage 3 `r16a_north` handoff.

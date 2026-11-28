# Proposal

## Why

Phases 1–2b built the lower transit wing geometry (`R11` Power Bay, `R13d` Maintenance Corridor, `R15a` Departure Boarding Bay, `R16a–c` Arrival Terminal), greybox train shells, and sealed blast gates. To make the transit crossing playable and atmospheric for the Phase 3 finale, the greybox train shells need a finished clean transit interior, and the crossing needs the 3-stage hybrid abyssal ride connecting `R15a` to `R16a`.

## What Changes

- **Finished Clean Train Interior (`transit_train_shell`)**: Upgrade both Train Car A (`R15a`) and Train Car B (`R16a`) from greybox shells into finished clean transit cars featuring commuter bench seating, overhead grab rails/handholds, clean interior wall/ceiling panels, cabin status/telemetry strips, interior lighting, wide front/rear viewing windshields, and animated boarding door leaves—strictly using clean transit materials (no rusty or dirty textures).
- **Pass-Through Blast Gates (`transit_blast_gate`)**: Update `transit_blast_gate` (`r15a_south` and `r16a_north`) so opening via `transit:blast_gate` disables its shutter collider to allow the train car to pass cleanly through the bore, and re-enables/seals on close or `level:reset`.
- **3-Stage Hybrid Abyssal Ride**:
  - **Stage 1 — Departure Pull-Out**: `r15a_south` opens via `transit:blast_gate`, Train Car A seals its boarding door, and Train Car A pulls out ~15–20 m south (`+Z`) out of `R15a` through the open south blast gate while smoothly carrying Jay inside the cabin.
  - **Stage 2 — Infinite Scrolling Windowed Glass Sea-Tunnel**: Seamless handoff into an infinite-scrolling windowed glass sea-tunnel segment where clean tunnel structural ribs, glass tunnel framing, and exterior abyss lights speed past outside the windows before receding into pitch-black abyssal ocean.
  - **Stage 3 — Arrival Glide-In (`R16a`)**: Seamless handoff to Train Car B gliding ~15 m south through the open `r16a_north` blast gate into `R16a`, decelerating to rest at the `R16a` dock platform, opening its west boarding door, and sealing `r16a_north` behind it.
- **Visual Fix Pass**: After playtesting, the car gets a lifted body on visible bogies above lit, non-intersecting rails, a real door pocket, a lit visible ocean backdrop (replacing black slabs) in the shrouds and sea-tunnel, and light-count-neutral headlights; see `design.md` Decisions 6-10.
- **Debug Inspection Access**: Extend the debug launcher (`?debug&jump=r15a` / `?debug&jump=transit_ride` or debug event) so the full 3-stage ride can be triggered and verified directly in the browser.

## Capabilities

### New Capabilities
<!-- None; all transit wing geometry, train shells, blast gates, and traversal belong to transit-wing. -->

### Modified Capabilities
- `transit-wing`: Upgrades `transit_train_shell` with a clean finished cabin interior and animated boarding door, makes `transit_blast_gate` pass-through when open, and adds the 3-stage hybrid abyssal train ride (`R15a` pull-out -> infinite scrolling glass sea-tunnel with speeding exterior abyss lights into pitch-black ocean -> `R16a` arrival glide-in) with debug preview access.

## Impact

- `src/world/kit/transit.ts`, `src/world/kit/transit.test.ts` (clean train interior, animated boarding door, blast-gate pass-through collider, infinite scrolling sea-tunnel rig & exterior abyss lights)
- `src/data/levels/slice01.json`, `src/world/level.ts`, `src/world/slice01.test.ts` (named controllable train props, sea-tunnel ride stage/anchor, `R15a`/`R16a` track clearance)
- `src/actors/player.ts`, `src/app/session.ts` (cabin-frame player carry during train motion, `transit:ride` event/debug trigger)

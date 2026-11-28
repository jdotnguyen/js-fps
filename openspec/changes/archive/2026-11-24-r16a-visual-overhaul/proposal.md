# Proposal

## Why

`R16a` ("Arrival Track Dock") now has its final perpendicular arrival geometry, `r16a_north` blast gate, `transit_dark_bore`, and full-width west stairs into `R16b`, but visually it is still a bare greybox shell compared to `R15a`. Dressing `R16a` to clean transit quality—with an exterior ocean window behind the train, full architectural framing, arrival signage, platform prop clusters, dense blood decals, a single fallen body at a concourse pillar, and full lighting plus blackout/flash and rotating red pillar-beacon readiness—prepares the room for the upcoming Phase 3 arrival horror reveal while making it visually cohesive on its own.

## What Changes

- **Clean transit architectural framing & dressing in `R16a`**: Add overhead `rib_frame` gantries, hung `pipe_run` service lines, an illuminated arrival status board (`transit_depart_board` arrival mode), `room_sign` (`R16A`), directional `transit_sign` wayfinding (`ARRIVAL CONCOURSE ->`), and purposeful platform prop clusters (seating, luggage/crates, electrical/comms cabinets) along the north and south platform margins while preserving an unobstructed central exit path (`z = 35`) to the west stairs.
- **Ocean window & exterior floodlights behind the train**: Replace `R16a`'s east-wall track-side panels (`x = 22`, `rot = 270`) with real `wall_window` ocean glazing (matching `R01`/`R15a`) so exterior floodlights cast beams out into the dark abyss behind the docked train, complemented by track-side conduit/rail signals.
- **Horror-scene surface dressing on clean base textures**: Keep `R16a` and `R16b` base wall/floor surfaces on the clean `transit` palette, and add a reusable `blood_decal` kit prop (floor pools, spatter, drag trails, and wall/pillar smears) placed densely across `R16a`'s platform, stairs, bulkheads, and the facing `R16b` concourse threshold, plus a single named, movable fallen body prop (`r16_pillar_body`) on the floor at one of the nearest `R16b` pillars so a future arrival script can pull it behind the pillar.
- **Full lighting capability + blackout/flash & rotating red pillar beacons**: Upgrade `R16a`'s overhead lighting with named light IDs, 1–2 `shadow: true` hero lights, and cool/amber temperature contrast while preserving full clean illumination; add reusable `transit_rotating_beacon` emergency red rotating beacons (with `reducedFlashing` steady-lens fallback and controllable event toggle) mounted on the facing faces of the `R16b` concourse pillars visible from `R16a`, plus debug preview toggles (`?debug&jump=r16`) to inspect normal full lighting, pitch-black blackout, flash reveal, and rotating red beacons.

## Capabilities

### New Capabilities

### Modified Capabilities
- `transit-wing`: Add requirements for `R16a` clean industrial transit dressing and arrival signage, `R16a` east-wall ocean window with exterior floodlights behind the train, dense blood-decal horror dressing with a movable fallen body at the concourse pillar, and `R16a`/`R16b` named lighting + blackout/flash readiness + rotating red emergency beacons on the facing concourse pillars.

## Impact

- **World data**: `src/data/levels/slice01.json` (`R16a` pieces, props, lights, and `R16b` facing pillar beacons, blood decals, and `r16_pillar_body`).
- **Modular kit**: `src/world/kit/transit.ts` (arrival-mode parameterization for `transit_depart_board`, new `transit_rotating_beacon` and `blood_decal` / `r16_pillar_body` prop support, or `src/world/kit/props.ts` where appropriate).
- **Debug / preview hooks**: `src/app/session.ts` or level debug controls for previewing `R16a` lighting modes (full, blackout, emergency beacons) without altering the default arrival ride sequence.
- **Tests**: `src/world/slice01.test.ts` and `src/world/kit/transit.test.ts` (walkability clearance, ocean window floodlights, rotating beacon animation + `reducedFlashing`, named lights, and movable body prop).
- **Implementation approach**: Apply phase will use the `threejs-game-director` skill for visual polish and browser verification.

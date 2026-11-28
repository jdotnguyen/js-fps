# Proposal

## Why

The observation gallery (R03) hosts the calm briefing with Heins and Director Hale and, later, the drop. Today it reads as a derelict service bay with lounge furniture dropped in:

- every surface uses the rustiest texture in the game
- a wall rib cuts the briefing screen in half
- half the ceiling fixtures are dead
- the sofa blocks the entry

ADR-0014 wants the player to have "lived in the station" before the horror, so the gallery should feel clean, cared-for and dim. The drop's red blackout then lands as a loss. This change does that within today's renderer budgets: 8 pooled fill lights and flashlight-only shadows. The larger-budget plan lives in `fidelity-first-rendering`, which is parked.

## What Changes

- **Screen wall:** the back-wall section behind the briefing screen becomes a plain wall, so no rib crosses the screen. A level-wide check keeps wall-mounted props clear of wall structure from now on.
- **Clean lounge finish:** the `gallery` area palette moves from `paintDark` everywhere to:
  - `cleanSlate` walls and door surrounds
  - `cleanTeal` upper panels
  - `steelBrushed` trim
  - `officeCeiling` ceiling
- **Furniture layout** organised around how the scenes use the room:
  - a clear door-to-door lane along the back wall
  - a clear stage between the team and the glass
  - a coffee credenza, wall clock and TAG poster on the back wall
  - an observation notice board and an observation station (console and chair) in the west glass corner
  - the sofa moved away from the entry to the east glass corner, facing the glass, with a coffee table and warm pendant lamps
  - plants in the corners
- **Floor:** the carpet stays, with a 1 m bare brushed-metal strip along the glass that has hard footsteps. This needs a new `floor_carpet` edge option.
- **Lighting with today's budget:**
  - every fixture in the room is lit; none stays dead
  - the two centre ceiling lights and two low-hung warm lamps cast real light
  - the other fixtures glow without taking a pooled light, so Lab B keeps its lights through the glass
  - a new dark, neutral `gallery` ambient preset
  - in the drop, every light, lamps included, flickers and turns emergency red with no script change
- **Small extensions to the existing light-slot system** (no pool or renderer change):
  - a `pendant` slot kind
  - an opt-in `slots` param on `pendant_light`
  - glow-only room lights (`pool: false`)
  - lamps don't buzz like fluorescents

## Capabilities

### New Capabilities
- `level-kit`: behaviour of modular kit pieces that level content relies on: wall-mounted props stay clear of wall structure, and carpet floors can leave a bare metal edge band with hard footsteps.
- `render-lighting`: how authored room lights become lit fixtures and real lights: claimed and unclaimed fixtures, glow-only lights, sharing the fill-light pool between visible rooms, lamp lights, and scripted patterns and tints reaching every claimed light.

### Modified Capabilities
- `in-world-audio`: "Light buzz follows the lights" excludes lamp lights; every other fixture buzzes as before.

## Impact

- **Level data:** `src/data/levels/slice01.json` R03 (pieces, props, lights, atmosphere).
- **Code:**
  - `src/world/kit/palettes.ts` (`gallery` palette)
  - `src/world/kit/slice.ts` (`floor_carpet` bare edge, `pendant_light` slots)
  - `src/world/kit/detail.ts` / `src/world/kit/structure.ts` (wall keep-out boxes)
  - `src/world/kit/types.ts` (`pendant` slot kind)
  - `src/world/level.ts` (pendant defaults and geometry, `pool: false`, `gallery` ambient preset, slot kind in `roomLights`)
  - `src/data/types/level.ts` (schema: `pool`, ambient preset)
  - `src/audio/ambience.ts` (buzz filter)
- **Tests:**
  - wall-prop clearance across every level
  - kit tests for the bare carpet edge and pendant slots
  - level tests for R03 slots, lane and stage
  - an ambience buzz test
  - `slice01`, `slice01Walks` and `slice01ScriptedWalks` stay green
- **Unchanged:** no sequence (`briefing_gallery.json`, `drop.json`) or dialogue changes. The commons and admin lamps are unchanged, because the new param is opt-in.
- **Other rooms:** none. Only R03 uses the `gallery` area. The clearance check may surface existing offenders elsewhere (the R14d admin TV sits on a tile seam); those are fixed in this change.

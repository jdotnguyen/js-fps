# Tasks

## 1. Wall clearance

- [x] 1.1 Record pilasters and trim rails as keep-out boxes in wall tile piece output (`detail.ts` / `structure.ts`); verify with a kit test that a `wall_panel` tile reports keep-outs at its tile end and mid-bay rib and a `wall_plain` tile only at its tile end
- [x] 1.2 Add a level test that checks every wall-mounted prop in every level against the keep-outs of the wall tiles it touches and names room, prop and wall on failure; verify it fails on today's R03 (`brief_screen` on `[2,0,4]`)
- [x] 1.3 Swap R03 `[2,0,4]` to `wall_plain` and fix any other offenders the test reports (check R14d `admin_tv`); verify the clearance test passes for every level

## 2. Clean finish and ambient

- [x] 2.1 Replace the `gallery` palette in `palettes.ts` with the design's clean palette; verify with a palette test that R03 walls, ceiling, door surrounds and glass-partition sill and header resolve to clean materials, and that `console` builds its clean variant there
- [x] 2.2 Add the `gallery` ambient preset to `AMBIENT` and `AMBIENT_PRESETS`, and set R03 `atmosphere.ambient: "gallery"`; verify with a level test that R03's ambient intensity is the preset's and the `emergency` tint still swaps it

## 3. Bare metal strip

- [x] 3.1 Add the `bareEdge` / `bareWidth` option to `floor_carpet` (split slab and collider, `floorAlt` material, `metal` surface, border trim on the seam); verify with kit tests that the band's collider reports `metal`, the rest reports `rubber`, and a cell without `bare` is unchanged
- [x] 3.2 Set the bare edge (width 1.25 toward the glass) on R03's three z 5 carpet cells, through a new per-cell `floorParams` room option in `gen-slice01.mjs`; verify with a level test that the footstep surface under the strip is `metal` and behind it `rubber` (the audible switch is part of the playtest)

## 4. Light-slot extensions

- [x] 4.1 Add `pool: optional(bool)` to the room light schema in `src/data/types/level.ts` and skip `pool: false` lights in `bindLights`; verify with a level test that a glow-only light has a glowing fixture and a `ControlledLight` but is never bound, and frees a pool light for another room
- [x] 4.2 Add the `pendant` slot kind (types, `SLOT_DEFAULTS`, bulb glow and dark-bulb geometry, schema wherever slot kinds are listed); verify with a kit test that a claimed `pendant` slot gets a glow mesh and `ControlledLight`, and an unclaimed one a dark bulb
- [x] 4.3 Add `slots: true` to `pendant_light` (one `pendant` slot per bulb, no static bulb glow); verify with a test that the existing commons and admin placements (no `slots`) produce identical slot lists and glow output to before
- [x] 4.4 Return slot `kind` from `roomLights()` and skip `pendant` lamps when building fluorescent buzzers; verify with an ambience test that a room with a lamp and ceiling lights only buzzes at the ceiling fixtures

## 5. Layout

- [x] 5.1 Move the sofa, console, fern and tall plant, and add the credenza, clock, poster, notice board, chair and coffee table per the design table; verify `slice01Walks`, `slice01ScriptedWalks` and `slice01` pass (briefing walk-ins, drop escape to `D_R03_R05`)
- [x] 5.2 Add a level test asserting the lane (z 14.8 to 17.6) and the stage (x 5.4 to 10.6, z 17 to the strip) have no prop colliders; verify it passes with the new layout and fails if the old sofa position is restored

## 6. Lighting

- [x] 6.1 Place the west (1 bulb) and east (2 bulbs) `pendant_light` with `slots: true`; verify with a level test that R03's slots are 0 to 5 `ceiling` and 6 to 8 `pendant` in that order
- [x] 6.2 Rewrite R03 `lights` to claim all nine slots per the design table (pooled: 1, 4, 6, 7; `pool: false`: 0, 2, 3, 5, 8); verify with a level test that R03 has no dead diffuser, exactly 4 pooled lights, and that with the camera in R03 Lab B's 3 lights are still bound
- [x] 6.3 Verify in the sequence harness that the drop's `flicker`, then `alarm` with `emergency`, reaches all nine R03 lights (pattern and red tint) with no change to `drop.json`

## 7. Look pass

- [x] 7.1 Tune lamp height, intensities, ranges and ambient by eye during the briefing and the drop (faces readable under `playerFrame`, room dim between pools, Lab B bright through the glass); verify with before and after screenshots from the briefing spot and the drop spot attached to the change
- [x] 7.2 Run `npm test` and `npm run typecheck`; verify both pass, and check `?debug` stats in the R03 drop show no frame-time regression against the current build

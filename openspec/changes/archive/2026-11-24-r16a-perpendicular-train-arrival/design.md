# Design

## Context

See proposal.md for motivation. Observed in the code, not assumed:

- `R16a` is `3x3` cells (a `12 m x 12 m` room, floor `-0.6`) with the train on the +Z axis and the car parked at `R16A_TRAIN_PARK = { x: 88, y: -0.6, z: 35 }`. Cells are `4 m` and centred on `cell * 4`, so x cell 22 is x 86-90. The car's `doorSide` is `"right"`, which faces west.
- `R16b` (`5x6` cells) used to lie south of `R16a`, joined by an open seam, with `R16c` (`3x1`) at its far end. `R15a` occupies x cells 11-13, so the only free span west of the dock is x cells 14-19: exactly `R16b`'s `24 m`.
- The ride is built around one straight +Z axis with translation-only player and light carry; the Stage 2 rig's closed gate stops `RIG_GATE_FINAL_Z = 10.125` m ahead so it matches `r16a_north`.
- `Level.integrate` attaches dynamic parts to the room group and keeps their world transform. Anything that moves is positioned relative to its own holder group, and tests read world positions.

## Goals / Non-Goals

**Goals:**
- Standing between the concourse pillars you look east at the train's right side, with the gate on your left and the dark bore on your right.
- The ride and its constants are untouched, and the train never turns.

**Non-Goals:** more stops, the power cut, and changing `R16b`'s contents beyond rotating them.

## Decisions

**1. Turn the terminal, not the train.** Rotating the dock's neighbours 90 degrees clockwise (north becomes east, west becomes north) puts the concourse west of the track, the view east, and the train's right side toward the viewer, while the train keeps going south. Alternative: turn the train 90 degrees at the hand-off so it runs east to west. Rejected: it changes the ride's axis, the carry, the headlight clearance and the gate and shroud placement for no visible gain.

**2. R16a keeps its cells and its car.** The dock is x cells 20-22, z cells 8-10, and the track is the east column (22). The car stays at `x = 88`. The platform is column 21 and the stairs column 20, rising west to `R16b`'s floor at the seam (x 78).

**3. R16b is a pure rotation about the seam.** World `(x, z)` becomes `(120 - z, x - 52)`; cells `(cx, cz)` become `(30 - cz, cx - 13)`; piece and prop headings and wall edges add 270 degrees. `R16b` then spans x cells 14-19, z cells 7-11, centred on the dock's centre line (z 36), so the pillar pairs sit at z 31.2 and 40.8 either side of it. The old open end (its south end) becomes its west end and is closed.

**4. R16c is translated, not rotated.** It sits south of `R16b`, whose south side faces the same way the old south end did, so its contents keep their orientation. Its door is in `R16b`'s south wall at x cell 17 (east of the booth bays at the wall's west end), so `R16c` spans x cells 16-18, z cell 12.

**5. The south wall is a piece.** `transit_dark_bore` owns the wall across the track column's south edge: piers and a header around a `3.4 m x 3.4 m` open portal, then a steel liner (no emissive, no rib bars, no guide strips) `6 m` long running out of the room under extra ceiling cells (south of the dock there is no room there now), closed by a solid end cap, a floor, and four black fog planes that thicken to the far end. Lights are off, so it reads as the ride hallway switched off. Alternatives: a second blast gate (it has lamps and a shutter) and a flat black panel (no depth). Rejected.

**6. Guard rail.** The existing `platform_railing` runs along the platform's track side, `0.75 m` from the car (as in `R15a`), in two runs with a `3.6 m` boarding gap at the door; the north run reaches the north wall and the south run the south wall, so there is no way round the car's tail or nose.

**7. Door stays closed; scripting opens it.** The controller no longer emits `transit:train_door { open: true }` for the arrival car. The door piece keeps its open behavior, so Phase 3 is one event. `?debug&jump=transit_ride&door=open` opens it for playtests; `?debug&jump=r16` stands you outside the car.

**8. Cell map (as built).** Cell centres are `4 * cell`.

| | x cell 20 (78-82) | x cell 21 (82-86) | x cell 22 (86-90) |
| --- | --- | --- | --- |
| z 8 (30-34) | stairs | platform | `r16a_north` gate; car tail |
| z 9 (34-38) | stairs | platform, boarding gap | car middle |
| z 10 (38-42) | stairs | platform | car nose, then track to the south wall portal |
| z 11-12 (42-50) | R16b's corner walls / outside | outside | bore liner under two ceiling cells |

- `R16b`: x cells 14-19, z cells 7-11. Its east edge is walled at rows 7 and 11 and open for rows 8-10 (the seam, `12 m`, with the `seam_header`).
- `R16c`: x cells 16-18, z cell 12, door `D_R16b_R16c` at `[17, 0, 11]`.
- The `R16a` light slots keep their indices except the car's cabin slots, which move up by two (13, 14 to 15, 16) because two ceiling cells were added for the bore; slot 8 moved to 7 so no shaft crosses the car.

**9. Train cabin rear-bulkhead comms terminal and door-pocket info sign.** `trainShell` adds two interior wall-mounted details:
- **Rear-bulkhead comms terminal:** Mounted centred (`x = 0`) on the interior face of the solid rear (`+Z` local, north in `R16a`) bulkhead, above the sill trim (`y ~ 1.05-1.75 m`) with a slim housing, backlit radio/comms screen (`paintedDecal`), speaker grille, and handset/mic mount for the radio exchange with Heins.
- **North-west door-pocket infographic / info sign:** Mounted flush on the interior skin (`|x| = hw - wallT`) of the solid windowless door-pocket wall (`doorSign` side, `z` in `[doorHalf, pocketEnd]`, which rotates to the north-west wall at `rot = 180`), between `sillY` and `headY` so it clears the bench below and never enters the sliding door leaf channel. Rendered with a procedural `paintedDecal` showing transit line / arrival station info.

## Risks / Trade-offs

- [`R16b` now touches `R15a`'s east wall] → the rooms are culled from each other, walls are inward-only so nothing overlaps, and a test asserts no cell is the floor of two rooms.
- [Player sealed in the car until a script exists] → the debug flag and the `jump=r16` spawn outside the car.
- [The bore's mouth might read as a flat wall] → four fog planes and a `6 m` liner give it depth; checked in the browser through the car's windshield.
- [The booths and pillars were authored for a north-south concourse] → rotated with it, so their relative layout is unchanged; walk tests cover the route.

## Open Questions

None.

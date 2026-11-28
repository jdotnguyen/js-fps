# Design

## Context

- R03 is cells x 1..3 by z 4..5, which is x 2..14 and z 14..22 in metres. Height is 3.6 m.
  - Back wall (z 14): `wall_plain` | `wall_panel` | `wall_plain`.
  - Glass wall (z 22): three `wall_glass_partition` sections looking into Lab B (R04).
  - Doors on the z 4 cells: `D_R02_R03` from the commons at x 14 (the entry) and `D_R03_R05` at x 2 (locked until the drop).
- **Screen clip.** `panelWall` splits a 4 m tile into two 2 m bays and puts a pilaster (0.22 m wide) at the tile centre, x = 8. `brief_screen` (2.8 m wide) is also centred at x = 8. The pilaster's front face (z ≈ 14.41) is about 2 cm proud of the screen glass (z ≈ 14.39). `wall_plain` has only its tile-end pilaster at x ≈ 6.11, which clears the screen bezel's edge (6.54).
- **Palette.** The `gallery` palette sets only `wallMain: paintDark`, so walls, upper panels, ceiling, door surrounds and the glass partition's sill and header all resolve to the peeling-paint-and-rust scan.
- **Lights.** The six ceiling tiles each expose one `ceiling` slot (indices 0–5 in piece order); R03 claims 0, 2 and 4, so 1, 3 and 5 render as dead diffusers. There is no ambient preset, so R03 uses `normal` (0.22).
- **Light budget.** One `LightPool` of 8 `PointLight`s serves every visible room. The current room's claimed slots win first (`priority * 400`), then other rooms, nearest first. Lab B (R04) claims 3. If R03 claimed more than 5 pooled lights, Lab B would lose real lights behind the glass during the drop. Only the flashlight casts shadows.
- **Lamps.** `pendant_light` bulbs use one shared, cached static glow material that is merged per room, so they cannot follow patterns or tints and offer no slot.
- **Buzz.** The ambience director buzzes at `level.roomLights(room)`, which returns every claimed slot.
- **Scene choreography** (from `briefing_gallery.json` and `drop.json`; unchanged):
  - The player and squad enter at `gallery_enter` (13, 16) and walk to `brief_jay` (8, 17.4), `brief_giles` (6.4, 17.8) and `brief_okafor` (9.7, 17.8). Heins stands at `brief_heins` (8, 20.4) facing them.
  - In the drop the player is at `drop_jay` (8, 19.6). After the drop the exit is `D_R03_R05` at x 2, z 15–17.

- **Level data is generated.** `scripts/gen-slice01.mjs` writes `slice01.json` (docs/HANDOFF.md), and other sessions edit the same JSON in parallel. Edits go into the generator first. Only the rooms this change touches are then spliced from a scratch generator run into the JSON, never through a full regeneration, so the generator and the JSON stay identical for those rooms.

## Goals / Non-Goals

**Goals:**
- Furniture only where the scenes leave space.
- A dim room lit in pools, so the drop's red takeover reads as the room going dark.

**Non-Goals:**
- Changing the briefing or drop sequences, anchors, triggers or dialogue.
- Moving the briefing screen off the back wall.
- New furniture kits. Everything uses existing props.
- Changing the light pool size, adding shadow-casting room lights, or any renderer change. Those belong to the parked `fidelity-first-rendering` plan.

## Decisions

### 1. Plain wall behind the screen (not a moved, shrunk or floated screen)
Swap `[2,0,4]` from `wall_panel` to `wall_plain`. Alternatives considered:
- shrinking the screen to fit one 2 m bay (it would be about 1.7 m wide, too small for a briefing)
- pushing the screen out past the rib (a visible gap from the side)
- a recessed media-wall kit piece (worth it only if more briefing rooms appear)

### 2. Clearance check through wall keep-out boxes
Wall tiles record their protruding structure (pilasters and trim rails) as keep-out boxes in the piece output, next to colliders and slots. A level test builds every level and intersects each wall-mounted prop's bounds with the keep-outs of the wall tiles it touches. Mesh-level intersection was rejected: it is slower and harder to report.

Wall-mounted kinds:
- `wall_screen`, `tag_poster`, `notice_board`, `wall_clock`, `menu_board`
- `security_monitor` and `cctv_wall` where wall-hung

The first run found two offenders: R03's `brief_screen` and R02's quarantine `notice_board`, which was also centred on a panel tile's mid rib. The notice board moved 0.95 m into the tile's west bay, and its `trig_commons_notice` moved with it. The R14d admin TV sits on flat wood panelling and is clear. The R01 CCTV wall is clear too once each mesh is checked on its own; a whole-prop box falsely joined the bracket to the face, so the check uses per-mesh boxes.

### 3. Gallery palette

```
gallery: {
  wallMain: 'cleanSlate', wallAlt: 'cleanTeal', ceiling: 'officeCeiling',
  trim: 'steelBrushed', floor: 'rubber', floorAlt: 'steelBrushed',
  hazard: 'hazardClean', doorSurround: 'cleanSlate', doorPanel: 'steelDark',
  doorGlassBar: 'steelBrushed', pipeAccent: 'cleanTeal', pipeMain: 'steelDark',
}
```

This matches the existing clean palettes (dock, hydroponics). `officeCeiling` matches the commons next door. Because `doorPanel` is no longer `paintDark`, the `console` prop automatically uses its clean variant.

### 4. Layout

```
            z=14  back wall
   x=2 +----------------------------------------------------+ x=14
       | [credenza 2.0]       (clock)          [poster]     |
       |                [===== screen =====]                |
 D_R03 ]  . . . . . . . . kept-clear lane . . . . . . . . . [ D_R02
 _R05  ]                                                    [ _R03
[notice]          G(6.4)    J(8.0)    O(9.7)   z~17.6       |
 board |                                    [ sofa 2.0 ]    |
       |  (chair)              H(8,20.4)    [ table 1.2]    |
       | *fern [console]   o                  o  o  *tall   |  o = pendant bulbs
       |%%%%%%%%%%%%%%%%% bare metal strip 1 m %%%%%%%%%%%%%%|
       +================== glass -> Lab B ==================+ z=22
```

All positions are approximate. The walk tests have the final say.

| Item | Kit and params | Position (x, z), facing |
|---|---|---|
| Coffee credenza | `credenza` width 2.0 | (4.2, 14.53), front to +z (rot 180) |
| Clock | `wall_clock` y 3.05 | (8, 14.31), rot 180 |
| Poster | `tag_poster` | (11.8, 14.31), rot 180 |
| Observation notice | `notice_board`, text "OBSERVATION GALLERY" / "DO NOT TAP THE GLASS" (the commons already holds the interactive quarantine notice) | west wall (2.31, 19.6), rot 270 |
| Observation station | `console` (status screen), moved | about (3.8, 20.3), screen toward the glass |
| Its chair | `chair` | room side of the console |
| Sofa | `sofa` width 2.0 | (12.0, 18.7), facing the glass (rot 180) |
| Coffee table | `coffee_table` 1.2 × 0.6 | (12.0, 19.9) |
| Plants | fern; tall white-pot | (2.7, 21.3); (13.35, 21.3) |

Rules the layout keeps:
- **Lane:** nothing deeper than the credenza (0.52 m) against the back wall, and nothing between z 14.8 and z 17.6 across the room.
- **Stage:** nothing in x 5.4–10.6 between z 17 and the strip.
- **Escape:** a straight path from (8, 19.6) to the west door.

### 5. Bare metal strip
`floor_carpet` gains `bareEdge: 'n'|'e'|'s'|'w'` and `bareWidth` (piece params are flat values). The carpet slab and its collider are split into two boxes:
- the band uses the palette's `floorAlt` material and the `metal` footstep surface
- the rest stays carpet with the `rubber` surface
- the carpet border trim moves to the seam

The three z 5 cells set the edge facing the glass with width 1.25, measured from the cell edge. The partition wall eats 0.25 m, so 1 m of floor shows. Alternative rejected: a thin steel plate laid on top of the carpet. It looks right but footsteps stay soft, and it risks z-fighting.

### 6. Three small extensions to the light-slot system

None of these changes the pool or the renderer.

- **`pendant` slot kind.**
  - Defaults: colour `#ffcf99`, intensity about 4, range about 4.5 m, emissive 3, drop 0.15 m (the light source sits just under the bulb).
  - `glowGeometry('pendant')` is a small bulb sphere; an unclaimed pendant slot renders a dark bulb.
  - `pendant_light` with `slots: true` calls `pb.light` once per bulb and skips its static glow. Without `slots`, the code path is today's, so the 9 existing commons and admin placements produce identical output (covered by a test).
- **Glow-only lights (`pool: false`).** The slot still gets its glow mesh and a `ControlledLight`, so patterns and tints apply. `bindLights` just never offers it to the pool.
  - *Alternative considered:* removing the corner fixtures (`fixture: false`). Rejected: the room would read as under-lit and the user wants every fixture working.
  - *Alternative considered:* raising the pool to 9 or more. Deferred to the parked plan.
- **Buzz reads the slot kind.** `roomLights()` returns each slot's `kind`, and the ambience director skips `pendant` lamps. Ceiling, wall and emergency fixtures buzz as before.

### 7. Lighting plan within 8 pooled lights

```
  R03 CEILING (top-down)          o = lamp bulb, * = pooled (casts real light)
              x 2..6             x 6..10             x 10..14
  back row  [0 glow]          [1 POOLED*]          [2 glow]
  front row [3 glow]          [4 POOLED*]          [5 glow]
            o6 POOLED* (desk)                      o7 POOLED*  o8 glow (table)
```

| Slot | Kind | Pool | Colour | Intensity | Range |
|---|---|---|---|---|---|
| 1, 4 (over the team and Heins) | ceiling | yes | `#eef1f4` | about 5 | about 8 m |
| 0, 2, 3, 5 | ceiling | `pool: false` | `#eef1f4` | n/a | n/a |
| 6 (west lamp, over the console) | pendant | yes | warm | about 4 | about 4.5 m |
| 7 (east lamp bulb A) | pendant | yes | warm | about 4 | about 4.5 m |
| 8 (east lamp bulb B) | pendant | `pool: false` | warm | n/a | n/a |

- **Lamp placement:**
  - west `pendant_light` with `slots: true`, count 1, `ceiling` 3.6, drop about 1.55 (bulb at about 2.0 m), over the console
  - east one with count 2, spacing 0.9, over the coffee table
- **Slot numbering:** pendant slots follow the six ceiling slots in prop order. A test pins the indices so a later edit cannot silently shift them.
- **Budget:** R03 uses 4 pooled lights and Lab B 3, which leaves 1 spare (the commons, through the open entry door during the briefing). This holds on every quality tier, because the pool is 8 everywhere today.
- **Ambient:** new preset `gallery: { sky: 0x9ea6ab, ground: 0x0d0f11, intensity: 0.12, keyColor: 0xa4adb3, keyIntensity: 0.16 }`, set in R03's `atmosphere.ambient`.
- **Shadows:** only the flashlight. When the parked plan lands, slots 1, 4, 6 and 7 are the shadow candidates, and the glow-only flags can be dropped.

### 8. The drop needs no script change
`lightState R03 flicker`, then `alarm` with `emergency`, already target the room. Under render-lighting, every claimed light follows it: pooled and glow-only fixtures and both lamps. The `emergency` ambient (0.16) replaces `gallery` (0.12), so the red pooled lights carry the change.

## Risks / Trade-offs

- [Furniture blocks a scripted walk or the post-drop escape] → `slice01Walks` and `slice01ScriptedWalks` already cover these paths and must pass. Positions move before the plan does.
- [Only four real lights make the room too dark or flat] → That is the intended mood. If faces fall flat, raise slot 4 (over Heins) first, then the ambient. Glow-only fixtures plus bloom still read as working lights.
- [Glow-only fixtures look lit but cast nothing on nearby walls] → They sit in the corners, where the lamps and the room's dimness hide it. The parked plan removes the need for them.
- [Too dark to read faces during the briefing] → `playerFrame` shots land on Heins, who stands under pooled slot 4. Tune that light's intensity first, not the ambient.
- [Clean palette makes the commons-to-gallery seam look flat] → Same ceiling as the commons, with different walls and lighting. Check the transition through the open door.

## Open Questions

- Exact lamp heights, light intensities and the ambient values are tuned by eye in game. The ranges above are starting points, and changing them does not change the specs or tasks.
- Which east bulb is pooled (7 or 8) is cosmetic; pick whichever lights the sofa better.

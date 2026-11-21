# Design

## Context

See proposal.md (Why). The current state that shapes the approach:

- **Grid.** 4 m cells, +x east, +z south.
  - R04 Lab B: x 2..14, z 22..30. Its north side is the gallery glass.
  - R05: x −6..2, z 14..26.
  - R06: x −6..2, z 26..38, 4 m tall.
  - Doors:
    - `D_R03_R05`: gallery → R05, east wall, z 16
    - `D_R04_R05`: Lab B bulkhead, R05 east wall, z 24
    - `D_R05_R06`: R05 south wall, x 0
    - `D_R06_R07`: the south bulkhead, x 0, z 38
- **R04's west wall.** It borders R05 for z 22..26 and R06 for z 26..30, so Lab B's service wall touches both rooms the bloom spreads into.
- **The two fights** (`action_contact.json`):
  - **`contact`:** knocks on `D_R04_R05`, the creature (`researcher_b_creature`, from `voss-burst-death`) bursts through, then `r05_trickle` (two from the west vent, one from the floor).
  - **`cover_me`:** Giles walks to `anchor:r06_panel` and runs a 20 s `bypass` job on `D_R06_R07`, while `r06_cover` sends six enemies: two from each of two wall vents, one from the ceiling, one from the corridor behind.
- **Rules the redesign must obey:**
  - **enemy-encounters:** emerging enemies land on the highest walkable top at or below their spawn, attacks reach 1.2 m vertically, and unreachable group enemies are removed after 10 s.
  - **squad-tasks:** the job starts within 1.5 m of its spot and pauses for enemies within 3 m on Giles's level.
  - **player-movement:** Jay can jump onto tops of 0.35–1.0 m with 1.75 m of headroom, and enemies can't follow.
- **`voss-burst-death` owns these in Lab B:**
  - `labb_victim` at (8, 0, 26.5)
  - the benches she kicks during the panic beat
  - the white key light held on her
  - the glass blood decals and the `GoreClip` on the glass
  - a clear band at her chest height through the glass
- **Imported props** (spec `imported-props`) are placed by id through their stand-ins. The `bloom` photo slot is fetched at startup but uploaded to the GPU only when first drawn (measured in `import-lab-props`).
- **Budgets:**
  - 60 draw calls per room
  - 8 pooled fill lights at Low
  - GPU textures at the loaded title: 62 textures using 246 MB, at Medium

## Goals / Non-Goals

**Goals:**
- Each room's purpose reads within a few seconds of entering, and every object belongs to that purpose or to what happened an hour ago.
- The bloom's route is followable: column → service wall → R05 ceiling → R06 → Giles's panel.
- Both fights stay fair and readable under red lockdown light, with their beats, lines, flags and checkpoints unchanged.

**Non-Goals:**
- Voss's log terminal, her badge and the initials on the panel tag (`lab-wing-story-beats`).
- Animated or growing bloom beyond a slow "breathing" scale on a few masses.
- New enemy behaviour, new ambience presets, or physics-driven props (`adopt-physics-engine`).
- Changing R03, the gallery glass or the briefing.

## Decisions

### D1. Clean base palette; all wear is placed
- **Palette.** `labs` becomes:
  - walls: `cleanWall`, with a `cleanSlate` service band
  - trim and kick plates: `steelBrushed`
  - ceiling: `officeCeiling` (Lab B), `steelDark` (R05, R06)
  - floor: `labTile` (Lab B), `rubber` (R05, R06)
  - hazards: `hazardClean`
- **Wear comes from placed decals** (surface-dressing §4, 4–8 per room):
  - grime under the coolant line and at floor–wall joins
  - leak stains below fittings
  - stencils beside doors
  - blood only where `voss-burst-death` puts it
- **Kept:** Lab B's outbreak floor swap (`labTile` → `tileBroken`).
- **Why:** a rusted base reads as years of neglect, but the story is one bad hour in a working station. Contrast with the clean gallery next door is the horror.
- **Alternative:** keep `labPanel` and add clean accents. Rejected, because the base material dominates every view.

### D2. The coolant line is one continuous prop, routed by waypoints
A new `coolant_line` kit piece takes a list of waypoints. It builds:
- an insulated pipe in matte grey lagging with blue bands every 2 m
- wall brackets every 1.5 m
- a valve and a sight glass at set points
- `penetration` collars wherever it passes through a wall

Route (in the generator, one call per room so each room merges its own part):

```
R04 culture column (9.5, *, 28.6) -- up to 2.9 m -- west along z 28.6 to the service wall (x 2.25)
   service panel on R04's west wall at z 28 (warped; the tag lands here later)
   north along the wall to z 25.3, through the wall at 2.9 m
R05 east wall (x 1.75, z 25.3) -- west along the ceiling at z 25.3 to x -3.5 -- through the south wall
R06 north wall (x -3.5, z 26.25) -- south along the west side at 3.2 m to z 37 -- east along the south wall
   down to Giles's panel (power box) at (-2.2, 1.3, 37.75), beside the bulkhead
```

- **Why one prop:** the player follows a single, continuous object. Separate pipe segments placed by hand drift apart at the walls.

### D3. Bloom density follows the line, from mass to trace
- **Meshes:** `bloom_growth_c` and `_d` (masses) and `bloom_growth_a` and `_b` (low spreads), rotated and scaled per placement.
- **Decals:** the `bloom` slot on walls and ceiling beside the line.
- **Density per room:**

| Room | Meshes | Decals | Where |
|---|---|---|---|
| R04 | 4–5 (two masses on the column's base, spreads along the service wall, one at the panel) | 4 | column, wall run, panel |
| R05 | 2 (a spread where the line leaks above the Lab B door, one at the R06 doorway) | 3 | drips below the line |
| R06 | 1 (a mass bursting through the ruptured duct) | 3 | trace along the line, the last one touching Giles's panel |

- **Before the drop, only the growth inside the column shows** (Lab B is visible from the gallery). Everything outside it listens for `bloom:spread`. The `drop` sequence emits it at the burst, and the action restore re-emits it on load when `drop_done` is set.
- **Shared material.** The bloom meshes are drawn with one shared `bloom` slot material, keeping their own UVs, instead of their embedded textures. The four meshes come from the same source texture, so this removes duplicate textures. It needs a `material` param on imported-prop stand-ins: the registry swaps the model's materials for a `keepUvs` clone of that slot material.
- **Breathing.** Two masses (column, duct) breathe: a 4–6 s scale sine of ±2 %, as a `dynamic` child with a `tick`, so they don't merge.

### D4. R04 Lab B: culture lab, composed for the glass

```
 z22  ===================== gallery glass (R03) =====================
      |  biosafety cabinet   .      .  console (Voss's desk)      |
      |  [ BSC ]   bench A   .  VOSS  .   bench B    [incubators] |
 z26 =D (bulkhead)          . (8,26.5).                  [freezer]|
      | service wall:  culture column (9.5,28.6)   lab cabinet     |
      | panel z28 +bloom    [ COLUMN ]+masses     [ CAB ]          |
 z30  -----------------------------------------------------------
      x2                                                       x14
```

- **Voss's surroundings stay intact:** `labb_victim`, the two benches within 1.5 m of her, the key light, and a clear sight line from the gallery to her chest band.
- **The culture column** stands where the specimen tank was, so the gallery sees the column behind her. It's a cylinder on a skid with a lit amber medium. The bloom is visible inside, and a coolant jacket loop feeds it from the line.
- **Equipment** goes against the east and south walls, out of the glass sight lines:
  - a biosafety cabinet (west, by the glass)
  - an incubator stack and a −80 freezer with frost (east)
  - the lab cabinet (south)
- **Quarantine dressing:** tape inside the bulkhead, a negative-pressure gauge reading red (−12 Pa), and a biohazard placard.
- **Light:** neutral white work light. The key light on Voss is unchanged.

### D5. R05: decon junction

```
 z14  ---------------------- north ----------------------
      | shower+eyewash  PPE lockers x3      directory    |
      | (NW)                                   D gallery  (z16)
      | hazmat rack                             console+radio
 z20 vent (W, moved?)       tipped sample cart           |
      |   floor drain grate          dropped PPE         |
      | bloom spread under line --- coolant line z25.3 ---D Lab B (z24)
 z26  ---------------------- D R06 (x0) -----------------
      x-6                                               x2
```

- **Cover sits against walls and corners:** the shower stall (partial, 2.2 m tall), the lockers, and the tipped cart (0.5 m, a step, not a perch). The middle stays open so all three approaches read: the Lab B door (east), the west vent, and the drain grate (south-west).
- **The floor spawn becomes `r05_drain`,** rising from a floor drain grate in the south-west, so it has a visible source. The west vent stays, re-dressed.
- **Light:** red lockdown strobe plus one steady white work light over the middle.

### D6. R06: compartment boundary, built around the cover-me fight

```
 z26  ===== D from R05 (x0) ==========================  coolant line in (x-3.5)
      | cable drum                         gas-cylinder |
      |           [ruptured duct overhead]   cage (E)   |
 z31  | coolant  ~~~ bloom mass ~~~      HOLD (x-0.5,z32)  <- r06_hold
      | line     [ PUMP SKID 1.2m ]                     |
      | runs S   service trench grate (W, z34-36)  wall vent (E, z34)
 z36  | along W  switchgear (electrical_box_02, E)      |
      |   -> panel (-2.2, 37.75) GILES   ==BULKHEAD==   (wheel, manifold, status board)
 z38  ------------------------------- D R07 (x0) -------
      x-6                                              x2
```

- **Giles** works facing the south wall at the panel, with his back to the hall. He's on the coolant line, where his stage-1 tell plays after the fight.
- **Approaches** (six enemies as before, with new placements and ids):

  | Spawn | Count | Source |
  |---|---|---|
  | `r06_duct` | 1 | ceiling, through the bloom-burst duct; lands west-centre |
  | `r06_trench` | 2 | floor, out of the service trench grate on the west side |
  | `r06_vent_e` | 2 | east wall vent, moved south to z 34 so it threatens Giles |
  | `r06_corridor` | 1 | behind, from R05 |

  Every source is visible from the hold point except the corridor, which arrives behind on purpose. Squadmate barks call out each source.
- **Cover:**
  - **pump skid:** 1.2 m tall, too tall to jump onto; it splits the duct and trench lanes from Giles
  - **gas-cylinder cage:** 1.4 m
  - **switchgear:** 2.1 m
  - **cable drum:** 1.0 m, deliberately a climbable perch, far from Giles so standing on it costs coverage
- **Clearances:** a 1.2 m lane from the north door down the east side to the bulkhead and around Giles's spot, for the squad. Every new top 0.35–1.0 m high goes on the jump-tops review list.
- **The bulkhead dressing:** a dogging wheel, a pressure manifold with gauges, and a status board reading "SEALED — SECURITY SIDE". It turns green on `D_R06_R07` open, the same moment the existing `click` plays.
- **Light:** red lockdown with one white work light over the panel, so Giles and the enemies on him stay readable.

### D7. Texture memory: target density, and the shared bloom
The imported props were made at 1024 px per metre, the hero ceiling. At that density the wing would add roughly 300 MB of GPU textures, more than double today's 246 MB. Instead:
- Re-import props 1 m or larger at **512 px per metre**, the surface-dressing target: `lab_cabinet`, `electrical_box_02`, `platform_trolley`, `cable_drum`, `bloom_growth_*`. This is a config change plus a re-run of `npm run props`.
- The bloom meshes share the `bloom` slot (D3).
- **Expected increase** once the wing is drawn: about +45–60 MB, which is above the spec's 15 % line.
  - **Reason:** these are the first textured imported props in the slice.
  - **Where:** the wing is drawn only during the briefing (through the glass) and the action half.
  - The design records the measured figure (runtime-memory spec).

### D8. Sequence changes are limited to ids and one restore
- `cover_me` keeps its steps. Only spawn ids inside `r06_cover` change, and `r06_panel` and `r06_hold` move.
- `drop` gains one `emit bloom:spread` at the burst.
- The action restore re-emits it when `drop_done` is set.
- `contact` is untouched except that the `r05_floor` spawn is renamed `r05_drain`.

## Risks / Trade-offs

- **`voss-burst-death` moves Voss, the benches or the key light before it lands** → this change starts only after it lands, and D4 builds around its final placements. A slice01 test checks that `labb_victim`'s line from the glass is clear of the column and the equipment.
- **Red lockdown light makes enemies hard to read** → one white work light is kept over each fight's focus, and the result is checked in the dev build by screenshot at the hold points.
- **New cover creates cheese perches** → tops are reviewed in `slice01JumpTops.test.ts`. The skid and the cage are above 1.0 m by design, and the drum is placed away from Giles.
- **Moving spawns breaks fight completion** → the R06 enemy-sim run checks that all six reach a target and the group resolves. The playtest checklist adds per-source checks.
- **The draw-call budget in R06 and R04** (new props, decals, two dynamic masses) → per-room counts stay under 60 in `slice01.test.ts`, with imported props counted at their recorded cost.
- **`adopt-physics-engine` changes collider handling** → stand-in colliders are plain boxes, the simplest thing to port.

## Open Questions
- The exact red level of the lockdown light, and how fast the strobe runs. Tuned in the dev build; it doesn't change the approach.

## Verification notes

### Memory (task 5.3, 2026-11-20)
Measured with the memory probe in a scratch session (`?level=slice01&slot=scratch&memprobe`), Medium:
- **Loaded title:** 62 three.js textures, 262.9 MB (250.7 MiB) of GPU textures. The 246 MB baseline was taken before the `bloom` slot and the lab palette slots existed; the difference is those slots' first upload.
- **After the wing is drawn** (title camera pinned at the five screenshot views in R04, R05 and R06, before the drop): 100 textures, 416.9 MB (397.6 MiB), so **+147 MiB**.
- **Why it is above the +45–60 MB estimate:** the estimate covered only the imported props, and they come to about 67 MiB of what was drawn (lab_cabinet 26.7, electrical_box_02 16, gas_cylinder 16, cable_drum 4, power_box 4; sizes read from the GLBs). The rest is surface slots uploaded on first sight from these views: the lab-wing palette (cleanWall, cleanSlate, steelDark, steelBrushed, rubber, hazardClean, cleanTeal) and the neighbouring rooms seen through doors. A real run uploads those slots as the player reaches the wing anyway. The probe has no per-texture breakdown, so this split is computed, not measured.
- **Over the estimate in the props share:** electrical_box_02 and gas_cylinder stayed at 1024². Lowering them to 512² (texturePxPerM 256–300) would save about 24 MiB if the budget needs it.
- The bloom GLBs' own textures are not drawn (their meshes use the shared `bloom` slot), and the bloom is hidden until the drop.

### Screenshots (task 5.2)
Taken in the dev build at 1280×720 with the title camera pinned: Lab B from the west and east doors, R05 from the gallery door, R06 from the north door, the hold point and the panel. They read as described: clean slate walls, red lockdown light with one white work light, the amber culture column, the status board over the bulkhead. One fix came out of it: the power box sat on the DANGER sign, so it, `r06_panel`, the line's drop and the wall patch moved 0.4 m west.
Not yet done: the post-off pass, the Lab B gallery view before the drop and the checkerboard pass, and a look at the bloom after the drop (the page exposes no way to fire `bloom:spread` from the console). The task stays open for them.

### Tests (task 5.5, 2026-11-20)
- `npm run typecheck`: clean.
- Touched files: labWing (kit) 6, palettes 7, importedProps 12, importedBudget 1, merge 8, labWing (world) 10, slice01 19, slice01JumpTops 1, wallClearance 2, manifest 3, credits 3, grid 9. All pass.
- Full suite, first run: 864 tests, 863 pass. The failure was `labWingFights` R06 ("3 of 6 reached a target"), caused by the `NavMeshNav.nodes` sampling bug below.
- Full suite after the nav fix: 866 tests, 866 pass; typecheck clean.

### Nav node fix (task 5.1, folded in at Justin's request)
- **Bug (pre-existing):** `NavMeshNav.nodes` ran one `findClosestPoint` per 1 m column spanning the whole level height, so each column returned a single poly, usually a walkable ceiling-slab top (y 3.35–4.15). The director's `reachable()` found no node near an enemy on the floor and culled every out-of-view group enemy after 10 s, however close it was. Every group fight was affected, not only the wing.
- **Fix:** sample each column in 1 m height bands (`NODE_LAYER`) and keep one node per walkable level. slice01 goes from about 2,150 nodes to 3,320 (1,169 on floors); built once and cached, about 35 ms.
- **Tests:** `src/ai/navmeshNodes.test.ts` (floor nodes exist under the wing rooms; no duplicates within a level). `labWingFights` now passes for both groups.
- **Not changed:** the slab tops are still on the navmesh. That is a navmesh-generation question for another change.

# Design

## Context

See proposal.md for why. The dive bay is defined in `scripts/gen-slice01.mjs` (section "R13 dive bay hub"), which writes `src/data/levels/slice01.json`. The generator and the JSON are in sync today: regenerating produces no diff, so a change confined to the R13 section only changes R13 in the output.

Current state:
- One deck, 4 m grid, cell (x, z) is world (4x, 0, 4z). R13a is cell (6,7); R13b is cells x 5–7, z 8–10 (world x 18–30, z 30–42), 5 m high; R13c is (4,8)–(4,9); R13e is (4,10); R13d is x 8–10, z 8.
- Doors: `D_R02_R13a` (owned by R02, out of scope), `D_R13a_R13b` (north wall of R13b at x 24), `D_R13b_R13c` (west, z 32), `D_R13b_R13e` (west, z 40), `D_R13b_R13d` (east, z 32), `D_R13d_R11` (sealed bulkhead, the climax entrance).
- `floor_moonpool` (in `kit/slice.ts`) cuts a 2.4 m hole (`MOONPOOL_WIDTH`) with a dark `paintDark` shaft, a glow slab at −2.8 m, the water shader at −0.55 m and a four-sided rail. `exteriorHull.ts` flags that cell as `pool` and leaves a hole in the hull bottom.
- All five rooms use area `dive_bay` (rustBlotch / diamondRusty / rusty hazard) and the `DIVE` atmosphere (fog 0.05, `dive_drip`). R13b has five cyan lights.
- The `dive_moment` sequence (`rounds.json`) places Sung at `diver_1_spot` on `trigger:dive_enter` (after the briefing) and plays four lines. The case is taken at `dive_case_pickup` and stowed with `round:dive_case` at `dive_case_locker` in R13e.
- The room builder already accepts `wallMaterial` and `ceilingMaterial` (a palette slot applied as `params.material` on every tile). It has no floor equivalent.

## Goals / Non-Goals

**Goals:**
- A bay that reads as a real 1-atm launch-and-recovery facility at depth, with a clear purpose per room.
- Keep every script hook working with no changes to dialogue, and keep `slice01.test.ts` green.
- Stay inside the 60-per-room draw-call budget with procedural pieces only.

**Non-Goals:**
- A live ROV camera feed rendered to a screen. It would cost a render pass and several calls. The sonar and telemetry screens are animated canvases. A live feed is a possible follow-up.
- New photo texture slots. The clean look uses existing slots plus decals.
- Positional looping sound emitters on props (no such runtime exists). Continuous sound comes from the room preset; the trunk event uses positional one-shot `sfx` steps, which already exist.
- Any change to R02, `D_R02_R13a`, R11 or the action-half script.
- Making the trunk operable by the player.

## Decisions

### 1. A launch trunk instead of an open pool
Real moon pools only work in habitats pressurised to ambient. At about 300 bar that is impossible for people, so the pool becomes a lock trunk: inner hatch at deck level, drained shaft, closed outer hatch.
- *Alternatives:* keep the open pool and ignore the physics, which is what the user called nonsense. Or a flooded ambient-pressure hangar seen through a thick viewport wall, which is good for later horror but a much larger rebuild that needs a second, wet room volume. Kept for a later chapter.

### 2. Keep the piece id `floor_moonpool`
The trunk is a rewrite of the existing piece's generator, with the same id, width and footprint. `exteriorHull.ts` keeps detecting the cell by id, and the generator's `floorOverride` stays as it is.
- *Alternative:* a new `floor_launch_trunk` id is clearer, but it means touching the hull builder, tests and the generator for no player-visible gain.

The new piece:
- 0.12 m steel coaming ring at deck level with clean hazard paint.
- Inner hatch, a 2.2 m square plate with a 0.8 m round viewport, hinged on the east edge with two hydraulic rams. It is animated between open (swung up to about 100°, leaning toward the east rail) and closed, driven by a `trunk:state` event (`open` | `closed`) that the piece listens to. It has no collider, because level colliders are static and the rail is the barrier in both states.
- Shaft walls in `hullPlate` with weld seams and painted depth marks every 0.5 m down to −3.0 m.
- Outer hatch at −3.0 m with a glowing blue viewport.
- Standing water (existing `waterMaterial`) at −2.85 m.
- Rail as now, but with a hinged gate section on the east side, modelled shut; colliders unchanged.
- The hull cell keeps `pool = true`. `exteriorHull` adds a closed square skirt from the hull bottom down to −3.1 m, capped by the outer hatch plate, so the hull reads closed from outside.

### 3. Palette: clean `dive_bay`, rust only in R13d by override
New `AREA_PALETTES.dive_bay` (`servicePaint` turned out to be a peeling-rust photo, and `boltPanel` as the main wall read black in the browser because it is metallic, so the walls use the station's clean slate panel with a bolted upper band):

| Key | Slot |
| --- | --- |
| wallMain | cleanSlate |
| wallAlt | boltPanel |
| ceiling | steelDark |
| trim | steelBrushed |
| floor | diamond |
| floorAlt | grating |
| hazard | hazardClean |
| doorSurround | cleanSlate |
| doorPanel | steelDark |
| doorGlassBar | steelBrushed |
| pipeAccent | cleanTeal |
| pipeMain | steelDark |

R13d keeps area `dive_bay`, so the single-area `dive_map` reveal still covers it. It gets `wallMaterial: 'rustBlotch'`, `ceilingMaterial: 'paintDark'` and a new generator option, `floorMaterial: 'diamondRusty'`. Like `wallMaterial`, `floorMaterial` sets `params.material` on that room's floor tiles; the floor pieces already honour it through `resolvePalette`. Its hazard stripes become clean too, which is acceptable.
- *Alternative:* a new area `dive_service` for R13d. Rejected, because `mapStations.reveals` names one area, so it would need a schema change or drop R13d from the dive map.

### 4. Light and atmosphere
- `DIVE` becomes fog `#0b1316` at 0.015 with `dive_drip` ambience. R13b uses `launch_bay`.
- R13b keeps five light slots. Four become steady neutral work lights (`#eef4f6`, intensity tuned in the browser, shafts off or near 0.01). The fifth, the `flicker` slot over the south wall, becomes steady. The flicker belongs in R13d.
- Trunk blue comes from three things that cost no light slot:
  - the outer-hatch viewport glow
  - an upward `createShaft` cone (`fx/shafts.ts`) from the trunk mouth to the ceiling, very low intensity
  - a **caustics plane**: one additive plane under the ceiling, with a small shader of two scrolled cell-noise layers in `#58c8e0`. It fades with distance from the trunk centre and stops when the hatch is closed (a uniform set from `trunk:state`).
  - *Alternative:* a spotlight projecting a caustic texture (three.js `SpotLight.map`). Rejected, because that needs `castShadow` and the shadow-light budget is reserved for the flashlight and emergency lights.
- **Mist:** two thin noise-scrolled transparent planes, 0.15 m and 0.35 m above the shaft water, inside the shaft only.
- **Drips:** a small points system attached to the ROV prop, with 12 drops falling from the frame to the deck and a ripple ring decal on the puddle where they land. It uses the existing `drip` one-shot, so no new sound.
- **Beacon:** a gantry-mounted amber rotating beacon with its own fixture material and a rotating additive cone. It is idle (off) except during the secure event, and respects `reducedFlashing` (steady glow instead of rotation), read from a small `render/flashing.ts` flag that `Level.update` sets every frame.
- R13a, R13c and R13e use the same neutral work-light colour at their current intensities, retuned in the browser.

### 5. Layout (world coordinates)

```
 z 26 ┌────── R13a Wet Vestibule ──────┐   boot wash (E wall), coverall hooks,
      │  dive_map (W)  · drain ·  hooks│   drain grate on the centreline
 z 30 └───────────┬──door──┬───────────┘
      │ whiteboard│        │ pilot console (N wall, faces S)  │
 R13c door ◄─z 32 │        │                     z 32 ─► R13d door
      │ wet bench │  ╔══╗  │ diver_1   ROV on cradle (28.4,38.4)
      │ core rack │  ║TR║  │ (gate E)  maint_1 crouched W of it
      │ case ●    │  ╚══╝  │           gantry bridge above, hook over ROV
 R13e door ◄─z 40 │        │                     winch (28.8,41)
      │ eyewash  shadow-board + labelled pipe run (S wall)        │
 z 42 └───────────────────────────────────────────────────────────┘
     x 18                 x 24                                   x 30
```

- Trunk centre (24, 36), rail ±1.45 m.
- Gantry: two ceiling runway beams at about y 4.6 along x 19.5 and 28.5 from z 31 to 41, a bridge beam across at z 38.4 with a trolley and hoist over the ROV, and the beacon on the bridge. Ceiling-hung, no floor legs or colliders.
- Pilot console: a three-screen bank against the north wall, x 26.5–29.5, facing south toward the trunk. It replaces the current `console`.
- Wet bench and core rack: against the west wall between the two west doors (z 34–38). The case rests on the deck at `dive_case_pickup` (21.4, 37.2), where the existing pickup puts it, so Sung at `diver_1_spot` (21.4, 36, facing west) stands by the bench.
- Whiteboard: north wall west of the door, "DIVE 214 · TRENCH WALL · 6 CORES · LAB B".
- Eyewash and shadow-board: on the south wall, with the pipe run below.
- Clear lanes: R13a door → R13e door runs through x 19.2–22.5 (3.3 m). R13a door → R13d door runs north of the trunk (z 30.6–34.5). Both are above 1.2 m.
- **R13a:** boot wash and coverall hooks on the east wall (replacing the DIVE locker), a drain grate at the centre, `dive_map` kept on the west wall. `dive_entry` and `priya_start` stay on the x 24 centreline, which stays clear.
- **R13c ROV Workshop:** workbench with a spare thruster and manipulator arm along the west wall, a battery-charging cabinet and parts-bin wall on the north wall, a gas cylinder rack and hose reels in the south-east corner. The two suit racks and the locker are removed.
- **R13e Sample Store:** the cold-store stow unit and custody terminal against the west wall at `dive_case_locker` (15, 1.0, 40), core fridges along the south wall, the frosted freezer and the "HOLD AT 302 BAR" pressure cabinet on the north wall, three survival suits by the door on the east wall. The radio keeps its spot. `diver_2` stays at (16.6, 39.4).
- **R13d:** labels on the existing pipe run, plus one leak point with a small steam puff (reusing the mist shader on a vertical quad). Its hiss comes from a new repeatable R13d trigger box at the leak, `trigger:dive_leak`, and a small sequence that plays `sfx leakHiss` at the leak anchor with a 20 s cooldown. The shared `hull_groan` preset is not edited, because other rooms use it. No other change.
- Exact prop positions are tuned in the browser. The anchors above are fixed.

### 6. Screens and signage as shared canvases
Each canvas is a draw call, so text is grouped:
- one canvas for the pilot console's three screens (sonar sweep, telemetry with outside pressure 302 BAR, tether and trunk state)
- one for the whiteboard
- one sign atlas per room carrying the room plate, the life-support panel and the stencils
- one label strip for the R13b pipes and one for R13d

Trunk state text redraws on `trunk:state`. Sonar and telemetry redraw at a low rate (a few Hz) with small drifting values.

### 7. Trunk secure event
- Append `{ "do": "emit", "event": "trunk:secure" }` as the last step of `dive_moment`. Its lines and order are unchanged.
- New sequence `dive_trunk_secure`, triggered on `trunk:secure`, `unless: dive_trunk_secured`. The steps:
  1. beacon on
  2. `sfx trunkChirp` at `anchor:moon_pool`, twice
  3. emit `trunk:state closed`; the hatch animates for about 4 s with `sfx trunkHatch`
  4. `sfx trunkVent` at the trunk
  5. screen text "TRUNK SECURED"
  6. beacon off
  7. set flag `dive_trunk_secured`
- Restore: the quiet-half restore (`quiet_restore.json`, which already has a dive branch) emits `trunk:state closed` when `dive_trunk_secured` is set, so loads and death restarts show the closed hatch without replaying the event.
- Because it starts from the last step of `dive_moment`, it cannot overlap Sung's lines. `maint_1` keeps `crouchWork` (no new animation).
- *Alternatives:* run the cycle on entry, which overlaps Sung's first line 1.2 s in. Or run it on case pickup, which competes with the round's own feedback.

### 8. Audio
- New preset `launch_bay` in `src/audio/ambience.ts`, with two beds:
  - `ambLaunchBay`: hydraulic power-pack hum with water lapping in a steel shaft
  - the existing `waterRumble`, low-passed

  and these one-shots:
  - existing `drip` (perimeter)
  - existing `pressurePing` (far, muffled)
  - existing `hullGroan` (far, rare)
  - new `winchClunk` (ceiling, every 20–45 s)
- `distantMoan` is left out of `launch_bay`, to keep the quiet half calm in the bay's main room. `dive_drip` keeps it in R13a, R13c and R13e.
- New ElevenLabs clips via `npm run ambience:generate -- --id <id>`, with manifest entries added to `scripts/ambience-generate.ts`:

| id | file | category | prompt intent |
| --- | --- | --- | --- |
| `ambLaunchBay` | `bed-launch-bay.mp3` | bed | Seamless loop: large steel hall, low hydraulic power-pack hum, faint water moving and lapping in a deep steel shaft, distant ventilation, no voices, no music |
| `winchClunk` | `oneshot-winch-clunk.mp3` | oneshot | Single heavy cable-winch ratchet clunk and short cable creak in a metal hall |
| `trunkChirp` | `oneshot-trunk-chirp.mp3` | oneshot | Short industrial two-tone warning chirp, two notes, clean, slightly reverberant |
| `trunkHatch` | `oneshot-trunk-hatch.mp3` | oneshot | Hydraulic rams whine as a heavy steel hatch swings shut over about four seconds, ending in a deep metallic clunk and latch |
| `trunkVent` | `oneshot-trunk-vent.mp3` | oneshot | Short pressurised vent hiss tapering off, with a few drips |
| `leakHiss` | `oneshot-leak-hiss.mp3` | oneshot | Thin hissing steam leak from a pipe joint, irregular, two to three seconds |

- Each is registered in `SAMPLE_URLS` (`src/audio/sounds.ts`). While a file is missing or loading, the `launch_bay` bed falls back to `waterRumble`, and the preset keeps the procedural `metalKnock` beside `winchClunk`. The trunk and leak one-shots are sample-only, like the dock's `archPass`: silent until their files exist, and a missing file only logs a warning. `npm run audio:audit` must pass.
- The generator reads `ELEVENLABS_API_KEY` from `.env`. The key is never printed or committed.

### 9. NPC fit
`diver_1` (idle near the trunk gate), `maint_1` (crouched at the ROV), `diver_2` (R13e) and Sung's scripted spot keep their ids and stay within 0.5 m of their current positions. Their role labels stay `diver`/`maintenance`. In a 1-atm station a "diver" reads as ROV crew; no dialogue needs to change.

## Risks / Trade-offs

- **R13b draw calls.** Rough count:
  - merged structure and flat props, about 14
  - five light slots, about 15
  - four canvases
  - water, shaft, caustics, mist, drips and beacon, 6
  - decals, 4–6

  That totals about 45–50. → Check after each task group with the level overlay and the budget test. Merge decals into one atlas if needed.
- **The trunk reads as a dark hole.** → The viewport glow, caustics and depth marks are there to sell depth. Check screenshots from the R13a door at eye height, with and without post-processing.
- **Conflict with `dock-security-checkpoint`.** Both edit `gen-slice01.mjs` and `slice01.json`. → Edit only the R13 section and the new `floorMaterial` option, and regenerate after rebasing. Check that the regenerated JSON differs from the pre-change file only in R13 entries.
- **Jump tops.** New benches and cabinets (0.35–1.00 m) become climbable. The bay has no fight. → Update the list in `slice01JumpTops.test.ts`.
- **Fog change affects mood.** The bay will feel less oppressive. → Intended for the quiet half. R13d keeps its 0.09 fog as the contrast.
- **The beacon and caustics are motion near the player.** → The beacon honours `reducedFlashing`. The caustics move slowly with low contrast.
- **Uncommitted kit work in the tree** (`kit/*.ts` modified, `exteriorHull.ts` untracked). → Build on the working tree as it is, and do not revert or reformat unrelated hunks.

## Migration Plan

- Regenerate `slice01.json` with `node scripts/gen-slice01.mjs` after each R13 edit.
- Saves keep working: room and anchor ids are unchanged, and the new flag defaults to unset (trunk open).
- Rollback: revert the generator, kit, palette and audio edits, then regenerate.

## Open Questions

- Final wording of signs and whiteboard text, and the ElevenLabs prompt tuning. Both are adjusted during apply, without changing the specs or tasks.

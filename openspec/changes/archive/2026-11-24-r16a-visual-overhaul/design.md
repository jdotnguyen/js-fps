# Design

## Context

`R16a` ("Arrival Track Dock") sits at isolated grid cells `x = 20..22`, `z = 8..10` (`x = 78..90`, `z = 30..42`, `height: 5`, `floorY: -0.6`) immediately east of `R16b` ("Arrival Concourse", `x = 54..78`, `z = 26..46`, `height: 8`, `y = 0`). Its west edge (`x = 78`) is completely open (`12 m`) onto three full-width `stairs` climbing `+0.6 m` into `R16b`, where three symmetrical pairs of `concourse_pillar`s (`width: 1.5`, `height: 8`) stand at `x = 73.5, 68.5, 63.5` on `z = 31.2` and `z = 40.8`.

See `proposal.md` for motivation and `specs/transit-wing/spec.md` for behavioral requirements.

## Goals / Non-Goals

**Goals:**
- Dress `R16a` to match `R15a`'s clean industrial transit craft while obeying `docs/surface-dressing-standard.md` and `docs/modular-grid-standard.md`.
- Add real ocean windows (`wall_window`) with exterior floodlights along `R16a`'s east wall behind Train Car B.
- Layer dense, high-contrast horror blood decals and a single `Level.setPropTransform`-movable fallen body (`r16_pillar_body`) on top of clean base textures without dirtying the shared `transit` palette.
- Provide named overhead lights (including 1–2 `shadow: true` hero lights), pitch-black blackout + selective flash readiness, and rotating red emergency beacons (`transit_rotating_beacon`) on the facing pillar faces with `reducedFlashing` compliance.
- Provide `?debug&jump=r16` lighting-mode preview parameters so full lighting, blackout, and rotating red beacons can all be verified in the browser.

**Non-Goals:**
- Scripting the Phase 3 arrival radio exchange, timed light-flash choreography, door-open trigger, or body-pull animation (this change prepares all visual assets, named light IDs, beacon events, and the movable `r16_pillar_body` prop for that subsequent script).
- Changing `R16a`/`R16b` room footprints, stair geometry, train ride timings, or `r16a_north` blast-gate clearance.

## Decisions

### 1. East-wall ocean windows (`wall_window`) behind the train
- **Choice**: Replace `R16a`'s east-wall `wall_panel` / `wall_plain` on cells `[22, 0, 8]`, `[22, 0, 9]`, `[22, 0, 10]` (`rot: 270`) with `wall_window` (`params: { flicker: true }`), matching `R01` and `R15a`.
- **Rationale**: `windowWall()` (`src/world/kit/detail.ts`) and `ExteriorHullBuilder` (`src/world/kit/exteriorHull.ts`) already handle sunken-floor window openings (`cell.floor + opening.sill`) and automatically place exterior abyss floodlights pointing out into the dark ocean behind the glass. Because `R16a` is isolated from the main station, no other room is visible through the east windows.
- **Alternative considered**: A single center window on `[22, 0, 9]` flanked by `wall_panel`. Using all three east cells matches `R15a`'s continuous track-side ocean glazing and frames the full `9 m` length of Train Car B against the lit dark ocean.

### 2. Overhead framing clear of the open west stair seam
- **Choice**: Add overhead transverse gantry beams / `rib_frame`s at the north and south ends of `R16a` (aligned with `z = 30.5` and `z = 41.5`, or open-west ceiling ribs) plus hung `pipe_run`s along `y = 4.55`, keeping the entire west stair opening (`x = 78..79.8`, `z = 30..42`) and the central exit path (`z = 35`) free of floor-level columns.
- **Rationale**: `R16a`'s west edge is a full `12 m` open seam into `R16b` with stairs starting at `x = 78..79.8`. Placing standard `rib_frame` legs along `x = 78.3` would block the stairs. Placing full-height piers only against the north/south walls (`z = 30.3`, `z = 41.7`) and overhead transverse ceiling beams across the `5.0 m` soffit gives strong architectural rhythm without obstructing movement or sightlines.

### 3. Parameterized arrival board vs. new kit piece
- **Choice**: Extend `transitDepartBoard` (`transit_depart_board` in `src/world/kit/transit.ts`) with an optional `mode: 'departure' | 'arrival'` param (defaulting to `'departure'` so `R15a` is unchanged) that renders `TRANSIT LINE 01 // ARRIVAL TERMINAL` — `PLATFORM B | ARRIVAL TRACK DOCK` — `PROCEED WEST TO CONCOURSE & CHECK-IN` — `STATUS: DOCKED // AWAITING CLEARANCE`.
- **Rationale**: Reuses the exact frame geometry, `CanvasScreen` pipeline, and draw-call budget of `R15a`'s board with zero duplicated code.

### 4. Rotating red emergency beacons (`transit_rotating_beacon`)
- **Choice**: Add a dedicated `transit_rotating_beacon` prop in `src/world/kit/transit.ts` modeled on `diveBay.ts`'s `gantry-beacon`, featuring:
  - Wall/pillar mounting bracket + red polycarbonate dome (`origin` at mount face, facing `-Z` so `rot` aims it cleanly outward from any pillar or wall face).
  - Twin opposing additive volumetric red beam cones rotating around the dome axis at `4.2 rad/s` when active, hidden when `flashingState.reduced` is true (swapping to a steady red emissive lens).
  - A claimed `'emergency'` light slot so each active beacon casts real red light onto the facing pillar and floor, plus an event listener on `transit:r16_beacons` (`{ on: boolean }`) that starts off by default and resets to off on level reset.
- **Placement**: Mounted on the facing inner faces of `R16b`'s concourse pillars (`x = 73.5, 68.5, 63.5`; north row `z = 31.95` facing `+Z`, south row `z = 40.05` facing `-Z`, `y = 3.1 m`), plus a facing pair on `R16a`'s north/south walls (`x = 82.0`, `z = 30.08` / `41.92`, `y = 3.1 m`).
- **Rationale**: Putting them on the facing pillar faces delivers the exact eerie cross-sweeping red emergency light visible from Train Car B's windows while respecting `reducedFlashing` and the fixed scene light budget.

### 5. CC0 dark-crimson `blood_decal` props and rigged `Humanoid` fallen crew bodies (Approach A)
- **Choice**:
  - Use 20 CC0 photographic alpha-masked blood decals from Texture Ninja (`public/assets/textures/blood/*.webp`, dark-crimson graded via `ffmpeg` and credited in `CREDITS.md`) in `blood_decal` (`src/world/kit/transit.ts`), sharing one cached glossy `MeshStandardMaterial` (`roughness: 0.16`, `polygonOffset`, `depthWrite: false`) per texture asset.
  - Replace raw GLB prop posing (which caused floating and contorted limbs because vendor GLBs have inconsistent scales, bind poses, and unskinned `Box3` bounds) with **Approach A**: author fallen crew bodies as static `dead: true` entries in `room.npcs` (`slice01.json`) backed by the boot-cached `BodyModelLibrary` (`guard1`, `office1`, `office2`, `office3`, `scientist1`, `botanist1`) and the canonical 21-joint `Humanoid` skeleton.
  - Expand `src/data/poses.json` with 5 additional authored dead poses (`corpseSprawled`, `corpseCurled`, `corpseTwisted`, `corpseReaching`, `corpseWallSlump`) alongside the existing 4 (`corpseProne`, `corpseSupine`, `corpseSide`, `corpseSlumped`) so every crew model grounds cleanly at `y = 0` in varied, realistic death postures.
  - Support `dead: true` and `blood: true` on `NpcData` / `NpcDirector` (`src/ai/npcs.ts`, `src/ai/npcActor.ts`): `dead: true` puts the `Humanoid` into `playDead(pose)`, freezes idle-life/breathing/gaze/AI updates, disables body push/collision so the player walks cleanly past/over them, and still allows `NpcDirector` scripted dragging/movement on `r16_pillar_body`. `blood: true` composites dark-crimson `assets/textures/blood/*.webp` splatters directly onto the corpse's cloned `BodyMaterials` diffuse maps with lowered roughness (`<= 0.48`) so blood soaks their clothes and skin.
- **Rationale**: Reusing `BodyModelLibrary` + `Humanoid` + `PoseLibrary` eliminates all floating/pretzel-bone bugs, avoids duplicate GLB network loads, makes every dead pose reusable across all crew models, and integrates natively with `NpcDirector` drag scripting for `r16_pillar_body`.
- **Alternatives considered**: Raw GLB loading inside `fallen_body` (rejected: vendor bone axes and unskinned `Box3` bounds caused floating/contorted corpses); pre-baked static dead GLBs (rejected: multiplies asset size across model × pose combinations).

### 6. Named lighting & debug preview modes
- **Choice**: Give `R16a`'s overhead lights explicit IDs (`r16a_light_n`, `r16a_light_mid`, `r16a_light_s`, `r16a_light_track`), mark `r16a_light_mid` (over the boarding gap/platform) and one flanking light as `shadow: true`, and keep `R16a`'s default state cleanly lit. Add an optional query flag `?debug&jump=r16&r16mode=blackout|emergency` in `src/app/session.ts` (non-invasive, debug-only) so full lighting, pitch-black blackout, and rotating red beacons can each be inspected directly in the browser.

## Risks / Trade-offs

- **Draw calls & shadow budget in `R16a` + `R16b`**: `R16a` and `R16b` are mutually visible (`visibleFrom`). → Mitigation: Cap `R16a` to 2 `shadow: true` lights (respecting Medium's 2-shadow pool), share cached `blood_decal` materials across variants, and keep `transit_rotating_beacon` beam geometry merged into one mesh per beacon.
- **Ocean window light spill during pitch-black arrival**: Exterior floodlights on `wall_window` have volumetric cones outside the glass. → Mitigation: Keep `R16a`'s interior blackout (`tintRoomLights('R16a', 'black')`) darkening all interior fixtures and ambient to 0 while the distant exterior ocean beams remain faint/atmospheric behind the train (or dimmable if needed in the Phase 3 script).
- **Platform prop clutter blocking squad pathing**: `R16a` has a `4 m` platform (`x = 78..86`) and stairs (`x = 78..79.8`). → Mitigation: Restrict all platform prop clusters to the north (`z < 33.0`) and south (`z > 37.5`) margins along `x = 80.5..85.0`, leaving `z = 33.2..36.8` completely clear and verified by `slice01.test.ts` headless walks.

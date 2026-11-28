# Design

## Context

See [proposal.md](./proposal.md) for motivation. Currently in `src/world/kit/transit.ts` and `src/data/levels/slice01.json`:
- `transit_train_shell` builds a static greybox shell (metal floor, roof slab/ribs, windowed sides, open west doorway, end windshields) at `R15a` (`[48, 0, 38]`, `length: 10.4`) and `R16a` (`[88, -0.6, 35]`, `length: 9`).
- `transit_blast_gate` (`r15a_south` at `z = 45.875` and `r16a_north` at `z = 30.125`) animates its shutter leaves on `transit:blast_gate`, but its shutter collider (`pb.solid(-hw, 0, -2.0, hw, boreH, -1.72)`) remains permanently enabled.
- `Level.setPropTransform(id, pos, yaw)` already moves named props and updates their `CollisionWorld` boxes, and `Level` supports `anchor` placement and room visibility culling (`R15a` and `R16a` are mutually culled).
- `Player` moves via `moveBody(..., this.world.colliders)` in `src/actors/player.ts`. There is no built-in moving-platform carry yet.

**Findings from the first playtest of the implemented ride** (explore session; these drive Decisions 6-10):
- The car floor slab spans `y = -0.02..0.10`, but the rails (`transit_tunnel_shroud`, `transit_sea_tunnel_rig`, `track_bed`) are `0.12` tall at `x = +/-0.72..0.75`, so they poke through the cabin floor along the whole car, and the car has no ride height or undercarriage, so no track is visible below it.
- The boarding door leaf sits inside the `0.14 m` wall slab and "opens" by sliding `+2.18 m` along `z` over the window span (wall slab, mullions, glass), so it intersects the wall and windows.
- `R15b` is excluded from the exterior hull (`level.ts`) and has no ocean-view window piece, so `Level` never draws the real exterior for it (`exteriorRooms`). The rig and both shrouds are wrapped in `m.black` slabs, so every pane shows an unlit black wall, not ocean.
- The headlights are an additive hollow `ConeGeometry` (14 m long, `2.2 m` radius, double-sided) plus two raw `THREE.SpotLight`s per car. `LightPool` keeps a fixed light count per quality tier so materials recompile only on a tier switch; raw spotlights that appear and disappear with room visibility change the count. The cone also cuts through the gate shutter and room walls.
- Room lookup (`roomAt`) uses cell footprints, and cells already cover both shrouds, so culling is not the cause of the clipping.

## Goals / Non-Goals

**Goals:**
- Upgrade `transit_train_shell` into a clean, finished commuter rail cabin with animated boarding door leaves and optional cabin-interior details while preserving existing `R15a`/`R16a` walkability and `transit.test.ts` contracts.
- Make `transit_blast_gate` toggle its shutter collider when opened/closed via `transit:blast_gate` and reset cleanly on `level:reset`.
- Implement a deterministic, frame-rate-independent 3-stage hybrid ride (`Stage 1: R15a pull-out`, `Stage 2: infinite scrolling windowed glass sea-tunnel`, `Stage 3: R16a glide-in`) that carries Jay smoothly without camera jitter, floor clipping, or `PhysicsWorld` static-mirror desync.
- Keep every transit surface strictly clean (`transit` palette: `cleanSlate`, `steelDark`, `steelBrushed`, `concretePainted`, `hazardClean`, `cleanTeal`, `glass`) with zero rusty or dirty textures.
- Make the ride read correctly from inside the cabin: no geometry intersecting the car, a visible lit track below and ahead of the car, real-looking headlights, and a visible abyssal ocean (not black slabs) outside every window in all three stages.

**Non-Goals:**
- Reusing the station's real exterior (`buildExterior`) for the ride rooms; the ride gets its own self-contained abyss backdrop (Decision 8).
- New texture samplers on lit materials (see the texture-unit budget); all new effects use procedural, unlit shader or basic materials.
- R16a/R16b/R16c massacre dressing, flickering lights, or CCTV mount (Phase 2d).
- Phase 3 finale dialogue, Gemini TTS VO, ElevenLabs music/SFX, or new creature.
- Free-roam driving of the train by the player.

## Decisions

1. **Train Cabin Interior & Animated Boarding Door in `transit_train_shell`**
   - *Decision*: Enhance `trainShell` in `src/world/kit/transit.ts` with clean interior details: side bench seating (with seat/armrest colliders kept narrow along the walls so the central aisle remains `>= 1.8 m` wide), overhead stainless grab rails + hand-straps, clean interior cove/ceiling light strips, end-bulkhead transit route/status strips, and a sliding west boarding door leaf (`pb.dynamic`) driven by a `transit:train_door` event (and `level:reset`), which slides into a real wall pocket (Decision 7), with the car body lifted on visible bogies (Decision 6).
   - *Doorway collider*: When `doorClosed` is true, enable a doorway collider across `z in [-doorHalf, doorHalf]`; default to open (`enabled = false`) so existing static walkability tests in `transit.test.ts` and `slice01.test.ts` continue to pass unchanged.
   - *Alternative rejected*: Creating a separate `transit_train_interior` prop piece. Keeping it in `transit_train_shell` ensures Train Car A, the Stage 2 tunnel cabin, and Train Car B share identical proportions and clean materials.

2. **Blast-Gate Pass-Through Collider (`transit_blast_gate`)**
   - *Decision*: Tag or expose the shutter collider in `transitBlastGate` (or toggle it via `PieceBuilder` / `Level` door-like collider handle) so when `progress > 0.85` (or `open` is true), the shutter collider's `enabled` flag becomes `false`, and when closed or reset, `enabled = true`. `PhysicsWorld.syncMirror()` already mirrors `c.enabled` every step.
   - *Alternative rejected*: Removing the shutter collider permanently. Keeping it enabled while sealed prevents the player from walking into the dark alcove before the gate opens.

3. **3-Stage Hybrid Architecture (`R15a` -> Isolated Sea-Tunnel Rig -> `R16a`)**
   - *Stage 1 (Pull-Out, ~4.5 s)*:
     - `r15a_south` opens via `transit:blast_gate` (`{ gateId: 'r15a_south', open: true }`).
     - Train Car A (`id: "r15a_train"`) closes its boarding door, then accelerates smoothly south (`+Z`) by `17 m` (from `z = 38` to `z = 55`), passing cleanly through the `r15a_south` portal at `z = 45.875`.
     - A dark sea-tunnel extension shroud (`z = 46..64`) behind `r15a_south` ensures looking out the front/side windows during pull-out shows lit tunnel ribs and the shared abyss backdrop (Decision 8) receding into dark teal water rather than empty void or black walls.
   - *Stage 2 (Infinite Scrolling Windowed Glass Sea-Tunnel, configurable duration e.g. ~8–12 s)*:
     - Seamless handoff (using `placeAtEye` preserving Jay's local cabin offset, yaw, and pitch, with zero fade-to-black) into an isolated Stage 2 room/rig (`R15b` or `transit_tunnel_rig` at isolated grid coordinates culled from both `R15a` and `R16a`).
     - Inside Stage 2, a stationary matching Train Car cabin sits inside a modular glass-windowed sea-tunnel tube (`~40 m` loop of clean steel tunnel ribs, curved/angled glass panels, exterior abyssal floodlights/beacons). Each frame, the exterior tunnel rings and abyss light fixtures scroll `-Z` (simulating `+Z` forward travel at ~`18–22 m/s`) and wrap seamlessly modulo segment length, fading into deep-teal abyssal fog at both ends (a visible, lit ocean per Decision 8, not black slabs).
     - *Why stationary cabin + scrolling exterior for Stage 2?* Keeps world coordinates bounded near origin, avoids floating-point jitter, prevents `PhysicsWorld` static collider desync, and allows arbitrary ride duration (especially important for Phase 3 VO/dialogue pacing).
   - *Stage 3 (Arrival Glide-In, ~4.5 s)*:
     - Seamless handoff (again preserving Jay's local cabin offset, yaw, and pitch) into Train Car B (`id: "r16a_train"`) inside `R16a`, initially positioned `15 m` north at `z = 20` with `r16a_north` open (`{ gateId: 'r16a_north', open: true, instant: true }`).
     - Train Car B decelerates smoothly `15 m` south (`+Z`) from `z = 20` through `r16a_north` (`z = 30.125`) to its parked dock position at `z = 35`.
     - Once docked: Train Car B opens its west boarding door onto the `R16a` platform, and `r16a_north` closes (`{ gateId: 'r16a_north', open: false }`).

4. **Carrying Jay Smoothly During Stage 1 & Stage 3**
   - *Decision*: During Stage 1 and Stage 3, the ride controller moves the active train prop via `level.setPropTransform(trainId, newPos, Math.PI)` and applies the exact same frame `dz` delta to `player.body.z` (and `player.applyCamera(0)` or `player.translate(0, 0, dz)`), while keeping Jay able to look around (and optionally walk within the cabin, or gently bounded inside the cabin walls).
   - *Why delta-translate `player.body` rather than relying on friction*: `moveBody` uses `CollisionWorld` AABBs without moving-platform velocity inheritance; applying the exact `dz` delta keeps Jay's feet locked to the moving cabin floor with zero slip or wall-snagging.
   - *Reset*: On `level:reset`, `r15a_train` and `r16a_train` restore to their initial parked transforms (`z = 38` and `z = 35`), doors open, and both blast gates seal.

5. **Debug Preview Access**
   - *Decision*: Support `?debug&jump=transit_ride` (places Jay inside `r15a_train` at `r15a_train_inside` and auto-starts the 3-stage ride after load) and a `transit:start_ride` event so `?debug&jump=r15a` can also trigger it on demand.

6. **Car Ride Height, Undercarriage and Rail Clearance**
   - *Decision*: Lift the whole car body (floor, walls, roof, colliders, nav) by a `rideHeight` param on `transit_train_shell` (default about `0.44 m`), leaving the prop origin at track level. Add two visible bogies per car (frame, wheelsets sized to sit on the rail head, axle boxes) and side skirts that stop above the rails, plus a low cyan guide-strip under each skirt so the track bed is lit from the car.
   - *Invariant*: every rail top (`track_bed`, `transit_tunnel_shroud`, `transit_sea_tunnel_rig`) is at least `0.2 m` below the car floor underside; the rails never intersect the car floor, skirts or cabin.
   - *Rails*: use a metallic, low-roughness rail material (not `pal.trim`) so headlight and guide-strip highlights run along them; keep rail height at or below `0.12`.
   - *Boarding consequence*: the platform floors stay at their current height, so the doorway threshold moves up by `rideHeight`. Add a clean boarding step or short ramp piece at each boarding door (`R15a` platform, `R16a` west platform), check it against the player motor's step-up limit, and recompute `r15a_train_inside`, `r16_train_inside` and the `R16a` exit anchors. Parked poses, the open door and walkability from platform to cabin must still hold.
   - *Alternative rejected*: recessing the rails into a track well under a flush car floor. `R15a` and `R16a` floors are cell floor pieces, so a well would need floor cut-outs in both rooms and in the nav mesh.

7. **Boarding Door Pocket**
   - *Decision*: Replace the sliding leaf's travel over the window span with a real pocket: the span `[doorHalf, doorHalf + leafWidth]` on the door side becomes a solid, window-less pocket panel with a thickened wall and a leaf channel inside it. The open leaf is fully contained in that pocket; it never overlaps window glass, mullions, trim posts or the bench back, and bench runs on that side start beyond the pocket.
   - *Closed*: the leaf fills the doorway flush with the wall plane, with the doorway collider unchanged (`doorCollider.setEnabled(progress < 0.65)`).
   - *Check*: a unit test asserts that the open leaf bounds lie inside the pocket bounds and are disjoint from every window glass plane and bench collider.

8. **Shared Lit Abyss Backdrop (replaces the black slabs)** *(SUPERSEDED by Decision 14: the ride tunnel is a closed hallway with no windows, and the backdrop module was removed)*
   - *Decision*: Add one shared abyss backdrop builder used by `transit_sea_tunnel_rig` and `transit_tunnel_shroud`. Nothing outside the car is `m.black` any more; darkness comes from fog and distance, not from unlit slabs. The backdrop provides:
     - Deep teal-blue fog and background tint per ride room (replacing near-black `#030608` / `#060a0e` for the ride stages), with density tuned so the far ends of the tunnel still fade to dark.
     - Marine snow: one `THREE.Points` batch with a procedural round-point shader (no texture), streaking along `-Z` at the ride speed in Stage 2 and static world-space in the Stage 1/3 shrouds, so the car's own motion shows.
     - A seabed plane with rocks and silt below and beside the tunnel, scrolling in Stage 2 like the rings.
     - Lit tunnel ribs, beacon bars with soft light pools on the water and seabed (emissive and additive, no real lights), still respecting `reducedFlashing`.
     - `oceanGlass()` (the material the station's ocean windows use) on the tunnel panes, so the glass reads like the station's.
     - Optionally, fish silhouettes via `createOceanLife` zones if the cost is low.
   - *One tunnel for the whole ride* (user-approved look): the R15a/R16a shrouds and the Stage 2 rig are built from the same `buildBore` cross-section (4.2 m wide, 4.0 m high: dark steel deck, wainscot and roof, ocean-glass band, lit roof strip, lit guide strips and rib bars, polished rails). Stage 2 is that bore in scrolling 6 m segments that fade into the dark at both ends, so the tunnel seen on pull-out runs unchanged through the sea-tunnel and into the R16a glide-in.
   - *Dark water*: the water, seabed and snow are deliberately near-black with only a faint teal tint (the rooms' fog follows), so the lit tunnel is the bright element and the ocean outside reads as deep, dark water.
   - *Snow stays outside*: marine snow never spawns inside the tunnel cross-section, so none drifts through the cabin.
   - *Why not reuse the real exterior*: `R15b` is deliberately excluded from the hull, the exterior is built once around the station's own footprint, and drawing it needs the room in `exteriorRooms`. A self-contained backdrop works identically in `R15a`/`R16a` shrouds and `R15b`, stays near the origin, and keeps the culling and collider rules above unchanged.
   - *Budget*: no new texture samplers; all passes are `ShaderMaterial`/`MeshBasicMaterial` with procedural gradients.

9. **Headlights as real-looking lamps (no raw lights, no cone)**
   - *Decision*: Remove the two `THREE.SpotLight`s and the hollow cone per car. Each headlight becomes:
     - A recessed lens housing with a bright emissive lens and a soft glow sprite or quad (additive, camera-facing, no texture).
     - A short volumetric beam: a tapered mesh with a gradient and Fresnel edge-fade shader (bright at the lens, falling off along its length and toward the edge), whose length and radius stay inside the free bore (`<= 8 m` long, radius at the far end `<= 0.9 m`) so it does not cut walls or the gate shutter.
     - A baked light-pool quad on the track ahead (additive, drawn just above the rail-top plane with `polygonOffset`), moving with the car.
     - Highlights on the metallic rails (Decision 6) and the guide-strip glow under the car.
   - *Behavior*: the beam and pool intensity follow ride state and speed: parking lamps only (lens glow, no beam) while parked or docked, ramping up once the gate opens and the car moves, and fading as the car decelerates into `R16a`, so the beam never meets a wall it would cut.
   - *Optional*: claim a pooled `LightPool` slot for a moving prop. This needs a new hook and is out of scope unless the unlit approach does not read well.
   - *Alternative rejected*: keeping raw spotlights. They change the light count with room visibility and force shader recompiles.

9a. **Clear Bore at the Blast Gates and No Shafts Through Cars**
   - The blast-gate piece's dark alcove is an open sleeve (sides, top, bottom) with no back plate or crossbars, so nothing static crosses the bore in front of a moving car. A unit test checks that no non-shutter gate mesh intersects the bore box.
   - A car's own cabin light slots were unclaimed in the level data, so `Level` merged a static dead fixture for each, left floating where the car was parked. `Level` no longer does that for a slot that belongs to a movable prop; Decision 11 makes those slots real, claimed, moving lights.
   - The room-ceiling light shafts over the parked cars (R15a slots 4 and 7, R16a slot 4, R15b slot 1) are switched off with `shaft: 0`: a shaft is a hard-edged volume that hung through the car roof, and the lifted camera sat inside it. A level test checks that no shaft crosses a car or its path.

10. **Ride State and Speed Events for Visual Effects**
    - *Decision*: The beam, pool and snow read the existing `transit:ride_state` and an extended `transit:tunnel_scroll` payload (`speed`) plus a per-car speed value the controller publishes during Stage 1 and Stage 3, instead of polling controller internals. Defaults make the effects safe when the controller is absent (parked, beam off).

11. **Car-Owned Cabin Lights (the cabin must be visible end to end)**
    - *Finding (third playtest)*: standing at one end of the cabin and looking at the other, the far end is pitch black. The cabin is lit only by pooled room ceiling lights (ceiling slots: range 10 m, mounted 4.9 m up outside the roof, sparse over the track), and the car's own two light slots are unclaimed, so they light nothing. In the tunnel there are no room lights at all, so the cabin is dark for the whole ride.
    - *Decision*: claim the car's two cabin slots in each ride room's `lights` (R15a, R16a, R15b), with ids (`r15a_train_cabin_a` etc.), a cold teal-white colour, a modest intensity and a range that covers the whole 10.4 m cabin from either slot (about 6-7 m), `shaft: 0` and no shadow. They use two slots of the existing fixed pool, so no scene lights are added; the pool's nearest-first ranking keeps them assigned while Jay is in the car.
    - *They move with the car*: slots that belong to a movable prop (`RawSlot.owner`) register their glow mesh, any shaft and pooled-light position with that prop, and `Level.setPropTransform` shifts them by the prop's offset from its built position (translation only; the car never turns). `level:reset` already restores the prop, so it restores the lights.
    - *Mood, not full bright*: the wash is cold and dim enough that the far end reads but the cabin still feels underground. A faint teal emissive fill on the cabin's inner surfaces (a car-only material, not the shared palette) keeps shapes readable if the pool is busy, and the roof LED strip is lowered so it no longer blows out close to the camera.
    - *Power cut later*: the cabin lights have ids, so a scripted power cut at the end of the ride (deferred to the scripting phase) is a single named-light call. It is not part of this change.
    - *Alternative rejected*: a free `PointLight` per car, which changes the light count (Decision 9). Also rejected: brightening the room fixtures, which would flood the stations.

12. **Attached Parts Move Relative to Their Parent**
    - *Finding*: `Level.integrate` attaches a piece's dynamic children to the room group and keeps their world transform, so a child's `position` is a world position. The sea-tunnel rig's tick then overwrote each ring's `position.z` with a relative value (rings at world z -27..27 while the rig stands at z = 40), so Stage 2 had no tunnel and showed only water, snow and seabed. The blast-gate shutter's `position.y` has the same flaw: in R16a (floor -0.6) a sealed shutter sits 0.6 m too high.
    - *Decision*: any dynamic part that is moved at runtime lives under its own root group created in the piece and is moved relative to that root. The rig parents its rings under one `sea_tunnel_rig_root`; the shutter and gate lamps are moved from their base position, not overwritten. Tests read world positions (`updateMatrixWorld`, `getWorldPosition`) after `Level` places the piece, not just local ones, so this class of bug is caught.

13. **One Continuous Tunnel With Ocean Passing Outside the Glass** *(SUPERSEDED by Decision 14: the fish looked cartoonish, so the tunnel is a lit hallway and nothing is shown outside it)*
    - *Decision*: Stage 2 is the same lit bore as the shrouds, at the car (Decisions 8 and 12), for the whole ride, so the player never sees open water or an ocean floor ahead. The tunnel's lit steel, roof strip, guide bars and rib bars stay the bright element.
    - *Ocean passing by*: outside the glass the water stays dark, and things drift past it: fish silhouettes and rocks that catch the tunnel's glow (soft additive light pools on the water and seabed beside the bore, no scene lights), and now and then a large silhouette (a pylon, cables, a wreck) that is lit only where the tunnel's glow reaches it. Everything outside the bore scrolls with the rest of Stage 2 and stays static in the shrouds, so the car's own motion shows there. `reducedFlashing` suppresses any pulsing.
    - *Budget*: unlit or additive shader meshes and instanced geometry only; no new samplers or scene lights.

14. **The Ride Tunnel Is One Closed, Lit Hallway (no windows, fake black fog)**
    - *Decision (user)*: remove the ocean entirely. The shrouds and the Stage 2 rig share one `buildBore` hallway: dark steel deck and roof, textured wall panels (a palette wall material with a faint cold emissive fill) between lit rib bars, a lit roof strip, lit guide strips, a seam every metre so speed reads against it, and polished rails. No glass, no water, no seabed, no snow, no fish; the `abyssBackdrop` module and the ocean-glass export are gone.
    - *Fake black fog* (`hallFog`): a few transparent black planes across the bore thicken to solid black at each open end (R15a's shroud south end, R16a's shroud north end, both ends of the rig), so the player never sees the hard edge of the hallway ahead or the wrap-around of the rings. They start at least 5.9 m from the car at its nearest, so they never cut through a car.
    - *Why*: windows made the tunnel look like a tube in open water; a closed hallway matches the departure tunnel the player likes, and removes a lot of overdraw (shell, seabed, glass, additive snow and fish) in front of the camera.

15. **A Smooth Approach: Slow Early, Closed Gate Ahead, Lift After the Cut**
    - *Findings (fourth playtest)*: at the end of Stage 2 the hand-off to R16a popped a gate into view, the shutter was still rising when the nose reached it (1.8 s open, nose at about 1.7 s), it clipped the car roof, and its collider pushed the player back.
    - *Slow early*: the Stage 2 scroll cruises at 20 m/s, then slows linearly (at most 4 s, never more than 60% of Stage 2) to exactly `GLIDE_START_SPEED` (5 m/s), which is the start speed of the Stage 3 glide (ease-out over 15 m in 9 s). The pull-out is 14 m (the tail clears the gate at 11 m) so the fog at the shroud end stays ahead of the nose.
    - *A closed gate comes to the car*: the rig builds a real `transit_blast_gate` (the same piece as R16a's, so it looks identical) under a holder. During the slow-down the controller arms it (`transit:rig_gate`) when the hallway still has `RIG_GATE_START_Z - RIG_GATE_FINAL_Z` = 16.875 m to travel; it rides the scroll out of the fog and stops exactly 10.125 m ahead of the car, which is where R16a's closed north gate is from the Stage 3 start car position. The hand-off then cuts between two identical views.
    - *Lift after the cut*: R16a's gate is sealed at the hand-off and lifts 0.1 s later (once R16a is rendered), in 0.8 s (a `seconds` field on `transit:blast_gate`; the default stays 1.8 s), so it is fully open before the nose arrives (about 1.3 s) and before a player standing at the front reaches it (about 1.5 s). The shutter travels 0.1 m past the bore top (3.55 m, a 0.25 m margin over the 3.3 m roof).
    - *Easy to see*: the shutter leaves are a bright, lightly self-lit finish with hazard bands, and the signal aspect is repeated on the tunnel side (side lamps and a lit lintel bar) that turns green when open.

## Risks / Trade-offs

- **Risk**: Raising the car by `rideHeight` changes the boarding threshold and every cabin anchor, and may exceed the player's step-up limit. -> **Mitigation**: Add a boarding step or ramp, recompute anchors from the car's origin, and keep the existing `transit.test.ts` and `slice01.test.ts` walkability checks passing.
- **Risk**: A self-contained abyss backdrop adds draw cost on top of the ride room. -> **Mitigation**: One `Points` batch, one seabed mesh, instanced ribs and beacons; no new lights or samplers; measure in `?slot=scratch&memprobe` and keep it within the existing transit-room budget.
- **Risk**: The car-owned lights fight for pool slots with room fixtures, or leave the cabin too bright for the later power cut. -> **Mitigation**: two slots only, nearest-first ranking, a cold dim default, and a test that the cabin's far end is lit from either end.
- **Risk**: A short beam inside the station room could still graze the sealed gate before it opens. -> **Mitigation**: Beam off at rest and ramped only after the gate opens.

- **Risk**: `R15a` south wall / hull exterior behind `r15a_south` or `R16a` north wall behind `r16a_north` might show exterior ocean dome or hull geometry when the train is outside the room bounds during Stage 1/Stage 3. → **Mitigation**: Add a clean dark sea-tunnel extension shroud (`z = 46..64` south of `R15a`, `z = 14..30` north of `R16a`) so the train is always enclosed in a dark windowed/ribbed sea-tunnel bore during pull-out and glide-in.
- **Risk**: Seamless handoff between Stage 1 -> Stage 2 -> Stage 3 could show a single-frame flash if room visibility culling lags by 1 frame. → **Mitigation**: Update `player.body` and trigger room visibility/culling synchronously in the same tick, and ensure all three cabin interiors have identical dimensions, lighting, and local coordinates so the interior frame is pixel-consistent across handoffs.
- **Risk**: Existing `slice01.test.ts` and `transit.test.ts` expect `r15a_train_inside` and `r16_train_inside` to be walkable at their default parked positions. → **Mitigation**: Default parked poses and open boarding doors remain unchanged at level start and on `level:reset`.

# Design

## Context

See `proposal.md` for the motivation. This is the current state the design works from:

- **Geometry.** Every room floor in `slice01.json` sits at deck level (one deck, `cell[1] = 0`), and nothing lies
  under R09. R09 is an L of seven cells: (2..4, 11) and then (4..7, 12). R10 is 2x2 at (8..9, 12..13). The kit
  `stairs` piece exists (it rises toward -Z over a 3.6 m run, with `rise` and `steps` params) but no level uses it.
- **Water.** Today's water is seven `water_surface` props in R09 only. Each is an unlit `ShaderMaterial` plane at 0.45 m
  over a dry floor, plus a 1 mm `water` surface box for footsteps. Wading is a binary surface tag: 0.6x speed, no
  sprint and no jump (`src/actors/player.ts`). Water footsteps are concrete steps low-passed at 950 Hz.
- **Script.** The `water { level, s, wait }` step and its skip end state exist in `src/script/actions.ts`, but
  `host.water` has no implementation. `playerControl`, `playerFrame`, `npcMoveTo instant`, `doorState`, `lightState`,
  `cameraShake` and the automatic letterbox bars (`CutsceneController.barsOn`) already cover most of the cutscene.
  `skippable` is a fixed per-sequence boolean. `lightState` changes every light in a room.
- **Shader patching.** The game already patches built-in materials with `onBeforeCompile`: the merged level materials
  (`src/world/kit/merge.ts`), the character body material (`src/actors/bodyMaterial.ts`), exterior lighting and the
  viewmodel. No scene colour or depth texture is available to materials today.
- **Neighbouring changes.**
  - `upgrade-three-and-post-chain` (0/15) is about to replace the post chain with pmndrs `postprocessing`.
  - `fidelity-first-rendering` sizes the fill-light pool per tier (Low 12, Medium 16, High 32).
  - `adopt-physics-engine` owns dynamic bodies.

## Goals / Non-Goals

**Goals:**
- Water that reads as real on the High tier on the desktop PC and stays convincing on Low.
- Every water behaviour driven from one water body per room, so the level, wading depth, surface, reflections and murk
  can never disagree, including while the level animates.
- The flood cutscene built from existing sequence steps wherever one exists.

**Non-Goals:**
- A volumetric fluid simulation. Water never spills, pours down stairs as a volume, or piles up.
- Swimming or an underwater view. The camera never goes below the surface.
- Hands gripping the valve wheel. First person shows the wheel turning with the weapon holstered.
- Floating debris that moves physically. Junk bobs in the shader until `adopt-physics-engine` Block 5 lands.

## Decisions

### D1. A water body per room, not per prop
Level data gains an optional `water` block on a room, `{ level, floor? }`. It covers the room's whole floor footprint
up to its walls, replacing the seven `water_surface` props, which are deleted. One `WaterBody` object per room owns:
- the current level and an animation toward a target level
- the footprint mask of solid cells and walls
- the ripple simulation
- the surface mesh
- a depth query `depthAt(x, z)`, the level minus the floor height under that point

Movement, audio, splashes, gore and the murk all read from that one object.

*Alternative considered:* keep tiled `water_surface` props. Seams between tiles break a ripple simulation and planar
reflection, and nothing would own the water level.

### D2. Sunken floors as a room parameter
Rooms gain `floorY` (default 0). Floor tiles of that room build at `floorY`, and wall tiles extend from `floorY` up to
the ceiling, so there is no seam at deck level. Stairs are ordinary pieces placed at cell positions with `rise: 1.2`
(five steps of 0.24 m, under the 0.35 m step height). Landings are a new short `floor_landing` piece at deck level,
spanning the door end of the stair cell. Doors stay at deck level.

Spawns, anchors, pickups and props in level data keep authored world `y`. The level loader's validation fails a
placement that sits more than 0.05 m off the walkable surface below it, which catches anything still authored at
`y = 0` inside R09.

*Alternative considered:* move R09 down a whole deck (`cell[1] = -1`). The 4 m drop would need two stair cells at each
end, shrink the sump to three cells and make a 7 m-tall tunnel.

**R09 cell plan:**

```
 x=   2        3        4        5        6        7
 z=11 [stair v][sump   ][sump   ]
 z=12                   [sump   ][sump   ][sump   ][stair ^]--> D_R09_R10 (porthole)
      ^ landing + D_R07_R09                         ^ landing
```

- **Stair rotation:** `stairs` rises toward -Z, so the first stair cell is rotated to fall eastward and the last to rise
  eastward. Each landing is the 0.4 m of the stair cell nearest its door.
- **Water level:** 0.45 m below deck level (`y = -0.45`) over the 1.2 m-deep sump floor (`y = -1.2`), so 0.75 m deep.
  The waterline crosses the third step from the bottom of each stair.
- **Jump reach:** the sump floor is 1.2 m below the landings, more than the 1.0 m jump reach, so Jay can't climb out over
  a landing edge.

### D3. Water shading on the built-in standard material
The surface is a `MeshStandardMaterial` (roughness about 0.04, metalness 0, dark tinted albedo) patched with
`onBeforeCompile` to:
- **Normals:** build them from the ripple height texture plus two scrolling detail normal maps.
- **Reflection:** add the planar reflection texture (D4), weighted by Schlick Fresnel.
- **Depth tint:** fade toward the water colour by depth through the surface.

Building on the standard material means the pooled fill lights, shadow lights, the flashlight, light patterns and tints
all light the water with no new code path, so a flickering tube's highlight goes dark with it. The patch touches the
same chunks as today's patches, which `upgrade-three-and-post-chain` already checks against r187.

*Alternative considered:* keep a custom unlit `ShaderMaterial` and feed it the light list by hand. That duplicates
three.js lighting, and it misses the light pool and the flashlight.

### D4. Planar reflection, tiered
A mirrored camera renders the scene into a render target reflected about the water plane. It uses an oblique clip at
the surface, and the water mesh, the viewmodel and particles are excluded.

| Tier | Reflection target | Notes |
| --- | --- | --- |
| High | Half the drawing-buffer resolution | Full scene |
| Medium | Quarter resolution | Full scene |
| Low | None | Fresnel blend toward the room's fog colour, plus the lit highlights (D3) |

The pass runs only when a water body is in a visible room (`room-visibility`) and the camera is above its plane. It is
done once per frame for all water at the same height. The ripple normals offset the reflection lookup, so the wakes
bend the reflected tubes.

*Alternatives considered:*
- **Screen-space reflections:** they lose ceiling fixtures whenever those are off-screen, which is most of the time
  when looking along a tunnel.
- **A cube map:** it can't show the flicker or nearby people.

### D5. Murk without a depth texture
The depth tint is computed in the material of whatever sits under the water, not by reading a depth buffer. The level
(merged kit) materials and character body materials get a small patch to their fog step: if a fragment is inside a
water body's box and below its level, the view ray's length under the surface is
`d * (level - y_frag) / (y_cam - y_frag)` for a camera above the water. The fragment then mixes toward the water colour
by `1 - exp(-absorb * length)`. Water bodies are passed as a small uniform array (at most 4, with box and level each).

This works on every tier, now, without waiting for `upgrade-three-and-post-chain`. Refraction (bending what's under the
water) does need the scene colour, so it is a High-tier layer built on the new post chain's input buffer once that
change lands. Until then the surface uses only murk and Fresnel. The `standing-water` spec's refraction clause is met
when that layer lands; tasks order it last.

*Alternative considered:* depth-texture murk in the water shader alone. It needs a depth pre-pass we don't have, and it
would block the whole water look on the post-chain change.

### D6. Ripple simulation on the GPU
Each water body runs a height-field wave equation in a ping-pong pair of float render targets covering its footprint's
bounding box. For R09 that is 512x256 at about 5 cm per texel. The simulation:
- **Steps** at a fixed 60 Hz with damping.
- **Masks walls** from the footprint (solid cells and stair edges become reflecting boundaries).
- **Takes disturbances** as up to 64 stamps a frame, each a position, radius and strength:
  - feet: from footstep events, with strength by gait and depth
  - legs: a moving stamp per wading body every step (the wake)
  - bullets: from impact events
  - bodies, severed parts and debris landing
  - drips and the pouring pipe: authored emitters
- **Shudders** the whole field once (a low-amplitude noise stamp) on `cameraShake`.

Cost is two full-target passes per step, which is negligible against the reflection pass. The simulation sleeps (no
passes) while the room is not visible and resumes from a flat field.

*Alternative considered:* a pool of analytic rings in the shader. It's cheaper, but the rings don't reflect off walls,
cross or form wakes, and that is most of the realism.

### D7. Splashes, blood and wetness
- **Splashes:** one GPU `Points` system per water body, in the same style as the steam wisps in `slice.ts`, with burst
  presets: step, takeoff, landing (scaled by fall height), bullet, body. Each burst also stamps the simulation and plays
  its sound.
- **Blood:** `GoreSystem` asks the water body before laying a floor pool. Under water, it spawns a soft billboard cloud
  just below the surface that grows and fades over about 20 s.
- **Wetness:** the body material gets a `uWetLine` uniform per actor. It rises to the deepest point the water has
  reached on that body and falls back at about 1 cm/s once the body is out of the water. Below the line, albedo darkens
  and roughness drops.

### D8. Movement in water
`player.ts` replaces the binary `wading` with `depth = water.depthAt(x, z)` (0 when dry).

| Behaviour | Rule |
| --- | --- |
| Speed scale | `lerp(1, 0.5, smoothstep(0.1, 0.7, depth))` |
| Acceleration and deceleration | Scaled by the same factor, so starting and stopping feel heavier |
| Sprint | Blocked above 0.45 m |
| Jump | Allowed in water: takeoff speed scaled so the motor's air step still mounts 0.90 m tops from the floor under the water. The motor's `jumpReach` is set per jump to 0.90 instead of 1.00. A 0.35 s recovery after landing in water blocks the next jump |
| Downed eye height | `max(downedEyeHeight, depth + 0.12)` above the floor |

The new jump rules apply to Jay only. NPCs keep their existing wade scaling from the surface tag, which the water body
still writes.

### D9. The flood cutscene
`valve_turn` in `action_tunnel.json` is rewritten. Its trigger stays `valve:r10_main`. The shot list (times
approximate):

| t (s) | Steps |
| --- | --- |
| 0 | `playerControl` (locked move and look, no weapons or interact); `playerFrame` on the wheel; `npcMoveTo instant whenUnseen` for Giles and Okafor to new anchors `r10_flood_giles` and `r10_flood_okafor` behind the wheel's view; `despawnGroup r09_tunnel`; `spawn` the scripted shambler at `r09_flood_shambler` |
| 0.5 | Wheel spin, existing sounds |
| 3.5 | `cameraShake`, `sfx hullGroan`, pumps start (prop event) |
| 4.5 | New single-light step on the beacon (alarm, emergency); klaxon `sfx` |
| 5.5 | `playerFrame` to the door and overlook (1.2 s ease); Okafor's line |
| 7.0 | `water { room: R09, level: 0.05, s: 3.5 }`; shambler `npcMoveTo` the top landing |
| 9.5 | Shambler dragged under (D10) |
| 10.5 | `doorState D_R09_R10 sealed`; door slam; `water { room: R09, level: 2.2, s: 2 }` |
| 11.5 | `playerFrame` on the porthole; hand-slap beat (D10) |
| 13.0 | Valve lines; flags; `checkpoint cp_valve`; control released |

The water first rises to `y = 0.05`, just above the top landing (deck level, `y = 0`), which is when the door seals.
Behind the sealed door it keeps rising to `y = 2.2`, above the porthole (centre about 1.6 m), so the last shot shows
water against the glass. The flooded level that checkpoints restore is 2.2.

New pieces:
- **`water` gains a `room` field.** The host implements it on the water body (D1). The existing skip handler already
  snaps to the target level.
- **New `light` step:** `{ do: "light", id, pattern, tint }` switches one named room light. Room lights gain an
  optional `id` in level data, and the beacon is a claimed `emergency` slot on the `emergency_beacon` prop.
- **Skippable only once watched:** sequences gain `skippableAfter: "<flag>"`. The sequence is skippable only when that
  flag is set. The flag is kept in a new save-level `seen` list, which checkpoint restores never roll back, so a player
  who restores an earlier checkpoint can skip a cutscene they've already watched. Skipping applies the end state from
  the steps' existing skip handlers, plus the shambler's despawn and the beacon.
- **The R09–R10 door gets the porthole** variant of `pressure_slide` (`level-kit` spec).

### D10. The shambler beat
The shambler is a normal enemy spawned as a named actor with AI off, driven by `npcMoveTo` and `npcAnim`. Whether
`spawn` and `npcMoveTo` can drive an enemy as well as a squadmate is the first thing to check (task 8.1). If they can't,
the fallback is a small `enemyScript` hook, using the existing `runHook` step.

The beat has two parts:
- **Dragged under:** when the water passes its chest, it plays a flail clip and sinks. The water body's splash and
  stamps sell it.
- **The slap:** a separate prop, a hand-and-forearm mesh skinned from the shambler body, animates against the inside of
  the porthole glass, slides down and fades into the murk. It is a prop and not the actor, because the porthole shot
  needs exact framing and the actor would be under the simulated water.

### D11. Lights in R09
- **The `failing` pattern:** a seeded state machine in `patternValue`. It holds on for 3 to 8 s, stutters for 2 to 4
  blinks of at least 0.34 s each, and goes dark for 1 to 4 s about a third of the time. It never exceeds three changes
  per second, so `reducedFlashing` doesn't alter it.
- **Budget:** R09 claims at most 6 pooled lights. The rest of the tubes are glow-only (`pool: false`), which keeps
  R09 plus the visible R07 or R10 under Low's 12.
- **Sparks:** reuse the existing `zap` sound synced to a flicker light's level. Spark particles use the splash `Points`
  system with a gravity preset, and a hiss and a small stamp play where they cross the water.
- **The swinging tube:** a kit prop with a pendulum `tick`, and its claimed slot follows the swing.

### D12. Sound sourcing
New sounds are found in this order:
1. CC0
2. CC BY, credited
3. Royalty-free game packs (the Sonniss GDC bundles)
4. ElevenLabs, for what's missing

NC and SA licences are rejected. Every clip from outside the project gets a `CREDITS.md` row with author, link and
licence. `docs/audio-assets.md` section 1 is updated to name this order. Candidates found during exploration:

| Sound | Candidate | Licence |
| --- | --- | --- |
| Splashes and water loops | rubberduck's 40 CC0 water/splash pack (OpenGameArt); "6 short water splashes" | CC0 |
| Sparks | craigsmith "Sparks from Panel" (Freesound) | CC0 |
| Fluorescent strike and buzz | Freesound 232446 | CC0 |
| Wading at three depths | Freesound 127610 | CC BY 4.0 |
| Knee-deep wading | Sonniss bundles | Royalty-free |

Each licence is re-checked on the clip's own page at download time. All new clips are loudness-matched and played
through the `flooded` reverb.

### D13. Timing off events, the elite, and the pry (playtest round 2)
This supersedes D9's times and D10. Playtest found the lines and the music out of step with the slam. Lines queue one at
a time on the `local` speech lane, so the fixed waits had "Seal it now!" start about 4.5 s after the door sealed. The
10 s `floodStinger` dipped while the door shut and then left about 9 s of silence.

**The charge and the seal are timed off the lines, not off fixed waits.** Two branches run in parallel after the
alarm:

| Branch | Steps |
| --- | --- |
| Lines | Okafor's "Something's coming up the stairs!" (wait) -> "Seal it now!" -> `doorState sealed` half a second in -> the slam-hit stinger and slam fire on the same step (both hit 0.9 s in, when the leaves meet) |
| Charge | the view turns to the door -> a beat -> the shriek and the charge, at a speed that reaches the top landing just after the leaves meet |

- **Giles's "Don't let go of that wheel"** no longer plays. By then the wheel has turned and the view is on the door.
- **After the seal,** the two pounds land with the music still playing. Control comes back before Giles's "Is it
  gone?", so the line plays while the player can look around.

**Music.** The score keeps going through the whole beat. The Lab B adaptive score (`labB`) is loaded at the valve and
cued through four new cues:
- `floodAlarm` (drone, fast heart, pulse) at the beacon.
- `floodCharge` (adds the rise, voice and brutal layers) at the shriek.
- `floodHold` (drone, fast heart, hold) at the slam.
- `floodOut` (a slow fade and release) after the last line.

None of the cue names contains a colon, so the bus's `flood:klaxon` event (also fired on every load after the valve)
never cues the score. The single hit is a new ElevenLabs one-shot, `floodSlamHit`: a short rise into one impact, trimmed
so the impact sits at 0.9 s. It replaces `floodStinger`.

**The creature is the elite.** A cast look `flood_elite` uses the hero-tier body (`necromorph`, the slasher with blade
arms). Both the valve charge and the R11 burst-back spawn it. It's deliberately the same body as the Lab B creature and
the R11 climax elite. Its extra small hands stay still.

**The pry.** The R11 burst-back no longer just opens the door:
1. The elite's blades stab into the seam (`pry_reach`).
2. They clamp together (`pry_clamp`).
3. They wrench the leaves apart from the middle (`pry_wrench`), while a new `doorPry` step forces the sealed door part
   of the way open.
4. The door slams back from there and shears both forearms (`npcSever`). It stands at `r09_flood_door`, close enough
   for the blades to reach the seam. The leaves part to 0.3, a gap of about 0.4 m.

`doorPry { id, open, s }` drives a door's leaves to `open` (0 to 1) over `s` seconds without changing its state. A
sealed door stays sealed and its screen stays red. The door's collider stays on below 0.6 open, as for any door. The next
`doorState` drops the forced opening, so `sealed` closes from wherever the leaves are. Skipping snaps the leaves to
`open`. A new `doorPry` sound (metal leaves forced apart, hydraulics straining) plays with the wrench.

## Risks / Trade-offs

- **[The reflection pass doubles scene cost in R09 on High]** → Half resolution, only when water is visible, and
  particles excluded. Measure against the 30 fps (1% low) floor on the desktop PC with `?slot=scratch&memprobe`, and
  fall back to quarter resolution on High if needed.
- **[Murk patched into the shared level and body shaders could affect every room]** → The patch is a no-op branch
  when no water body uniform is active. Shaders compile once per tier, as today. Screenshot checks of a dry room before
  and after.
- **[Sunken floors break code that assumes y = 0]** (corpse poses, blood pools, enemy floor spawns, squad gathering,
  foot IK) → The loader validation in D2, plus a level test that walks the squad and an enemy from R07 to R10 on the
  navmesh. Gore already uses `floorY(x, z)`.
- **[The scripted shambler may not be drivable by existing steps]** → It's checked first (task 8.1), with the
  `runHook` fallback.
- **[Refraction waits on another change]** → Murk, reflection and ripples ship first and carry the look. Refraction is
  a separate, last task, with its spec clause noted.
- **[Mixed-source audio may sound mismatched]** → Loudness matching, the shared reverb and a listening pass in R09.
- **[Ripple float targets on weaker GPUs]** → Use half-float targets. If they aren't supported, fall back to the
  analytic ring pool on Low.

## Migration Plan

- **Checkpoints:** `cp_flooded` moves to the R07-side landing (`y = 0`), still facing into the tunnel. Saves made at
  the old position still load, because restore places Jay at the checkpoint's current anchor.
- **Old saves:** saves written before this change have no water levels recorded. On restore, a missing water level
  means the room's authored level, unless `valve_done` is set, in which case R09 is restored flooded.
- **Debug jump:** the `r09` target in `src/main.ts` keeps working. A new `r10_flood` jump starts just before the valve.

## Open Questions

- The exact wording of Okafor's "move" line and the reaction after the slap. These are written with the voice pass and
  don't change any step.
- The ambience preset for R10 after the flood (the existing `pipes_knock`, or a new muffled-water bed). Chosen during
  the listening pass.

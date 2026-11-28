# Design

## Context

See proposal.md for why. Current state, as of 07d0569:

- `session.ts` builds one environment at startup: `PMREMGenerator.fromScene(new RoomEnvironment(), 0.04)`, assigned to `scene.environment` with `environmentIntensity = 0.12`. Every `MeshStandardMaterial` and `MeshPhysicalMaterial` without its own `envMap` uses it. Glass sets `envMapIntensity: 2`. Kit materials are shared across rooms, with some cloned by `kit/merge.ts`.
- Ambient is a `HemisphereLight` plus a non-shadowing `DirectionalLight` key fill (`level.ts`). Each frame they lerp toward the current room's preset (`AMBIENT`, or `BACKUP_AMBIENT` under backup power). Scripted recolours (`emergency`) change `room.ambient`.
- `Level.renderFromEye(eye, draw)` already renders the level from another viewpoint before the main update: cull, bind lights unshadowed, draw. Security camera feeds use it.
- The post chain (`post.ts`) is pmndrs `postprocessing` 6.39.6: AO passes, then one `GradePass` that merges bloom, the custom grade `Effect` and `ToneMappingEffect(ACES_FILMIC)`, then SMAA. It runs on every tier, because the grade applies on Low too. The renderer's own tone mapping is off, and the grade honours `toneMappingExposure`.
- three's program key includes `numLightProbes`, so adding a light probe recompiles once. It must be added once at level build, not toggled.

## Goals / Non-Goals

**Goals:**
- Room-specific reflections and bounce light, refreshed when a room's lighting state changes, at bounded memory and no hitches.
- Eye adaptation that strengthens the blackout and room transitions without making dark rooms readable without the flashlight.

**Non-Goals:**
- Box-projected (parallax-corrected) reflections. Captures are taken from one point, so large rooms show some parallax error. That is accepted for rough metal and floors.
- A separate capture per visible room, for surfaces seen through glass. Everything uses the camera's room (see D3).
- Characters lit by the probe of the room they stand in. All visible characters use the camera's room probe.
- Reflections of characters or the player. Captures exclude them.
- Reflections in security camera feeds; feeds use the player's current room environment.

## Decisions

### D1. Capture with `renderFromEye`, one cube face per frame

A new `RoomCaptures` module, owned by the level, captures a room into a 128 px `WebGLCubeRenderTarget` with a `CubeCamera`. The capture point is the room's optional `atmosphere.capture` point (`vec3`, validated inside the room's area), or else the room's area centre at 1.6 m.

Each face renders inside `renderFromEye(capturePoint, …)`:
- the room and what is visible from it through portals (so the gallery's capture includes Lab B through the glass);
- its lights bound unshadowed;
- characters, the viewmodel, gore and particles hidden, via a capture layer the camera excludes.

One face is rendered per frame, before the main update, as with camera feeds. On the seventh frame `PMREMGenerator.fromCubemap` filters it.

Total cost is spread across 7 frames. Captures run one room at a time, from a priority queue.

*Alternatives:* `pmrem.fromScene` renders all 6 faces plus the filter in one frame (a visible hitch in heavy rooms); baking captures offline (stale under power and alarm states, and adds a build step).

### D2. Lighting state, steady patterns and recapture

Each room keeps a `lightingVersion`, bumped by:
- station power changes;
- scripted recolour and tint (`emergency` and back);
- a claimed light switching `off` or on.

Swaying lamps from `shadow-rich-rooms` do not bump it: sway is motion, not lighting state.

A capture records the version it saw. The queue holds, in priority order:
1. the camera's room if it is uncaptured or stale;
2. rooms adjacent through open or see-through portals if uncaptured or stale;
3. nothing else.

So stale rooms the player is not near are left until approached. That satisfies "within 2 s" with 7-frame captures.

During a capture, lights evaluate their pattern at its steady value (no flicker or pulse phase), so a flicker never shows in a capture and never bumps the version.

### D3. Cross-fade by blending two filtered maps

`scene.environment` points at the current room's PMREM texture. On a room change, a small `ShaderMaterial` quad blends the old and new PMREM textures into a third render target with the same `CubeUVReflectionMapping` layout and size, over 0.5 s, and `scene.environment` points at that target during the fade. Afterwards it points at the new room's texture again. All captures are the same size, so the layouts match texel for texel.

An uncaptured destination keeps the old room's environment until its capture lands, then fades in.

*Alternatives:* a dip of `environmentIntensity` through zero (a visible pulse); per-room material clones with their own `envMap` (multiplies materials, and kit materials are shared).

### D4. Bounded cache

Up to 8 captures are kept, least-recently-current evicted, at about 2 MB each at 128 px with mips: 16 MB total, plus the blend target. The current room and its portal neighbours are never evicted. Leaving the level or returning to the title disposes all of them (`runtime-memory`). The exact figure is measured and recorded in task 5.2. It is the spec's "bound recorded in the design".

**Recorded bound (task 6.1, 2026-11-22):** about **43 MB** of GPU memory for room lighting: 8 filtered captures at
~4.2 MB each (three r187 PMREMs are 256 px cubes with 6 mips, not 128 px; see Implementation notes), the blend
target (4.2 MB), the PMREM generator's source cube (4.2 MB) and the 128 px raw capture (1 MB). Measured under
`?memprobe` over two full loops of the slice's 30 rooms at High: GL texture bytes, textures and framebuffers were
identical after loop 1 and loop 2 (1561 MB, 513, 421), the cache held at 8, and five new captures added 22 MB
(4.4 MB each). Quit to title disposed all 7 live captures and GL textures fell to 0.
Frame rate when first entering an uncaptured room (fresh page, walking Commons → R03 → Commons → R14a at High):
1% lows of 29.9 and 37.3 fps over two runs. The one slow frame (117 ms) is R03's first draw as its door opens,
which costs 100 ms with captures switched off too. The machine was shared with other agents, and a captures-off
run hit 1.5 s stalls with nothing of this change running, so these figures are noisy.

### D5. Bounce light: one light probe, normalised to the preset

The level adds one `LightProbe` at build time, so the program count is fixed. Each capture also produces 9 spherical-harmonic coefficients: the cube target is downsampled to 16 px per face, read with `readRenderTargetPixelsAsync` (no stall), and projected on the CPU using the same math as three's `LightProbeGenerator`.

Coefficients are normalised so the probe's average irradiance (the L0 term's luminance) equals `w × preset.intensity`. The hemisphere then runs at `(1 − w) × preset.intensity`. `w` starts at 0.6.

The probe therefore gives direction and colour while the authored preset keeps the overall level. The spec's tolerance is the combined ambient average within ±10% of the preset. Each frame the probe lerps toward the current room's coefficients at the same rate as the hemisphere.

Under backup power or a recolour, the recapture (D2) changes the coefficients' colour and direction. The normalisation uses the active preset (`BACKUP_AMBIENT` or the recoloured `room.ambient`), so strengths stay as authored.

### D6. Eye adaptation in the post chain

Measurement stage:
- `LuminancePass` from `postprocessing` writes scene luminance to a mipmapped target at about 1/4 resolution, before bloom, on the HDR colour.
- A small custom pass samples a centre-weighted average of log luminance from a low mip into a 1×1 target. It applies two filters in sequence, ping-ponging between 1×1 targets:
  1. a fast low-pass (time constant about 0.3 s), which rejects flashes under 0.25 s;
  2. an asymmetric adaptation: about 3 s towards darker views (eyes opening), about 1 s towards brighter.
- `postprocessing`'s `AdaptiveLuminancePass` has a single rate, so it is not used.

The grade `Effect` samples the 1×1 result and multiplies colour by `clamp(key / adapted, 0.7, 1.6)` before tone mapping.

`key` is calibrated so the Commons and R03 at High resolve to a multiplier of about 1.0. They keep today's tuned look, and adaptation only shows in rooms that are clearly darker or brighter. The upper cap of 1.6 keeps backup-power rooms dark (spec "Into a dark room").

The "Eye adaptation" setting off forces the multiplier to 1.0. Toggling it never rebuilds the chain; the uniform alone switches.

*Alternatives:* `ToneMappingEffect`'s `REINHARD2_ADAPTIVE` would replace ACES and change the game's look. Reading luminance back to the CPU would stall the GPU or lag by frames.

### D7. Station level only

`session.ts` keeps creating the generic environment for the lab world and the sandboxes. The station level sets `scene.environment` from its captures once the first capture lands, and uses the generic one until then (a cold start).

## Risks / Trade-offs

- [Single-point captures show parallax errors in large rooms, such as the Launch Hall] → Rough materials hide it. An authored `atmosphere.capture` point lets a room move its capture point. Box projection is a later change if needed.
- [A capture lit by the camera room's bound fill pool may miss lights the pool can't hold] → Captures bind around the capture point with the room as current room, so its own lights come first. Rooms with more claimed lights than the pool holds show some unlit fixtures in reflections. The overlay from `shadow-rich-rooms`, if landed, shows this.
- [Probe plus hemisphere double-counts direct light, because captures include direct light from fixtures] → Normalising to the preset caps the total. `w` is tunable per room if one reads too flat or too strong.
- [Exposure adaptation can hide art-directed darkness] → The upper cap of 1.6 holds, and the blackout is verified in playtest. The setting gives players an off switch.
- [Asynchronous readback lands a few frames late] → The probe is lerped anyway. A late coefficient set is invisible.
- [Other agents editing `level.ts` at the same time (`shadow-rich-rooms`, `adopt-physics-engine`)] → Capture logic lives in its own module. `level.ts` gets only hooks: the version bumps, the per-frame capture step, and the probe lerp.

## Migration Plan

The new level field is optional. Rooms without it capture from their centre. No save-format change. The new setting defaults to on, and existing settings files load without it. To roll back, revert the change. The generic environment path still exists for the station's cold start, so reverting is a clean switch back.

## Open Questions

- The final `w` (bounce share) and `key` (neutral luminance) values. Tune in R03, the Commons and the Grow Hall, then record them here.

### Tuned values (tasks 4.3, 5.3, 2026-11-22)

- **`w` = 0.6** (`BOUNCE_SHARE`, `roomLightProbe.ts`). With Heins between the gallery pendants and the Lab B glass, the
  probe's irradiance toward the lamps is warmer (red/blue 1.83) than toward the glass (1.61), and the combined ambient
  matches the preset (unit test, ±10%). 0.3 and 0.9 were tried: the difference on a character at 2 m is subtle at any
  of them; 0.9 warms the lamp-side wall more but flattens the hemisphere's up/down shading. Worth a look by eye.
- **`key` = 0.058** (`ADAPT_KEY`, `eyeAdaptation.ts`), the mean log luminance of the Commons (two views: −3.71, −4.27)
  and R03 toward the glass (−4.31) at High. Multipliers there: 0.76, 1.12, 1.16. R03 facing its dark back wall
  (−5.50) and the Grow Hall (−4.24) sit at 1.6 and 1.23.
- Measured in play: into a dark room 0.78 → 1.59, 90% at 2.7 s; back into the Commons 1.6 → 0.77, 90% at 1.2 s.
  Pistol flashes every 0.3 s move exposure by ≤ 2.9% (gallery lit) and 0% (dark, at the cap).

### Implementation notes (deviations found while building)

- **PMREM size (D1, D4).** three r187's `PMREMGenerator` makes a cube render target of at least 256 px with 6 mip
  levels, not a 128 px CubeUV texture. Each filtered capture is therefore about 4.2 MB (256² × 6 faces × 8 B × 4/3),
  and the blend (D3) renders 6 faces × 6 mips into a cube target laid out the same way.
- **Flash rejection (D6).** A one-pole low-pass integrates a flash rather than rejecting it (a 0.1 s flash moved
  exposure by several percent in the model). The fast stage is instead a gate: a change of more than 0.25 stops must
  last 0.25 s before the slow stage sees it, and a rejected change must die back within 0.05 stops before small
  changes flow again. The measured level is clamped to the exposure range *before* the slow stage, so the full
  2–4 s / 0.5–1.5 s ramps happen inside the visible range instead of hitting the cap in the first half second.
  Time constants: 1.1 s toward darker views, 0.3 s toward brighter. The 1×1 state is a float target: half floats
  cannot hold the slow stage's per-frame steps.
- **Measurement (D6).** A 64 px log-luminance target with mipmaps, sampled at its 8 px level (centre counted
  double), rather than `LuminancePass`.

### Baseline (task 1.1, 2026-11-22, before this change)

Desktop PC, Chrome, 1280×720, `?level=slice01&debug&slot=scratch&memprobe`, fixed views via `window.__view`:
Grow Hall `at [40,1.6,16] look [47,1,24]`, Commons `at [17,1.6,13] look [28,1,22]`, R03 `at [8,1.6,16] look [8,1.2,23]`
(the Lab B glass with its blinds), with crew in view. Screenshots: `medium_*.jpeg` and `high_*.jpeg` (session scratchpad,
`baseline/`). Frame rate is capped by vsync at 60 fps. 1% lows are the mean of the slowest 1% of frames over 6 s.

| Room | Tier | avg fps | 1% low | GL texture MB | GL programs |
|---|---|---|---|---|---|
| Grow Hall | Medium | 60 | 59.1 | 1322 | 143 |
| Commons | Medium | 60 | 59.5 | 1322 | 150 |
| R03 | Medium | 60 | 59.2 | 1322 | 155 |
| Grow Hall | High | 60 | 58.9 | 1524 | 148 |
| Commons | High | 60 | 58.8 | 1524 | 155 |
| R03 | High | 60 | 59.2 | 1524 | 161 |

Look: every floor and metal surface reflects the same grey studio (the Commons tiles show its pale squares
whatever the room's colour). The Grow Hall's rails and floor carry no green or magenta from the grow lights.

# Design

## Context

See [proposal.md](proposal.md) for motivation and scope.

Key codebase constraints shaping this design:
- **Kit pieces (`src/world/kit/slice.ts`, `src/world/kit/types.ts`)**: Static geometry merges per room and material; dynamic meshes use `pb.dynamic(...)` and update via `pb.tick((t, dt) => ...)`. `steamPlume` (`slice.ts:242-318`) already demonstrates zero-CPU-upload GPU point shaders with soft radial puffs and `skipGtao: true`.
- **Audio (`src/audio/ambience.ts`, `src/audio/sounds.ts`, `scripts/ambience-generate.ts`)**: Per `openspec/specs/audio-assets`, all new environmental SFX and ambience MUST be ElevenLabs recordings (`eleven_text_to_sound_v2`), linear-normalized, registered in `SAMPLE_URLS`, and pass `npm run audio:audit` (no unreferenced samples/specs/files, no new procedural synths). `AudioEngine.play` on bus `'sfx'` with a `position` automatically applies wall/door/glass occlusion (`in-world-audio`), whereas `AmbienceDirector` currently only manages stereo room beds, random one-shots, and ceiling light buzzers.
- **Level & Doors (`src/world/level.ts`, `src/main.ts`)**: `Level.update` only ticks `room.ticks` for currently `visible` rooms. `main.ts` already yields every NPC's position to `level.setActors(...)`, so NPCs approaching unlocked auto doors (`D_R12b_R12c`, `D_R12b_R12d`) open them automatically, while locked `hydro_store` stays shut.
- **Ambient NPCs (`src/ai/ambientLife.ts`, `src/ai/npcs.ts`, `src/data/types/level.ts`)**: Currently `DESK_WORK_POSES` blocks `'crouchWork'` and `'typing'`, `AmbientDirector.update` skips rooms with `list.length < 2`, `AmbientSpot.kind` only supports `sit_*` / `lean_*`, and `AmbientAgent` is scoped to a single `room`. Existing tests (`ambientLife.test.ts`) assert `isAmbientEligible('exec_2', 'sit_typing') === false` and `maxMovingRatio <= 0.25`.
- **Speaker acting (`src/ai/speakerBodies.ts`)**: `crew_botanist` strips `crew_` to `'botanist'`, which does not match `botanist_1`/`botanist_2`/`botanist_3`.

## Goals / Non-Goals

**Goals:**
- Upgrade `mister` hardware, GPU mist visuals (spray cones + lingering vapor), staggered/quirky timing, and synced positional audio with zero per-frame CPU buffer uploads.
- Build a clean, reusable piece-to-level audio bridge for prop-owned positional loops and prop-triggered positional one-shots.
- Author and generate all Hydroponics (`R12a`–`R12e`) ambience beds, equipment loops, burst/fault/interaction SFX via ElevenLabs (`scripts/ambience-generate.ts`) and verify with `npm run audio:audit`.
- Unblock and enrich `AmbientDirector` so `botanist_1`, `botanist_2`, and `botanist_3` naturally move between hydroponics work spots (with Option 1 roaming: `botanist_2` in `R12b`, `botanist_1` across `R12b`+`R12d`, `botanist_3` in `R12c`) and bind `crew_botanist` (Wen) to `botanist_2`.

**Non-Goals:**
- Adding new dialogue lines, voice-over recordings, or held 3D clipboard/shears mesh rigs (`held-props` spec stays scoped to mugs and wand).
- Changing ambient behavior of seated office desk workers (`sit_typing` in Admin) or story cast NPCs.
- Adding wet-surface screen-space shader puddles or dynamic fluid physics under misters.

## Decisions

### D1: Two-Layer GPU Mister Shader + Deterministic Burst State Machine
**Choice**: Replace the single CPU-updated `PointsMaterial` in `mister` (`src/world/kit/slice.ts`) with a small deterministic cycle function (`misterCycle(t, period, offset, sputter)`) driving:
1. **Nozzle hardware**: Ceiling hanger rods with upper flange brackets, manifold feed riser, stainless rail with pipe clamps, brass/stainless nozzle fittings (`n` heads along the rail), and an end-mounted solenoid valve box with an emissive LED (idle dim teal -> bright cyan while spraying -> amber pulse on sputter).
2. **Layer A (Pressurized spray cones)**: GPU `ShaderMaterial` points (`~16–20` per nozzle, `uTime`, `uSpray` intensity 0..1) shooting downward in a tight ~35–42° cone (`0.7–1.0 m` drop) with fast velocity, soft radial alpha, and crisp brightness near the nozzle tip.
3. **Layer B (Drifting vapor cloud)**: GPU `ShaderMaterial` points (`~12–16` per nozzle, larger soft puffs, `uCloud` envelope 0..1) billowing gently below the cones, drifting slowly outward/downward with sinusoidal air turbulence, ramping in over ~0.35 s and lingering/fading smoothly over ~1.8 s after valve shutoff.
4. **Staggered timing in `scripts/gen-slice01.mjs`**: Give the 4 rails distinct periods and phase offsets (e.g. `period: 9.5, 11.2, 13.0, 10.4` with staggered `offset: 0.0, 3.1, 6.4, 8.2`), and set `sputter: true` on one central rail (e.g. `z = 18.8`) so every 3rd cycle produces a brief double-puff valve stutter.

*Alternative considered*: Volumetric cone meshes with scrolling noise shaders. Rejected as the sole solution because thin translucent cones look papery from below; combining fine GPU cone droplets + soft lingering vapor puffs reads realistically from both across the hall and standing directly underneath, with zero CPU geometry uploads and minimal draw calls (2 `Points` per rail = 8 draw calls total, skipped by GTAO).

### D2: Piece-to-Level Audio Emitter & Event Bridge (`PieceOutput.sounds` + `pb.emitSound`)
**Choice**: Extend `PieceOutput` / `PieceBuilder` (`src/world/kit/types.ts`) with two small primitives:
- **Declarative positional loops (`pb.soundLoop({ sound, pos, gain, maxDist?, bus?, cutoff?, reverb?, active? })`)**: Transformed into world space by `Level` when placing the prop, and managed by a lightweight `WorldAudio` (or `AmbienceDirector` extension) in `src/main.ts` that:
  - Starts/stops or scales loops with game mode (`title` = 0, `paused` = 0.35, `playing` = 1) and distance-attenuates/culls beyond range (so `R12d` pumps or `R12e` kettle don't waste voices while Jay is in the Docking Ring).
  - Hot-swaps from silent to the decoded ElevenLabs sample via `audio.onSampleLoaded`.
  - Respects dynamic enable/disable flags (e.g., `hvac_dehumidifier` alarm or active state) and resets cleanly on `level:reset`.
- **Synchronized one-shot triggers (`pb.soundAt(sound, localPos, opts)`)**: Emits a typed `world:sfx` event (carrying world-space `position`, `sound`, `gain`, `rate`, `reverb`, `bus: 'sfx'`) through `Level`'s `EventBus`. `main.ts` listens on `world:sfx` and calls `audio.play(sound, { bus: 'sfx', position, ... })` only when `mode === 'playing'` and within audible range (~24 m). Because it plays on `'sfx'` with a `position`, it automatically inherits `in-world-audio` wall/door/glass occlusion!

*Alternative considered*: Hardcoding `R12b` mister coordinates and `R12d` dehumidifier coordinates in `main.ts`. Rejected because it duplicates level layout data and drifts out of sync with the visual ticks (`mister` phase and `hvac_dehumidifier` `cleared` state).

### D3: ElevenLabs Asset Manifest & Split Hydroponics Room Presets
**Choice**: Add all new clips to `AMBIENCE_MANIFEST` in `scripts/ambience-generate.ts`, generate with `npm run ambience:generate`, register every file in `SAMPLE_URLS` (`src/audio/sounds.ts`), and split the wing's ambience presets in `src/audio/ambience.ts`:

| Asset ID (`SAMPLE_URLS`) | File (`public/assets/audio/ambience/`) | Kind | Role |
| --- | --- | --- | --- |
| `ambHydroMisters` (regen) | `bed-hydro-misters.mp3` | bed (18 s loop) | `R12b` humid greenhouse HVAC & warm air flow (no constant sprayer hiss) |
| `ambHydroVestibule` | `bed-hydro-vestibule.mp3` | bed (16 s loop) | `R12a` clean biosecurity vestibule ventilation / light air-curtain |
| `ambHydroSeedLab` | `bed-hydro-seed-lab.mp3` | bed (16 s loop) | `R12c` quiet clinical propagation lab + germination cabinet hum |
| `ambHydroPlantRoom` | `bed-hydro-plant-room.mp3` | bed (18 s loop) | `R12d` mechanical nutrient plant room low pump/compressor tone |
| `ambHydroStoreroom` | `bed-hydro-storeroom.mp3` | bed (14 s loop) | `R12e` quiet enclosed storeroom air tone (lets radio + kettle lead) |
| `misterValve` (x2) | `oneshot-mister-valve-{1,2}.mp3` | oneshot (0.9 s) | Solenoid click-thump + initial line pressurization |
| `misterSpray` (x2) | `oneshot-mister-spray-{1,2}.mp3` | oneshot (3.5 s) | Fine pressurized greenhouse mist spray hiss + soft shutoff tail |
| `misterSputter` | `oneshot-mister-sputter.mp3` | oneshot (2.2 s) | Brief stuttering double-puff spray for the "opinionated" rail |
| `hydroTrickle` | `emitter-hydro-trickle.mp3` | emitter (12 s loop) | Gentle NFT recirculating water trickle at troughs/racks |
| `dehumidifierHum` | `emitter-dehumidifier-hum.mp3` | emitter (10 s loop) | `R12d` industrial dehumidifier blower & compressor hum |
| `fertigationPump` | `emitter-fertigation-pump.mp3` | emitter (10 s loop) | `R12d` nutrient dosing pump & tank fluid agitation hum |
| `kettleSimmer` | `emitter-kettle-simmer.mp3` | emitter (10 s loop) | `R12e` soft electric kettle steam/simmer |
| `humidityAlarm` | `oneshot-humidity-alarm.mp3` | oneshot (1.2 s) | `R12d` soft industrial 2-tone humidity-fault warning chirp |
| `hydroDrip` (x2) | `oneshot-hydro-drip-{1,2}.mp3` | oneshot (0.9 s) | Wet foliage-to-grate condensation droplets for `R12b` one-shots |
| `hydroLogSign` | `oneshot-hydro-log-sign.mp3` | oneshot (1.1 s) | Crisp terminal confirmation tone for `round:hydro_log` |
| `hydroAlarmReset` | `oneshot-hydro-alarm-reset.mp3` | oneshot (1.4 s) | Relay click + resolved chime for `round:hydro_alarm` |

- New presets in `AMBIENCE_PRESETS` (`src/audio/ambience.ts`): `hydro_vestibule`, `hydro_seed_lab`, `hydro_plant_room`, `hydro_storeroom` (plus updated `hydro_misters` using `hydroDrip`).
- No new procedural synths added to `SOUND_SPECS` (per `audio-assets` spec). Bed presets fall back to existing `ventFan` / `roomTone` until decoded; positional emitters and one-shots degrade silently until loaded.
- `rounds.json` swaps `consoleBeep` for `hydroLogSign` (`hydro_log`) and `hydroAlarmReset` (`hydro_alarm`).

*Alternative considered*: Reusing `office_hvac` and `lab_hum` for `R12a`/`R12c`/`R12e`. Rejected because the user asked to generate all the sounds in Hydroponics via ElevenLabs, and dedicated beds give the wing a cohesive acoustic transition from airlock -> lush hall -> sterile seed lab -> mechanical plant room -> cozy hidden storeroom.

### D4: Reactive `R12d` Humidity Fault Alarm
**Choice**: Drive the periodic `humidityAlarm` chirp directly from `hvac_dehumidifier`'s existing `cleared` state in `src/world/kit/slice.ts` (every ~3.8 s while `!cleared`, firing `pb.soundAt('humidityAlarm', ...)` at the beacon position `[0.56, 2.1, -0.2]`). Because `hvac_dehumidifier` already listens to `round:hydro_alarm` (sets `cleared = true`) and `level:reset` (sets `cleared = false`), the audio and blinking amber/green beacon stay 100% synchronized across play, reset, and save-restore (also listen for `flag:set` or check initial state if restored after `hydro_alarm_reset`, matching how `quiet_restore.json` restores flags).

### D5: Work-Spot `AmbientDirector` Extension & Option 1 Roaming
**Choice**: Extend the existing ADR-0029 spot/ambient pipeline cleanly rather than adding a separate botanist AI:
1. **`SPOT_KINDS` (`src/data/types/level.ts`)**: Add `'work_crouch'`, `'work_clipboard'`, `'work_bench'` (mapped via `poseForSpotKind` in `src/ai/ambientLife.ts` to `'crouchWork'`, `'clipboard'`, `'typing'`). Keeping distinct `SpotKind` names makes intent clear and allows `AmbientDirector` to distinguish work spots (shorter dwell: `[12, 35]` s, initial `[5, 22]` s) from lounge spots (`[30, 90]` s).
2. **Prop spot emission (`src/world/kit/slice.ts`)**: Emit work spots with safe clearance (>= 0.35 m from prop colliders and clear of doorways, verified by `slice01.test.ts`):
   - `plant_rack`: 1 `work_crouch` spot on one side (`z = -d/2 - 0.55`, facing `+Z`) and 1 `work_clipboard` spot on the other (`z = +d/2 + 0.55`, facing `-Z`) — or front/back only when params/space allow, filtered against room bounds & colliders during `Level` spot registration so wall-hugging racks never emit unreachable spots!
   - `hydro_trough`: 1 `work_clipboard` spot on the open aisle side.
   - `hydro_workstation`: 1 `work_bench` spot slightly offset to the screen side (`x = -0.5, z = -0.78`) so Jay can still reach `trig_hydro_log` comfortably (and `giveWay` still yields if Jay walks up).
   - `harvest_cart`: 1 `work_clipboard` spot beside the cart.
   - `germination_cabinet`, `lab_bench`, `seed_vault` (`R12c`): `work_clipboard` / `work_bench` spots facing the equipment.
   - `fertigation_tank`, `hvac_dehumidifier` (`R12d`): `work_clipboard` spots on the service front.
3. **Level spot filtering (`src/world/level.ts`)**: When collecting `PieceOutput.spots` into `WorldSpot`, discard any work spot whose XZ position falls outside the room's walkable cells or intersects another prop's collider (within 0.25 m). This prevents back-side rack spots near walls from ever being booked.
4. **Eligibility & Roaming (`src/ai/ambientLife.ts`, `src/data/types/level.ts`, `scripts/gen-slice01.mjs`)**:
   - Narrow `DESK_WORK_POSES` to seated/fixed poses (`'sit_typing'`, `'kneel_revive'`), or keep `'typing'` locked *unless* the NPC's room/roam zone has work spots (better: keep `isAmbientEligible` returning `false` for `'sit_typing'` and `'kneel_revive'`, and check if any non-hydro NPC uses standing `'typing'` or `'crouchWork'` — if any story/other NPC shouldn't move, verify before changing `DESK_WORK_POSES`, or add an optional `roam?: readonly string[]` list of room ids on `npcShape` that explicitly opts an NPC into roaming across those rooms!).
   - Adding optional `roam?: string[]` on `npcShape` (`src/data/types/level.ts`) solves **both** problems cleanly and explicitly:
     - `botanist_1`: `roam: ['R12b', 'R12d']` (roams Grow Hall + occasional Nutrient Room check)
     - `botanist_2`: `roam: ['R12b']` (Wen stays in Grow Hall)
     - `botanist_3`: `roam: ['R12c']` (roams Seed Lab)
     - Any NPC with `roam` is explicitly eligible regardless of starting work pose, and single-agent rooms with `>= 2` spots are allowed to move (only keeping `list.length < 2` skip when a room has fewer than 2 free spots!).
     - Zero risk of accidentally unfreezing seated office workers, story NPCs, or other rooms' `typing`/`crouchWork` NPCs!
   - When `botanist_1` picks a spot in `['R12b', 'R12d']`, weight `R12b` spots slightly higher (~75%) than `R12d` spots (~25%) so `botanist_1` spends most time tending the Grow Hall and periodically walks through `D_R12b_R12d` to inspect the tanks/dehumidifier.

### D6: Binding Wen (`crew_botanist`) to `botanist_2`
**Choice**: Add `crew_botanist: 'botanist_2'` to `SPEAKER_NPC` in `src/ai/speakerBodies.ts`. Since `botanist_2` stays inside `R12b` (`roam: ['R12b']`), Wen is always present in the Grow Hall for `hydro_moment` and `hydro_store_locked_01`, lip-syncs with `wireSpeechActing`, and exchanges conversation gaze with Jay via `NpcDirector.lineStarted`.

## Risks / Trade-offs

- **[Risk] Back-side spots on wall-adjacent racks/benches could clip walls or adjacent props** → **Mitigation**: Filter emitted `work_*` spots in `Level` against room interior bounds and prop collider boxes (minimum 0.28 m clearance), and add an automated test in `src/world/slice01.test.ts` verifying every Hydroponics spot is inside bounds, non-overlapping, and navmesh-reachable from the room center.
- **[Risk] `botanist_1` walking into `R12d` could block the narrow doorway `D_R12b_R12d`** → **Mitigation**: Existing `NpcActor` give-way and solid separation already push NPCs aside for Jay, and all `R12d` spots sit clear of the doorway (`z >= 27.1`, `x <= 46.2` or near tanks/dehumidifier). Test pathing between `R12b` and `R12d` spots on the navgraph.
- **[Risk] `mister` ticks only run when `R12b` is visible (`Level.update`), so if `R12b` is culled behind a closed door, mister bursts wouldn't fire** → **Mitigation**: That is desirable when far away, and `R12b` is visible from `R12a`, `R12c` (via glass partition + `visibleFrom`), and `R12d` when doors open; when `R12b` becomes visible again, advance `lastPhase` gracefully without firing a burst backlog on the first frame.
- **[Risk] ElevenLabs generation quality variance on loop seams or spray length** → **Mitigation**: Use `scripts/ambience-generate.ts` (`loop: true` for beds/emitters, automatic linear loudness normalization via `ffmpeg`), verify durations/channels/loudness via `ffprobe`, and re-run `--force --id <id>` on any take that sounds off during browser playtest.
- **[Risk] `audio:audit` fails if any registered sample isn't referenced in `src/` or any file isn't registered** → **Mitigation**: Run `npm run audio:audit` and `npm test -- src/audio/audit.test.ts` immediately after generating and wiring all clips.

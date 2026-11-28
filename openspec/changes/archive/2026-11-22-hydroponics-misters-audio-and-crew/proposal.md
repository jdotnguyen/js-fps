# Proposal

## Why

The Hydroponics wing (`R12a`–`R12e`) is one of the first crewed wings Jay visits on morning rounds, yet three gaps break its immersion: the Grow Hall overhead misters render as flat, silent square dots that snap on and off together, all five rooms share a single continuous sprayer loop (with no audible humidity fault alarm despite Wen thanking Jay for silencing it, and no local equipment audio), and all three botanists stand frozen in place while Wen's dialogue plays without lip-sync or gaze. Refining the misters, generating a full ElevenLabs soundscape for the wing, and getting the botanists moving makes Hydroponics feel like a living, working bay.

## What Changes

- **Grow Hall mister overhaul (`R12b`)**: Upgrade the `mister` kit prop with brass/stainless nozzle assemblies, ceiling drop mounts, and a solenoid valve box with active status LED; replace the CPU-updated `PointsMaterial` squares with a two-layer GPU shader (pressurized downward nozzle spray cones plus a soft drifting vapor cloud that ramps in and lingers after shutoff); stagger periods/phases across the four rails with one rail exhibiting an occasional double-puff sputter; trigger synchronized positional audio on burst start/spray/sputter.
- **Full Hydroponics ElevenLabs soundscape (`R12a`–`R12e`)**:
  - Regenerate `bed-hydro-misters.mp3` as a warm humid greenhouse HVAC/air-circulation bed without baked-in continuous sprayer hiss so real positional mister bursts stand out.
  - Add dedicated room ambience presets for `R12a` (`hydro_vestibule`), `R12c` (`hydro_seed_lab`), `R12d` (`hydro_plant_room`), and `R12e` (`hydro_storeroom`), replacing the single shared `hydro_misters` preset across the wing.
  - Generate and register ElevenLabs clips for synchronized mister bursts (`misterValve`, `misterSpray`, `misterSputter`), foliage drips (`hydroDrip`), positional prop emitters (`hydroTrickle` on racks/troughs, `dehumidifierHum` and `fertigationPump` in `R12d`, `kettleSimmer` in `R12e`), the reactive `R12d` humidity fault alarm chirp (`humidityAlarm`, silenced when `round:hydro_alarm` clears and restored on `level:reset`), and `hydroLogSign` / `hydroAlarmReset` replacing procedural `consoleBeep` in `rounds.json`.
  - Add a lightweight piece-to-level audio bridge so kit props can register positional loops and fire positional one-shots that obey `in-world-audio` occlusion.
- **Moving botanists & Wen speaker binding (`R12b`, `R12c`, `R12d`)**:
  - Extend activity spots (`SpotKind`) with work poses (`crouchWork`, `clipboard`, `typing`) and emit work spots from hydroponics props (`plant_rack`, `hydro_trough`, `hydro_workstation`, `harvest_cart`, `germination_cabinet`, `lab_bench`, `seed_vault`, `fertigation_tank`, `hvac_dehumidifier`).
  - Update `AmbientDirector` so mobile work-pose crew can move between free spots, single-NPC rooms with multiple spots (`R12c`) are active, agents can optionally roam across an explicit multi-room work zone, and work spots use livelier dwell intervals (~12–35 s) while seated office typists (`sit_typing`) and `kneel_revive` remain stationary.
  - Configure Option 1 roaming: `botanist_2` (Wen) roams `R12b`, `botanist_1` roams `R12b` with occasional trips into `R12d` to check the nutrient/dehumidifier gear, and `botanist_3` roams `R12c` Seed Lab.
  - Bind `crew_botanist` to `botanist_2` in `src/ai/speakerBodies.ts` so Wen's voice drives lip-sync, gestures, and conversation gaze.

## Capabilities

### New Capabilities
- `hydroponics-wing`: Defines the Hydroponics wing's (`R12a`–`R12e`) interactive visual and behavioral life — overhead mister hardware/plumes/timing and burst-audio sync, reactive equipment audio (including the `R12d` humidity alarm and `R12e` kettle), and ambient botanist work movement and Wen speaker binding.

### Modified Capabilities
- `in-world-audio`: Adds the new Hydroponics room ambience presets (`hydro_vestibule`, `hydro_seed_lab`, `hydro_plant_room`, `hydro_storeroom`) and defines positional prop-driven loops and synchronized world-event one-shots that follow room/wall/glass occlusion and game-mode scaling.

## Impact

- **Kit & Level (`src/world/kit/slice.ts`, `src/world/kit/types.ts`, `src/world/level.ts`, `scripts/gen-slice01.mjs`, `src/data/levels/slice01.json`, `src/data/types/level.ts`)**: Upgraded `mister` prop, work-spot emission on hydro props, piece-to-level audio emitter/event bridge, updated room ambience presets and NPC roam metadata in `slice01`.
- **Audio & ElevenLabs Assets (`scripts/ambience-generate.ts`, `public/assets/audio/ambience/`, `src/audio/sounds.ts`, `src/audio/ambience.ts`, `src/main.ts`, `src/data/sequences/rounds.json`)**: ~14 ElevenLabs SFX/ambience files generated and normalized, registered in `SAMPLE_URLS` with no new procedural synths, wired into `AmbienceDirector` and `main.ts`, verified by `npm run audio:audit`.
- **NPC AI & Dialogue (`src/ai/ambientLife.ts`, `src/ai/npcs.ts`, `src/ai/speakerBodies.ts`)**: Work-spot roaming, single-NPC multi-spot room support, optional multi-room roam zones, faster work dwell, and `crew_botanist` -> `botanist_2` mapping.
- **Tests**: Unit and level tests in `src/world/slice01.test.ts`, `src/audio/ambience.test.ts`, `src/audio/audit.test.ts`, `src/ai/ambientLife.test.ts`, plus new focused tests for mister burst timing/audio and hydroponics crew movement.

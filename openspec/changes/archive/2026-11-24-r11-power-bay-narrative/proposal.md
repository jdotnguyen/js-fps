# Proposal

## Why

Phase 1 and Phase 2 rebuilt `R11` as a non-combat deep-sea Power Bay leading into the lower transit wing (`R13d` -> `R15a` -> `R16a`/`R16b`), but the game's narrative sequences still run the legacy "Control Room" wave-defense climax and Giles's infection reveal/transformation cliffhanger. Because the finale now moves to the `R16a`/`R16b` Arrival Terminal, Giles's infection arc and all earlier foreshadowing must be removed, and `R11` needs its own grounded, character-driven power-up sequence before the squad proceeds to the departure train.

## What Changes

- **Remove Giles's infection arc and foreshadowing**:
  - Remove the intro forearm-rub tell and Okafor's "Arm bothering you?" exchange from `intro_shift_change.json`.
  - Remove `giles.infectionStage` escalation and scripted `cough` tells from `action_tunnel.json`, `action_climax.json`, and `session.ts` debug jump presets (`r09`, `r11`).
  - Remove the legacy `cliffhanger` (Giles confession, `reveal:trail`, transformation), `reveal_restore`, and `climax_hero` sequences from `action_climax.json`, keeping Giles healthy and unbandaged throughout the slice.
- **Author the new `R11` Power Bay narrative sequence (`r11_power_bay`)**:
  - Replace the legacy `climax` wave-hold with a tense, non-combat character beat: Jay and Okafor enter the dark Power Bay whispering cautiously because they do not recognize the room, while Giles calmly walks past them, casually explaining it is just the power bay.
  - Giles moves to the west-wall transit power-up terminal (`r11_giles_task`), diagnoses the tripped transit sub-grid, has an "a-ha!" realization, and brings the generators online in three staged phases.
  - Each phase triggers a newly generated low-rumbling generator startup SFX (via ElevenLabs SFX) synchronized with the cascading west-to-east overhead light banks, turbine rotor spin-up, and terminal telemetry (`standby` -> `starting` -> `online`).
  - Once power stabilizes, `D_R13d_R11` unlocks/opens, a checkpoint saves, and the objective updates to head through `R13d` Maintenance Corridor to the `R15a` Departure Boarding Bay.
- **Generate per-room VO and phased generator SFX**:
  - Author the complete `R11` dialogue script in `src/data/dialogue/slice01_action.json` and generate new VO clips for Giles, Okafor, and Jay using each speaker's pinned Gemini TTS model (`scripts/vo-generate.ts`, per `docs/voice-casting-standard.md` — keeping voice continuity with the rest of the slice).
  - Generate three phased low-rumbling generator startup SFX (`public/assets/audio/ambience/oneshot-generator-phase-1.mp3` through `3.mp3`) via ElevenLabs SFX.

## Capabilities

### New Capabilities
- *(none — extends existing `transit-wing`, `intro-sequence`, and `character-motion` specs)*

### Modified Capabilities
- `transit-wing`: Add requirements for the `R11` Power Bay narrative sequence (whispered cautious entry, Giles's casual diagnosis and phased generator startup with phased low-rumble SFX, and post-energization progression into `R13d`/`R15a`).
- `intro-sequence`: Remove the forearm-rub and Okafor injury-check beat from `Walk to the kitchen on rails`.
- `character-motion`: Remove Giles's hidden-injury / infection-stage arm-guarding requirements so Giles moves cleanly throughout the slice.

## Impact

- Sequences: `src/data/sequences/action_climax.json`, `src/data/sequences/action_tunnel.json`, `src/data/sequences/intro_shift_change.json`
- Dialogue & Objectives: `src/data/dialogue/slice01_action.json`, `src/data/objectives.json`
- Audio: `src/audio/sounds.ts`, new ElevenLabs SFX in `public/assets/audio/ambience/`, new Gemini TTS VO clips in `public/assets/vo/` (tracked in `scripts/vo-takes.json`)
- Session & Tests: `src/app/session.ts` (debug jumps `r09`/`r11`), `src/script/action.test.ts`, `src/script/intro.test.ts`

# Design

## Context

See `proposal.md` for motivation. `R11` ("Power Bay") already has its industrial dressing, twin turbine-generators, west-wall transit power-up terminal (`final_console` / `r11_giles_task`), six overhead light banks (`r11_bank_1a`–`3b`), two standby beacons (`r11_beacon_ne`, `r11_beacon_sw`), and the existing `r11_power_cascade` sequence in `src/data/sequences/action_climax.json`. This design replaces the legacy `climax`/`cliffhanger` sequences with the new non-combat `R11` Power Bay narrative beat, removes Giles's infection foreshadowing across the slice, and defines the exact dialogue script and phased generator audio for review before VO/SFX generation.

## Goals / Non-Goals

**Goals:**
- Deliver a tight, natural, playable (no hard player-control lock) `R11` Power Bay scene where Jay and Okafor enter whispering cautiously, Giles casually walks past to the west-wall terminal, diagnoses the tripped transit sub-grid, has his "a-ha!" moment, and brings power up in three audible, rumbling phases.
- Cleanly remove every scripted Giles infection tell (`rub_forearm` in intro, `cough` and `giles.infectionStage = 3` in `R09`/`R10`, `cliffhanger`/`reveal_restore`/`climax_hero` in `R11`, and debug jump presets in `session.ts`).
- Keep `title_card` and `stinger_priya` intact in `action_climax.json` (idle until wired to the `R16` arrival finale in a subsequent change).

**Non-Goals:**
- `R15a` train boarding / Heins radio exchange (covered in the next per-room change).
- `R16a`/`R16b` arrival horror reveal, security camera feed, weapon flashlights, and end-of-slice credits (covered in the third per-room change).
- Deleting unused injury-helper code in `src/actors/injury.ts` or `src/ai/squad.ts` if unit tests still exercise the low-level rig helpers — we simply keep Giles at stage `0` / unbandaged in all authored sequences and debug presets.

## Proposed R11 Beat-by-Beat Timeline (Dialogue, SFX, Actions, Lights & Rough Timing)

All dialogue VO will be generated via `scripts/vo-generate.ts` using each speaker's pinned Gemini TTS model (`engineer`/Giles: `Algenib` on `gemini-2.5-flash-preview-tts`; `medic`/Okafor: `Charon` on `gemini-2.5-flash-preview-tts`; `player`/Jay: `Orus` on `gemini-3.1-flash-tts-preview`) per `docs/voice-casting-standard.md`, keeping voice continuity with the rest of Slice One. Total sequence duration is roughly **~41–44 s** (free player movement throughout).

| Time (rough) | Beat | Dialogue (Line ID / Speaker / Emote) | SFX & Audio | Actions, Animations & Lights |
| --- | --- | --- | --- | --- |
| `0:00` | **0. Entry** | — | Room ambience (quiet dormant power bay; standby beacons pulsing softly) | Trigger `trigger:r11_enter` fires (`valve_done`). `D_R13d_R11` stays locked. `R11` overhead banks (`r11_bank_1a`–`3b`) are **off**; `r11_beacon_ne`/`sw` provide dim amber/red standby light. Terminal telemetry shows `standby`. Okafor steps into `R11` (`r11_okafor_end`) cautiously, scanning the dark bay. |
| `0:01 – 0:04` | **1. Cautious entry** | `r11_okafor_01` — **Okafor** (`whisper`): *"Easy. Stay tight—I don't know this section."* | — | Okafor holds cautiously near the south entry looking into the dark bay. |
| `0:04 – 0:07` | **2. Cautious entry** | `r11_jay_01` — **Jay** (`whisper`): *"Yeah. Eyes open—I can't see the far wall."* | — | Free look/move for Jay. |
| `0:07 – 0:12` | **3. Giles walks past** | `r11_giles_01` — **Giles** (`neutral`): *"Relax, you two. It's just the lower power bay. I've been down here a hundred times."* | Subtle footsteps as Giles strolls past | Giles calmly walks right past Jay and Okafor straight to the west-wall terminal (`anchor:r11_giles_task`). Okafor relaxes slightly and shifts to watch the bay. |
| `0:12 – 0:18` | **4. Terminal diagnosis** | `r11_giles_02` — **Giles** (`neutral`): *"Let's see why the transit rail's dead... breakers are fine, bus pressure's holding..."* | Soft console key clicks / UI hum at `final_console` | Giles enters standing `panel_work` / `typing` animation at `final_console`, inspecting the west-wall display. |
| `0:18 – 0:23` | **5. A-ha! moment** | `r11_giles_03` — **Giles** (`relieved`): *"Ha—there it is! Quarantine dumped the phase relays. Lazy lockout. Watch this."* | `breakerClunk` (heavy master relay throw at `final_console`) right as he finishes | Giles reaches for the physical breaker controls; `r11:power_state` shifts `standby` -> `starting`; `r11:hum_on` starts the low turbine rotor spin-up. |
| `0:23 – 0:27` | **6. Phase 1 startup** | `r11_giles_04` — **Giles** (`neutral`): *"Phase one... turbines waking up."* | **`generatorPhase1`** (ElevenLabs SFX: deep muffled relay thump + initial sub-bass spool-up rumble at `r11_hold`) + `breakerClunk` (gain `0.7`) | Subtle `cameraShake` (`0.04`, `0.35 s`). West overhead bank **`r11_bank_1a` & `r11_bank_1b`** flickers on (~0.45 s), then snaps **steady** (`reducedFlashing` skips flicker). Turbine rotors begin turning. |
| `0:27 – 0:31` | **7. Phase 2 startup** | `r11_giles_05` — **Giles** (`neutral`): *"Phase two. Rail bus taking load."* | **`generatorPhase2`** (ElevenLabs SFX: heavier layered twin-generator mechanical rumble climbing in weight at `r11_hold`) + `breakerClunk` (gain `0.75`) | `cameraShake` (`0.06`, `0.4 s`). Center overhead bank **`r11_bank_2a` & `r11_bank_2b`** flickers on (~0.4 s), then snaps **steady**. Turbine rotors accelerate. |
| `0:31 – 0:36` | **8. Phase 3 / Lights on** | `r11_giles_06` — **Giles** (`relieved`): *"And phase three—there's our lights."* | **`generatorPhase3`** (ElevenLabs SFX: full-load turbine lock-in + deep steady power-plant bass hum at `r11_hold`) + `breakerClunk` (gain `0.85`) + `fluorescentBuzz` | `cameraShake` (`0.09`, `0.45 s`). East overhead bank **`r11_bank_3a` & `r11_bank_3b`** flickers on (~0.45 s), then snaps **steady**. `r11:power_state` shifts to **`online`**; `r11_powered = true`. Standby emergency beacons **`r11_beacon_ne` & `r11_beacon_sw`** switch **off**. Giles steps back from console to `idle`. |
| `0:36 – 0:39` | **9. Transit unlocked** | `r11_okafor_02` — **Okafor** (`neutral`): *"North bulkhead just cycled. That lead to the train?"* | Heavy bulkhead door unlock & cycle SFX (`D_R13d_R11` opening) | `D_R13d_R11` unlocks and opens (`state: "open"`); `D_R13d_R15a` unlocks. Okafor turns toward the north doorway. |
| `0:39 – 0:43` | **10. Head to train** | `r11_giles_07` — **Giles** (`neutral`): *"Straight through the maintenance hall. Departure bay's on the other side—let's move."* | Steady energized power-bay hum continues in background | `obj_power` completes; `obj_transit_board` (*"Departure Bay: board the transit train"*) activates; checkpoint `cp_r11_powered` (*"Power Bay Online"*) saves. Squad resumes following Jay north through `R13d` toward `R15a`. |

## Decisions

1. **Three-phase generator startup audio (ElevenLabs SFX)**:
   - Generate three distinct low-rumbling generator startup clips via ElevenLabs SFX (`ELEVENLABS_API_KEY`):
     - `generatorPhase1` (`public/assets/audio/ambience/oneshot-generator-phase-1.mp3`): deep muffled industrial turbine relay thump + initial low-frequency sub-bass spool-up rumble (~3.5 s).
     - `generatorPhase2` (`public/assets/audio/ambience/oneshot-generator-phase-2.mp3`): heavier layered twin-generator mechanical rumble climbing in resonant low-end weight (~3.5 s).
     - `generatorPhase3` (`public/assets/audio/ambience/oneshot-generator-phase-3.mp3`): full-load power-plant turbine lock-in with heavy breaker engagement and deep steady bass hum settling in (~4.0 s).
   - Wire all three into `src/audio/sounds.ts` and trigger them sequentially inside `r11_power_cascade` right before each overhead light bank (`r11_bank_1a/1b` -> `2a/2b` -> `3a/3b`) energizes, paired with subtle `cameraShake` impulses (0.04 -> 0.06 -> 0.09) so the room physically feels like massive subsea turbines coming online.

2. **Voice provider continuity (Gemini TTS for dialogue, ElevenLabs for SFX)**:
   - Per `docs/voice-casting-standard.md`, all existing dialogue for Giles (`Algenib`), Okafor (`Charon`), and Jay (`Orus`) is recorded on pinned Gemini TTS models. Mixing ElevenLabs TTS for just `R11` lines would make the squad suddenly sound like different actors mid-playthrough. Using `scripts/vo-generate.ts` (Gemini TTS) for the 10 dialogue lines and ElevenLabs SFX for the 3 generator phase-startup rumbles keeps both character voices and industrial audio 100% consistent.

3. **Free player movement during `R11` Power Bay**:
   - Unlike the old `cliffhanger` sequence, `r11_power_bay` keeps player movement and look completely free so Jay can walk around the dark bay, watch Giles stroll past to the west-wall terminal, and watch the turbine-generators and overhead light banks come alive in real time.
   - `D_R13d_R11` starts locked (`state: "locked"`) until `r11_power_cascade` completes, then opens (`state: "open"`) alongside `D_R13d_R15a` being unlocked so the squad can immediately proceed to `R15a`.

4. **Objective and checkpoint progression**:
   - Update `obj_power` in `src/data/objectives.json` from `"Hold the control room while Giles restores power"` to `"Power Bay: restore power to the transit line"`.
   - Add `obj_transit_board` (`"Departure Bay: board the transit train"`, `target: "anchor:r15a_train_inside"`), set as soon as `r11_power_bay` completes and saves checkpoint `cp_r11_powered` ("Power Bay Online").

## Risks / Trade-offs

- **[Risk] Existing unit tests (`src/script/action.test.ts`, `src/script/intro.test.ts`) assert the old `giles_forearm_seen`, `giles.infectionStage`, `reveal:trail`, and `cliffhanger` beats** → Update those test suites in the same change to assert the new `R11` Power Bay sequence, zero infection escalation, and clean intro walk.
- **[Risk] Gemini TTS daily free-tier quota (10 requests/day per model)** → `r11_giles_01`–`07` + `r11_okafor_01`–`02` share `gemini-2.5-flash-preview-tts` (9 lines = 1 single batch request!) and `r11_jay_01` is 1 line on `gemini-3.1-flash-tts-preview` (1 single request!). Total cost: 2 API requests.

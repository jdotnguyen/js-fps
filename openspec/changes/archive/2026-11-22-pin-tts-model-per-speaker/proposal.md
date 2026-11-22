# Proposal

## Why

Retakes of Giles, Okafor and Bram stopped sounding like their first recordings. The cause was the TTS model, not the voice names. The first bulk VO run on 2026-11-19 had no `--models` pin, so each time a model's daily quota ran out, `scripts/vo-generate.ts` moved to the next model in its fallback list. That spread the cast across three Gemini TTS models. `docs/voice-casting-standard.md` then named `gemini-3.1-flash-tts-preview` as the one target model for everyone, so pinned retakes on 3.1 no longer matched lines that were first made on another model. Eleven lines in the dock-checkpoint scene still need recording, and recording them on the wrong models would repeat the problem.

## Evidence: which model made each batch

No log of the 11-19 run survives. The raw batch WAVs in `previews/vo-batches/` still show their model: each model returns PCM in chunks of a fixed size, so a batch's sample count divided by 480 leaves the same remainder for every file from that model.

| Group | Sample count ÷ 480 leaves | Model | How we know |
| --- | --- | --- | --- |
| A | 263 | `gemini-2.5-flash-preview-tts` | A one-line probe on 2026-11-21 gave remainder 263. `gemini-2.5-pro-preview-tts` has a quota of 0 on this key's free tier, so it can't be the source. |
| B | 0 | `gemini-3.1-flash-tts-preview` | Every retake whose log names 3.1 has this remainder. |
| C | 14 | `gemini-3.8-flash-tts` | A surviving reactions log line names `gemini-3.8-flash-tts`. |

Current model per speaker, by batch:

| Speaker | Voice | Batches and models | Proposed reference model |
| --- | --- | --- | --- |
| `engineer` (Giles) | Algenib | `vo_engineer_01`–`09` on A; the Hale + Giles batch, `intro_giles_15`–`16` and the 11-21 retake on B | **2.5-flash** (the user's reference for Giles) |
| `medic` (Okafor) | Charon | `vo_medic_03`–`06` on A; `vo_medic_01`–`02` and the 11-21 retake on B | **2.5-flash** (the user's reference for Okafor) |
| `crew_cook` (Bram) | Enceladus | Original batch on C; fully re-recorded on B | 3.1 (already consistent) |
| `player` (Jay) | Orus | `vo_player_01`–`02` and `retake_player_01` on B; `retake_player_02` and reactions on C | **3.1** (decided 2026-11-21) |
| `nurse` (Priya) | Sulafat | `vo_nurse_01` and `retake_nurse_01` on B; `retake_nurse_02` and reactions on C | **3.1** (decided 2026-11-21) |
| `chief`, `director`, `pa`, `crew_ruiz`, `crew_sung`, `crew_botanist` | Kore, Rasalgethi, Gacrux, Aoede, Achird, Puck | All on B | 3.1 (already consistent) |
| `crew_mess`, `crew_maint`, `crew_assistant`, `crew_lab` (Voss) | Fenrir, Iapetus, Despina, Leda | All on C, including Voss's reactions | **3.8** (already consistent; kept, decided 2026-11-21) |
| `crew_dock_guard` | Alnilam | Not recorded | 3.1, to match the rest of the dock scene |

## What Changes

- Each speaker gets one reference Gemini TTS model, recorded next to their voice in the cast data. Generation uses that model by default, not one shared fallback list.
- **BREAKING (tooling):** `scripts/vo-generate.ts` and `scripts/vo-reactions.ts` no longer switch models when a quota runs out. They stop, report which batches remain, and leave already-written clips as they are.
- Each generation run writes a committed record of the batch, line IDs, speaker, voice and model it used, so a clip's model never has to be reconstructed from raw WAVs again.
- `docs/voice-casting-standard.md` drops the rule that every speaker targets `gemini-3.1-flash-tts-preview`. It replaces the "Legacy" and "Mixed" status labels with the real model map above, and documents the sample-count method for checking which model made a batch.
- Speakers whose lines span more than one model are re-recorded onto their reference model:
  - Giles (to 2.5-flash): his lines in the Hale + Giles batch, `intro_giles_15`–`16`, the 11-21 retakes `sec_giles_06`–`07`, and his cry reactions (`react_giles_cry_*`, currently 3.8 TTS), which are replaced with credited recordings instead, since TTS does not do screams.
  - Okafor (to 2.5-flash): his lines from the old `vo_medic_01`–`02` batches and the 11-21 retakes `sec_okafor_01`, `02` and `08`.
  - Jay and Priya (to 3.1): the lines from `retake_player_02` and `retake_nurse_02`, plus their TTS reaction pools.
- The 11 unrecorded lines are recorded on their speakers' reference models: 9 dock-guard lines, `intro_giles_alarm_01` and `intro_okafor_alarm_01`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `voice-playback`: the "Consistent voice casting" scenarios name Giles's and Okafor's reference model. New requirements cover where each speaker's pinned model is recorded, generation never falling back to another model, and a record of which model made each clip.

## Impact

- `scripts/vo-generate.ts`: cast entries gain a model; the default fallback list and quota-switching loop go away.
- `scripts/vo-reactions.ts`: same change, since its default list currently starts on `gemini-3.8-flash-lite-tts`.
- `docs/voice-casting-standard.md`: sections 1, 2, 3 and 7.
- `public/assets/vo/`: the re-recorded clips listed above, plus 11 new clips; `src/data/dialogue/slice01.json` gains their `audio` paths.
- Quota: the free tier allows 10 requests a day per model (`gemini-2.5-flash-preview-tts` and `gemini-3.1-flash-tts-preview`, measured 2026-11-21). Re-recording Giles and Okafor's mixed lines took most of a day's 2.5-flash quota; a full re-record of both would take more than one day.

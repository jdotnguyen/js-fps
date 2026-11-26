# Voice Casting & Reference Voices Spec

> Canonical voice cast, per-speaker model pinning, audio specs, and how to trace which model made a clip, for Thalassa dialogue and vocal reactions.
> Companion to the [voice-playback spec](../openspec/specs/voice-playback/spec.md) (how lines sound in game) and [characters.md](characters.md) (character bible). Adding other sounds: [audio-assets.md](audio-assets.md).
> Source of truth in code: `scripts/lib/voCast.ts` (voice + model per speaker), `scripts/lib/voReactionBatches.ts`, `scripts/vo-takes.json` (which model made each clip), `src/data/dialogue/speakers.json` (subtitle names).

## 1. Critical consistency rules (do not mix providers or TTS models)

| Asset class | Provider | Generator script(s) | Env var |
| --- | --- | --- | --- |
| Character dialogue VO (`public/assets/vo/*.mp3`) | **Gemini TTS** | `scripts/vo-generate.ts` | `GEMINI_API_KEY` |
| Non-verbal vocal reactions (grunts, cries, choking, panting) | **Gemini TTS** | `scripts/vo-reactions.ts` | `GEMINI_API_KEY` |
| Screams, yells, cries and Jay's startled shouts | **Recorded clips** (OpenGameArt, credited in `CREDITS.md`) — TTS does not do screams | trimmed by hand with ffmpeg, wired via `LINE_POOLS` in `scripts/vo-reactions.ts`; listed in `CREDITED_REACTION_CLIPS` so no batch can overwrite them | — |
| Environmental ambience, doors, footsteps SFX | **ElevenLabs SFX** | `scripts/ambience-generate.ts`, `scripts/doors-generate.ts`, `scripts/footsteps-generate.ts` | `ELEVENLABS_API_KEY` |

1. **Never mix providers for a character**: Do not use ElevenLabs TTS for individual dialogue lines unless intentionally recasting and re-recording every line for that character.
2. **Never mix Gemini TTS models for a character**: Even with the **exact same prebuilt voice name**, different Gemini TTS models render noticeably different actor timbres and deliveries. Giles and Okafor's first batch (on `gemini-2.5-flash-preview-tts`) and their 3.1 retakes sound like different actors.
3. **Each speaker has one pinned model**, stored next to their voice in `scripts/lib/voCast.ts`. Both generators send a speaker's batches only to that model. There is **no fallback list and no `--models` flag**: when a model's quota runs out, the run stops that model's batches, lists them as not generated, and exits non-zero. Rerun those IDs once the quota resets.
4. **Pin a speaker's accent once you know it.** Nothing else in the prompt names an accent, and a short retake can drift: on 2026-11-21 a one-line Heins retake (`brief_heins_door`) came out Australian on the same model and voice. Listen to the speaker's existing lines, then set `accent` in their `voCast.ts` entry; every dialogue and reaction prompt for them then states it. Pinned so far: Heins (General American). Don't guess an accent for a speaker you haven't listened to.
5. **Recasting a speaker** means changing their `voice` or `model` in `voCast.ts` and re-recording every one of their lines. It shows up in review as a one-line diff.
6. **Two-speaker batches only pair speakers on the same model**, since one request runs on one model.
7. There is no single target model for the whole cast. Three models are in use, one per speaker (§2).

## 2. Reference voice cast — dialogue (Gemini TTS)

Every speaker ID in `src/data/dialogue/*.json` maps to one locked Gemini prebuilt voice (`prebuiltVoiceConfig.voiceName`) and one pinned model. The "Off-model clips" column is what `scripts/vo-trace.ts` reported after the 2026-11-21 re-record (openspec change `pin-tts-model-per-speaker`); rerun it for the current state.

| Speaker ID | Character | Subtitle name (`speakers.json`) | Gemini voice | Pinned model | Off-model clips (2026-11-21) | Acting profile |
| --- | --- | --- | --- | --- | --- | --- |
| `engineer` | **August Giles** | `Giles` | **`Algenib`** | `gemini-2.5-flash-preview-tts` | 0 — dialogue re-recorded 2026-11-21; his cries are credited recordings, not TTS | 42, weathered deep-sea systems engineer; blue-collar, gravelly warmth, wry dry humour hiding exhaustion and nerves. |
| `medic` | **Dr. Tomas Okafor** | `Okafor` | **`Charon`** | `gemini-2.5-flash-preview-tts` | 0 — 25 lines re-recorded 2026-11-21 | 50s, deep warm calm trauma surgeon; disciplined, measured authority; drops quiet when genuinely afraid. |
| `player` | **Jay** | `Jay` | **`Orus`** | `gemini-3.1-flash-tts-preview` | 0 — dialogue and pain grunts re-recorded 2026-11-21 | 30s, steady grounded station security officer; kind, attentive, conversational lower-mid male voice. |
| `nurse` | **Priya Anand** | `Priya` | **`Sulafat`** | `gemini-3.1-flash-tts-preview` | 0 — dialogue re-recorded 2026-11-21, choke takes 2026-11-22 | 29, warm cheerful sharp medical nurse; friendly, competent, affectionate teasing with coworkers. |
| `crew_cook` | **Bram** | `Bram` | **`Enceladus`** | `gemini-3.1-flash-tts-preview` | 0 | 45, dry deadpan station cook; raspy, tired, wry humour. |
| `chief` | **Katie Heins** | `Heins` | **`Kore`** | `gemini-3.1-flash-tts-preview` (accent: General American) | 0 (`brief_heins_door` re-recorded with the pinned accent 2026-11-21) | 38, no-nonsense security chief; crisp, brisk, firm, slightly annoyed by corporate secrecy. |
| `director` | **Director Hale** | `Director Hale` | **`Rasalgethi`** | `gemini-3.1-flash-tts-preview` | 0 — `brief_hale_01` re-recorded 2026-11-21 | 48, smooth polished corporate station administrator; calm and rehearsed on intercom, clipped and nervous under stress. |
| `pa` | **Station PA** | `Station PA` | **`Gacrux`** | `gemini-3.1-flash-tts-preview` | 0 — `pa_quarantine_01` re-recorded 2026-11-21 | TAG Industries automated station PA; smooth, mature, calm, overly polite, detached retro-corporate announcement. |
| `crew_sung` | **Sung** | `Crew` *(unauthored)* | **`Achird`** | `gemini-3.1-flash-tts-preview` | 0 | 30, friendly station diver returning from shore leave; warm, easygoing. |
| `crew_botanist` | **Wen (Botanist)** | `Crew` *(unauthored)* | **`Puck`** | `gemini-3.1-flash-tts-preview` | 0 | Station hydroponics botanist; conversational, dryly amused, slightly exasperated. |
| `crew_ruiz` | **Ines Ruiz** | `Crew` *(unauthored)* | **`Aoede`** | `gemini-3.1-flash-tts-preview` | 0 | 30s, relaxed breezy comms technician; friendly morning banter. |
| `crew_dock_guard` | **Dock Guard** | `Guard` | **`Alnilam`** | `gemini-3.1-flash-tts-preview` | 0 — 9 lines recorded 2026-11-21 | 40s, dock security guard who has scanned the same crew every morning for years; patient, dry, warm under the routine. |
| `crew_lab` | **Dr. Lena Voss** | `Crew` *(unauthored)* | **`Leda`** | `gemini-3.8-flash-tts` | 0 (`react_voss_panic_01` untraceable: re-cut by hand) | 34, sharp anxious microbiologist; terrified and pleading when infected. |
| `crew_assistant` | **Hale's Assistant** | `Crew` *(unauthored)* | **`Despina`** | `gemini-3.8-flash-tts` | 0 | Director Hale's administrative assistant; quiet, tense, anxious around corporate secrets. |
| `crew_mess` | **Mess Crew** | `Crew` | **`Fenrir`** | `gemini-3.8-flash-tts` | 0 | Casual off-shift station crew member in the mess hall; wry morning greeting. |
| `crew_maint` | **Maintenance Tech** | `Crew` | **`Iapetus`** | `gemini-3.8-flash-tts` | 0 | Tired maintenance tech in the dive bay; practical, low-key warning. |
| `crew_crew_2` | **Commons bar man** | `Crew` *(unauthored)* | **`Umbriel`** | `gemini-3.8-flash-tts` | 0 — 6 lines recorded 2026-11-25 | 30s off-shift lab hand at the Commons bar; easygoing gossip who notices small odd things. Overheard talk only, spoken quietly. |
| `crew_bar_1` | **Commons bar woman** | `Crew` *(unauthored)* | **`Autonoe`** | `gemini-3.8-flash-tts` | 0 — 6 lines recorded 2026-11-25 | 30s off-shift crew at the Commons bar; dry, unbothered, quick to brush things off. Overheard talk only, spoken quietly. |
| `crew_wall_1` | **Commons wall woman** | `Crew` *(unauthored)* | **`Vindemiatrix`** | `gemini-3.8-flash-tts` | 0 — 6 lines recorded 2026-11-25 | 40s station clerk leaning on the Commons wall; practical, mildly teasing, slow to grow uneasy. Overheard talk only, spoken quietly. |
| `crew_chat_5` | **Commons wall man** | `Crew` *(unauthored)* | **`Schedar`** | `gemini-3.8-flash-tts` | 0 — 6 lines recorded 2026-11-25 | 40s maintenance engineer standing in the Commons; tired, careful, worried by his readings. Overheard talk only, spoken quietly. |
| `radio_ops` | **Station Ops** | `Station Ops` | **`Zephyr`** | `gemini-3.8-flash-tts` | 0 | 30s station comms operator on the open channel during the blackout (station-power spec); clipped, professional, fraying. Radio only. |
| `radio_dock` | **Docking Ring** | `Docking Ring` | **`Algieba`** | `gemini-3.8-flash-tts` | 0 | Dock security guard calling in from the Docking Ring; out of breath, running, terrified. Radio only. |
| `radio_hydro` | **Hydroponics** | `Hydroponics` | **`Erinome`** | `gemini-3.8-flash-tts` | 0 | Young hydroponics tech hiding in the Grow Hall; crying, whispering. Radio only. |
| `radio_launch` | **Launch Hall** | `Launch Hall` | **`Sadaltager`** | `gemini-3.8-flash-tts` | 0 | Station diver in the Launch Hall shouting over rushing water; panicked, urgent. Radio only. |

Free-tier quota note: `gemini-2.5-flash-preview-tts` and `gemini-3.1-flash-tts-preview` each allow **10 requests a day** on this project's key (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, `limit: 10`, measured 2026-11-21); `gemini-2.5-pro-preview-tts` allows none. Empty and safety-blocked responses still count. One request covers a batch of up to 13 lines.

**3.8 two-speaker requests**: on 2026-11-25 `gemini-3.8-flash-tts` rejected a two-speaker request (HTTP 400, "Multi-speaker generation requests must specify speech_metadata.speaker for each text part"), which `vo-generate.ts` does not send. Record its speakers one per request: `--ids` already does, and `--mode all` needs `--no-pair`.

**2.5-flash retakes**: the long-pause retake note that stops 3.1 sighing makes 2.5-flash run on into minutes of silence, so 2.5-flash retakes use the plain note. Slow `dread` lines can still run away in a batch of 8; `--batch-size 4` worked. `vo-generate.ts` rejects any raw batch longer than `max(30 s, 8 s per line)` without writing clips (`<batch>.wav.rejected`).

### Subtitle name rule (`src/data/dialogue/speakers.json`)
- `DialogueLibrary.speaker(id)` looks up `src/data/dialogue/speakers.json` first and only falls back to cloning `speakers.crew` (`"name": "Crew"`) for unauthored `crew_*` IDs.
- Any named `crew_*` speaker whose name should appear in subtitles **must** have an explicit entry in `src/data/dialogue/speakers.json` (as done for `crew_cook` -> `"Bram"`). Keep the `crew_` prefix on the speaker ID so `npcIdForSpeaker()` in `src/ai/speakerBodies.ts` continues mapping `crew_<npcId>` to `<npcId>`.
- A new speaker also needs an entry in `scripts/lib/voCast.ts`; generating VO for a speaker without one fails with an error naming them, before any request.

## 3. Reference voice cast — non-verbal reactions (`scripts/vo-reactions.ts`)

Reaction batches live in `scripts/lib/voReactionBatches.ts`. Each names a speaker and takes that speaker's voice and pinned model from `voCast.ts`. Only TTS takes have a batch; credited recordings have none, so regenerating can never overwrite them.

| Batch | Character | Voice / model | TTS clips (`public/assets/vo/`) | Credited recordings (not TTS) | Dialogue lines wired |
| --- | --- | --- | --- | --- | --- |
| `react_jay_pain` | Jay (`player`) | `Orus` / 3.1 | `react_jay_pain_01`–`03.mp3` | `react_jay_scare_01`–`03.mp3` | `bark_grab_jay_01`, `bark_grab_jay_02`, `bark_scare_jay_01`, `bark_scare_jay_02` |
| — (no TTS batch) | Giles (`engineer`) | — | — | `react_giles_cry_01`–`03.mp3` (megaboots `3yell2`, `3yell6`, `3yell1`; a different performer from Jay's shouts) | none (`sec_giles_05` was cut by `overhaul-priya-r08-death`) |
| `react_priya_choke` | Priya (`nurse`) | `Sulafat` / 3.1 | `react_priya_choke_01`–`03.mp3` | `react_priya_scream_01`–`03.mp3`, `react_priya_cutoff_01`–`03.mp3` | `sec_priya_02`, `stinger_priya_03`, `sec_priya_03`, `sec_priya_06`, `sec_priya_07`, `stinger_priya_06` |
| `react_okafor_exhale` | Okafor's exhale and sniffle (`sec_okafor_22`), read by Jay's voice since it is not speech | `Orus` / 3.1 | `react_okafor_exhale_01.mp3` | — | `sec_okafor_22` |
| `react_voss_panic` | Voss (`crew_lab`) | `Leda` / 3.8 | `react_voss_panic_01`–`03.mp3` | `react_voss_scream_01`–`03.mp3` | `crew_lab_scream_01`, `drop_voss_02` (screams); `voss_panic_breath` sound (panic) |

## 4. Direction, emotes & pronunciation

- **Acting register**: Grounded AAA sci-fi horror game voice acting (*Alien: Isolation* / *SOMA* feel) — conversational, never theatrical or robotic. Per-line emotional direction comes from `EMOTE_HINT` in `scripts/vo-generate.ts`.
- **Pronunciation guide** (included in every TTS prompt):
  - `Thalassa` = *thuh-LASS-uh*
  - `Giles` = *Jiles* (soft G)
  - `Okafor` = *oh-KAH-for*
  - `Priya` = *PREE-yuh*
  - `Heins` = *Hynz*

## 5. Audio encoding & file conventions

- **Raw batch archive**: `previews/vo-batches/<batch>.wav` (24 kHz mono 16-bit PCM, gitignored). Keep raw WAVs during iteration so `--resplit` costs 0 API calls. They are also what `scripts/vo-trace.ts` reads, so don't delete them. Batch names repeat, so a new recording first moves the old one to `previews/vo-batches/older/<batch>.<file time>.wav`; the plain name is always the newest. A bad cut can only be redone from its recording, and these exist on one PC.
- **Staging**: new clips are written to `previews/vo-staging/` and reach `public/assets/vo/` only after the word check in §8. A held clip waits there with a `.json` note of what was heard.
- **Shipped VO clips**: `public/assets/vo/<line_id>.mp3`
  - Format: mono (`-ac 1`), `24000 Hz`, `64 kbps` MP3
  - Filter chain: `highpass=f=75`, `12 ms` fade-in, `35 ms` fade-out, `loudnorm=I=-16:TP=-1.5:LRA=11`
- **Manifest**: Each line in `src/data/dialogue/*.json` points to `"audio": "assets/vo/<line_id>.mp3"` (or a string array for reaction pools).
- **Generation record**: `scripts/vo-takes.json` (tracked in git). Every generated batch appends its batch name, speakers, voices, model, clip IDs and time. `--resplit` adds nothing, because it makes no new audio. A held clip is left out until `--accept` ships it, and `vo-recut.ts` adds nothing. Entries with `"source": "traced"` were reconstructed by `vo-trace.ts` for clips made before the record existed.
- **Silence / sigh hygiene**: `gemini-3.1-flash-tts-preview` occasionally inserts long 1–2 s sighs or pauses on `laugh` / `relieved` lines. Always listen to flagged clips (`<-- CHECK`) and trim dead air before shipping.

## 6. Commands

Call Node directly (avoid `npm run vo:generate -- ...` in Windows PowerShell 5.1, which strips `--` and causes the script to fall back to `--mode audition`). The model always comes from `voCast.ts`.

```bash
# Generate or retake specific line IDs on each speaker's pinned model
node --experimental-strip-types scripts/vo-generate.ts --ids <id1,id2> --apply

# Every line that has no clip yet
node --experimental-strip-types scripts/vo-generate.ts --mode all --apply

# Re-split saved raw WAVs without making API calls
node --experimental-strip-types scripts/vo-generate.ts --ids <id1,id2> --resplit --apply

# Ship held clips after listening to them (--apply also wires their dialogue lines)
node --experimental-strip-types scripts/vo-generate.ts --accept <id1,id2> --apply

# Check shipped clips against their subtitles (all spoken lines, or only the ids given); changes nothing
node --experimental-strip-types scripts/vo-check.ts <id1> <id2>

# Re-cut clips from audio already on disk, as scripts/vo-recuts.json says (no API calls); --dry-run lists the spans
node --experimental-strip-types scripts/vo-recut.ts --only <id1,id2>

# Preview planned batches, with each batch's voices and model, without calling the API
node --experimental-strip-types scripts/vo-generate.ts --mode all --dry-run

# Regenerate one reaction batch (add --dry-run to see its voice, model and takes first)
node --experimental-strip-types scripts/vo-reactions.ts --only <batch> --apply

# One request per take (3.1 breaks multi-take reaction batches into bursts the splitter cannot regroup);
# --only then also accepts single take ids, to redo one bad take
node --experimental-strip-types scripts/vo-reactions.ts --only <batch-or-take-id> --per-take --apply

# Report which model made each clip and list every clip off its speaker's model
node --experimental-strip-types scripts/vo-trace.ts
```

## 7. Tracing which model made a clip

Each Gemini TTS model returns PCM in fixed-size chunks, so a raw batch WAV's sample count (data bytes / 2) divided by 480 leaves a remainder that identifies the model:

| Remainder | Model | Confirmed by |
| --- | --- | --- |
| 263 | `gemini-2.5-flash-preview-tts` | one-line probe, 2026-11-21 |
| 0 | `gemini-3.1-flash-tts-preview` | every logged 3.1 retake |
| 14 | `gemini-3.8-flash-tts` | logged reaction run |

Shipped MP3s are re-encoded and lose the signature. `scripts/vo-trace.ts` links each clip to its batch WAV by file time instead (the generators write every clip within about a second of its WAV), and infers the model of clips whose WAV was later overwritten from the surviving WAVs on either side. It flags, rather than guesses, any clip it can't place. Clips already in `vo-takes.json` are reported from the record and not traced again, because a newer batch with the same name may have overwritten the WAV they came from. `--write` adds entries only for clips the record doesn't cover yet; `--retrace` ignores the record and traces every clip from the WAVs.

For a new model, measure its signature with a one-line request before relying on it, and add it to `MODEL_SIGNATURES` in `scripts/lib/voTrace.ts`.

## 8. Verify after recording

### The word check

A batch is cut apart at its pauses, and a cut can land inside a line, giving one clip two lines and another half of one. So `vo-generate.ts` and `vo-recut.ts` transcribe each new clip on this machine and compare it with its subtitle (`scripts/lib/voCompare.ts`). Nothing is sent anywhere.

**Setup (once per machine):**

1. An ffmpeg build with the `whisper` filter (`ffmpeg -filters` lists it; the gyan.dev "full" Windows build has it).
2. The whisper.cpp model `ggml-base.en.bin` (about 150 MB) from `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin`, saved as `previews/models/ggml-base.en.bin` (gitignored). `VO_STT_MODEL` names a model file elsewhere.

Without them clips ship as before, and the run lists each one as **UNCHECKED**.

**Held clips.** A clip with a phrase missing or added stays in `previews/vo-staging/`; the shipped clip and the dialogue entry do not change. The run prints what was heard. Listen to the staged file, then either ship it with `--accept` (§6) or retake the line on its own (`--ids <id>`): a one-line take has no cut to get wrong. `--mode all` leaves held lines alone.

**Limits.** The small model mishears names and numbers and can drop a short exclamation ("Hey- hey!", "Traitor."), so a held clip is often fine. A missing or added word of under six letters can pass unless it belongs to the neighbouring line. Screams, gasps and `react_*` takes are not checked. A pass is not a listen.

### Also

- Listen to every `<-- CHECK` flagged clip and spot-check each re-recorded speaker against an existing clip on the same model from the same scene.
- Run `node --experimental-strip-types scripts/vo-trace.ts` and confirm the speaker no longer appears under "NOT ON THEIR SPEAKER'S PINNED MODEL"; then update the "Off-model clips" column in §2.
- Run `npm run typecheck` and `npm test -- scripts/lib/voCast.test.ts scripts/lib/voTts.test.ts scripts/lib/voBatches.test.ts scripts/lib/voReactionBatches.test.ts scripts/lib/voTakes.test.ts scripts/lib/voTrace.test.ts scripts/lib/voArchive.test.ts scripts/lib/voCompare.test.ts scripts/lib/voGate.test.ts scripts/lib/voRecut.test.ts`.

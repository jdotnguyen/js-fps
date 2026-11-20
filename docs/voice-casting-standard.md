# Voice Casting & Reference Voices Spec

> Canonical reference voice cast, model-pinning rules, audio specs, and backtrack re-recording tracker for Thalassa dialogue and vocal reactions.
> Companion to the [voice-playback spec](../openspec/specs/voice-playback/spec.md) (how lines sound in game) and [characters.md](characters.md) (character bible). Adding other sounds: [audio-assets.md](audio-assets.md).
> Source of truth in code: `scripts/vo-generate.ts`, `scripts/vo-reactions.ts`, `src/data/dialogue/speakers.json`.

## 1. Critical consistency rules (do not mix providers or TTS models)

| Asset class | Provider | Generator script(s) | Env var |
| --- | --- | --- | --- |
| Character dialogue VO (`public/assets/vo/*.mp3`) | **Gemini TTS** | `scripts/vo-generate.ts` | `GEMINI_API_KEY` |
| Non-verbal vocal reactions (screams, gasps, grunts) | **Gemini TTS** | `scripts/vo-reactions.ts` | `GEMINI_API_KEY` |
| Environmental ambience, doors, footsteps SFX | **ElevenLabs SFX** | `scripts/ambience-generate.ts`, `scripts/doors-generate.ts`, `scripts/footsteps-generate.ts` | `ELEVENLABS_API_KEY` |

1. **Never mix providers for a character**: Do not use ElevenLabs TTS for individual dialogue lines unless intentionally recasting and re-recording every line for that character.
2. **Never mix Gemini TTS models for a character**: Even with the **exact same prebuilt voice name** (`Algenib`, `Charon`, `Enceladus`, etc.), different Gemini TTS models (`gemini-2.5-flash-preview-tts` / `gemini-2.5-pro-preview-tts` vs. `gemini-3.1-flash-tts-preview` vs. `gemini-3.8-flash-tts`) render noticeably different actor timbres and deliveries.
3. **Always pin `--models <single-model>`** when recording or retaking lines so quota fallbacks in `scripts/vo-generate.ts` never silently switch models mid-cast.
4. **Target model going forward**: **`gemini-3.1-flash-tts-preview`** (used for Bram's full set `intro_cook_01`–`04`). Older clips from the initial bulk pass will need to be redone on one pinned model for full-cast consistency (§7).

## 2. Reference voice cast — dialogue (Gemini TTS)

Every speaker ID in `src/data/dialogue/*.json` (243 total lines: 233 spoken VO clips + 10 reaction pools) maps to one locked Gemini prebuilt voice (`prebuiltVoiceConfig.voiceName`).

| Speaker ID | Character | Subtitle name (`speakers.json`) | Gemini voice | Lines (VO / pools) | Reference clip(s) | Current status | Acting profile |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `crew_cook` | **Bram** | `Bram` | **`Enceladus`** | 4 / 0 | `intro_cook_01.mp3`–`04.mp3` | **Consistent** (`gemini-3.1-flash-tts-preview`) | 45, dry deadpan station cook; raspy, tired, wry humour. |
| `engineer` | **August Giles** | `Giles` | **`Algenib`** | 84 / 1 | `intro_giles_02.mp3` (legacy), `intro_giles_15.mp3`–`16.mp3` (`3.1`) | **Mixed** (`15`–`16` on `3.1`; rest legacy — redo later) | 42, weathered deep-sea systems engineer; blue-collar, gravelly warmth, wry dry humour hiding exhaustion and nerves. |
| `medic` | **Dr. Tomas Okafor** | `Okafor` | **`Charon`** | 72 / 0 | `intro_okafor_06.mp3` (legacy), `intro_okafor_10.mp3`–`11.mp3` (`3.1`) | **Mixed** (`10`–`11` on `3.1`; rest legacy — redo later) | 50s, deep warm calm trauma surgeon; disciplined, measured authority; drops quiet when genuinely afraid. |
| `player` | **Jay** | `Jay` | **`Orus`** | 20 / 4 | `intro_jay_05.mp3` | **Legacy** (redo later) | 30s, steady grounded station security officer; kind, attentive, conversational lower-mid male voice. |
| `nurse` | **Priya Anand** | `Priya` | **`Sulafat`** | 12 / 3 | `intro_priya_01.mp3`, `intro_priya_06.mp3` | **Legacy** (redo later) | 29, warm cheerful sharp medical nurse; friendly, competent, affectionate teasing with coworkers. |
| `chief` | **Katie Heins** | `Heins` | **`Kore`** | 11 / 0 | `brief_heins_01.mp3` | **Legacy** (redo later) | 38, no-nonsense security chief; crisp, brisk, firm, slightly annoyed by corporate secrecy. |
| `director` | **Director Hale** | `Director Hale` | **`Rasalgethi`** | 8 / 0 | `brief_hale_01.mp3` | **Legacy** (redo later) | 48, smooth polished corporate station administrator; calm and rehearsed on intercom, clipped and nervous under stress. |
| `pa` | **Station PA** | `Station PA` | **`Gacrux`** | 4 / 0 | `pa_quarantine_01.mp3` | **Legacy** (redo later) | TAG Industries automated station PA; smooth, mature, calm, overly polite, detached retro-corporate announcement. |
| `crew_sung` | **Sung** | `Crew` *(unauthored)* | **`Achird`** | 6 / 0 | `intro_sung_02.mp3` | **Legacy** (redo later) | 30, friendly station diver returning from shore leave; warm, easygoing. |
| `crew_botanist` | **Wen (Botanist)** | `Crew` *(unauthored)* | **`Puck`** | 5 / 0 | `hydro_botanist_01.mp3` | **Legacy** (redo later) | Station hydroponics botanist; conversational, dryly amused, slightly exasperated. |
| `crew_lab` | **Dr. Lena Voss** | `Crew` *(unauthored)* | **`Leda`** | 1 / 2 | `drop_voss_01.mp3` | **Legacy** (redo later) | 34, sharp anxious microbiologist; terrified and pleading when infected. |
| `crew_ruiz` | **Ines Ruiz** | `Crew` *(unauthored)* | **`Aoede`** | 2 / 0 | `intro_ruiz_01.mp3` | **Legacy** (redo later) | 30s, relaxed breezy comms technician; friendly morning banter. |
| `crew_assistant` | **Hale's Assistant** | `Crew` *(unauthored)* | **`Despina`** | 2 / 0 | `admin_assistant_01.mp3` | **Legacy** (redo later) | Director Hale's administrative assistant; quiet, tense, anxious around corporate secrets. |
| `crew_mess` | **Mess Crew** | `Crew` | **`Fenrir`** | 1 / 0 | `crew_mess_greeting_01.mp3` | **Legacy** (redo later) | Casual off-shift station crew member in the mess hall; wry morning greeting. |
| `crew_maint` | **Maintenance Tech** | `Crew` | **`Iapetus`** | 1 / 0 | `dive_maint_01.mp3` | **Legacy** (redo later) | Tired maintenance tech in the dive bay; practical, low-key warning. |
| `crew_dock_guard` | **Dock Guard** | `Guard` | **`Alnilam`** | 9 / 0 | none yet | **Not recorded** (dock-checkpoint) | 40s, dock security guard who has scanned the same crew every morning for years; patient, dry, warm under the routine. |

### Subtitle name rule (`src/data/dialogue/speakers.json`)
- `DialogueLibrary.speaker(id)` looks up `src/data/dialogue/speakers.json` first and only falls back to cloning `speakers.crew` (`"name": "Crew"`) for unauthored `crew_*` IDs.
- Any named `crew_*` speaker whose name should appear in subtitles **must** have an explicit entry in `src/data/dialogue/speakers.json` (as done for `crew_cook` -> `"Bram"`). Keep the `crew_` prefix on the speaker ID so `npcIdForSpeaker()` in `src/ai/speakerBodies.ts` continues mapping `crew_<npcId>` to `<npcId>`.

## 3. Reference voice cast — non-verbal reactions (`scripts/vo-reactions.ts`)

10 dialogue lines use 3-variant reaction pools generated with each character's locked Gemini voice:

| Batch | Character | Gemini voice | Clips (`public/assets/vo/`) | Dialogue lines wired |
| --- | --- | --- | --- | --- |
| `react_jay_male` | Jay (`player`) | **`Orus`** | `react_jay_scare_01`–`03.mp3`, `react_jay_pain_01`–`03.mp3` | `bark_grab_jay_01`, `bark_grab_jay_02`, `bark_scare_jay_01`, `bark_scare_jay_02` |
| `react_giles_male` | Giles (`engineer`) | **`Algenib`** | `react_giles_cry_01`–`03.mp3` | `sec_giles_05` |
| `react_priya_female` | Priya (`nurse`) | **`Sulafat`** | `react_priya_scream_01`–`03.mp3`, `react_priya_choke_01`–`02.mp3` | `sec_priya_02`, `stinger_priya_03`, `sec_priya_03` |
| `react_voss_female` | Voss (`crew_lab`) | **`Leda`** | `react_voss_scream_01`–`03.mp3` | `crew_lab_scream_01`, `drop_voss_02` |

## 4. Direction, emotes & pronunciation

- **Acting register**: Grounded AAA sci-fi horror game voice acting (*Alien: Isolation* / *SOMA* feel) — conversational, never theatrical or robotic. Per-line emotional direction comes from `EMOTE_HINT` in `scripts/vo-generate.ts`.
- **Pronunciation guide** (included in every TTS prompt):
  - `Thalassa` = *thuh-LASS-uh*
  - `Giles` = *Jiles* (soft G)
  - `Okafor` = *oh-KAH-for*
  - `Priya` = *PREE-yuh*
  - `Heins` = *Hynz*

## 5. Audio encoding & file conventions

- **Raw batch archive**: `previews/vo-batches/<batch>.wav` (24 kHz mono 16-bit PCM, gitignored). Keep raw WAVs during iteration so `--resplit` costs 0 API calls.
- **Shipped VO clips**: `public/assets/vo/<line_id>.mp3`
  - Format: mono (`-ac 1`), `24000 Hz`, `64 kbps` MP3
  - Filter chain: `highpass=f=75`, `12 ms` fade-in, `35 ms` fade-out, `loudnorm=I=-16:TP=-1.5:LRA=11`
- **Manifest**: Each line in `src/data/dialogue/*.json` points to `"audio": "assets/vo/<line_id>.mp3"` (or a string array for reaction pools).
- **Silence / sigh hygiene**: `gemini-3.1-flash-tts-preview` occasionally inserts long 1–2 s sighs or pauses on `laugh` / `relieved` lines. Always listen to flagged clips (`<-- CHECK`) and trim dead air before shipping.

## 6. Commands

Call Node directly (avoid `npm run vo:generate -- ...` in Windows PowerShell 5.1, which strips `--` and causes the script to fall back to `--mode audition`):

```bash
# Generate or retake specific line IDs pinned to one model
node --experimental-strip-types scripts/vo-generate.ts \
  --ids <id1,id2> \
  --models gemini-3.1-flash-tts-preview \
  --apply

# Re-split saved raw WAVs without making API calls
node --experimental-strip-types scripts/vo-generate.ts --ids <id1,id2> --resplit --apply

# Preview planned batches without calling the API
node --experimental-strip-types scripts/vo-generate.ts --mode all --dry-run
```

## 7. Backtrack plan: re-recording all previous voices later

When ready to unify the entire cast onto one pinned Gemini TTS model (so zero characters switch voices mid-scene):

1. **Choose and pin one model** (currently `gemini-3.1-flash-tts-preview`) in both `scripts/vo-generate.ts` and `scripts/vo-reactions.ts` — disable multi-model fallback or pass `--models <pinned-model>` explicitly so quota limits pause instead of switching models mid-cast.
2. **Re-record remaining speakers** (skipping `crew_cook`, which is already consistent on `gemini-3.1-flash-tts-preview`, unless moving to a newer model):
   - Priority 1 (currently mixed mid-scene): `engineer` (84 lines, `Algenib`), `medic` (72 lines, `Charon`).
   - Priority 2 (legacy pass): `player` (20, `Orus`), `nurse` (12, `Sulafat`), `chief` (11, `Kore`), `director` (8, `Rasalgethi`), `crew_sung` (6, `Achird`), `crew_botanist` (5, `Puck`), `pa` (4, `Gacrux`), `crew_ruiz` (2, `Aoede`), `crew_assistant` (2, `Despina`), `crew_lab` (1, `Leda`), `crew_mess` (1, `Fenrir`), `crew_maint` (1, `Iapetus`).
   - Priority 3 (reaction pools): re-run `node --experimental-strip-types scripts/vo-reactions.ts --apply` on the same pinned model.
3. **Optional full force-rerun command** (once ready to overwrite all 233 spoken clips in one unified pass):
   ```bash
   node --experimental-strip-types scripts/vo-generate.ts \
     --mode all --force --no-pair \
     --models gemini-3.1-flash-tts-preview \
     --apply
   ```
4. **Verify**:
   - Audit every `<-- CHECK` flagged clip and spot-check each character across chapters (`slice01.json`, `slice01_action.json`, `slice01_rounds.json`, `barks01.json`).
   - Update the `Current status` column in §2 of this spec.
   - Run `npm run typecheck` and `node --experimental-strip-types --test "src/dialogue/*.test.ts" "src/script/intro.test.ts" "src/ai/speakerBodies.test.ts"`.

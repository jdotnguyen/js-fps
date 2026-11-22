# Design

## Context

See proposal.md (Why, Evidence) for how the cast came to be split across models. Constraints that shape the approach:

- `scripts/vo-generate.ts` holds the cast (`CAST`: label, voice, profile) and one shared `DEFAULT_MODELS` fallback list. When a model's quota runs out or it rejects a request, the script moves on to the next model. It also pairs small speakers into two-speaker batches to save quota.
- `scripts/vo-reactions.ts` repeats each speaker's voice in its own batch list and has its own fallback list, starting with `gemini-3.8-flash-lite-tts`.
- Shipped clips are re-encoded MP3s, which lose the sample-count signature. Only the raw WAVs in `previews/vo-batches/` (gitignored) show which model made a batch, and those WAVs don't record their line IDs.
- On this key's free tier, `gemini-2.5-flash-preview-tts` and `gemini-3.1-flash-tts-preview` each allow 10 requests a day (measured 2026-11-21), and `gemini-2.5-pro-preview-tts` allows none.
- 2.5-flash runs away (minutes of silence, or stops after one line) when given the long-pause retake note written for 3.1, and sometimes on slow `dread` batches of 8. Retakes on 2.5-flash use the plain note, smaller batches, and a runaway guard that rejects a raw batch longer than `max(30 s, 8 s per line)` before any clip is written.

## Goals / Non-Goals

**Goals:**
- One source of truth for each speaker's voice and model, which both generators read.
- A run can never produce a clip on a model other than the speaker's pinned one.
- Any clip's model can be looked up from committed data.

**Non-Goals:**
- Unifying the whole cast on one model. The decided reference models keep three models in use.
- Changing runtime playback. The game only reads `audio` paths, so nothing under `src/` that plays audio changes.
- Re-recording lines that are already on their speaker's reference model, even old ones.

## Decisions

### Speaker reference models

| Model | Speakers |
| --- | --- |
| `gemini-2.5-flash-preview-tts` | `engineer`, `medic` |
| `gemini-3.1-flash-tts-preview` | `player`, `nurse`, `crew_cook`, `chief`, `director`, `pa`, `crew_ruiz`, `crew_sung`, `crew_botanist`, `crew_dock_guard` |
| `gemini-3.8-flash-tts` | `crew_mess`, `crew_maint`, `crew_assistant`, `crew_lab` |

Giles and Okafor follow the user's ear: their first batch is the reference. Jay and Priya go to 3.1 because most of their dialogue is already there. The 3.8 speakers keep 3.8 because each one is already consistent.

### Cast data moves to a shared module

Move the cast into `scripts/lib/voCast.ts`, holding each speaker's label, voice, model and profile. Both generators import it, and the reaction batches name a speaker ID instead of repeating a voice. A missing `model` fails type-checking, and a speaker ID with no entry throws an error naming that speaker before any request is sent.

*Alternatives:* adding `model` to `src/data/dialogue/speakers.json` would mix generation-only data into game runtime data that the browser loads. Keeping two copies of the cast, as today, is how the reactions ended up on their own model list.

### No fallback; `--models` is removed

Each batch is sent only to its speakers' model. A 429 that is per-minute keeps the existing wait-and-retry on the same model. A daily-quota 429, or a 400/403/404, marks that batch as failed and skips the rest of that speaker's batches. Other speakers continue, and the run ends with a non-zero exit and a list of the batches that weren't made. The `--models` flag is removed rather than kept as an override, because an override is exactly how the cast split.

*Alternative:* keep `--models` as a deliberate recast tool. Rejected, because recasting a speaker means changing their cast entry, which then shows up in review.

### Pairing only within one model

Two-speaker batches only pair speakers with the same model. This matters for `crew_ruiz` (3.1) and `crew_assistant` (3.8), which today's grouping would put in one batch. Any speaker left unpaired gets its own batch.

### Committed generation record

Each generated batch appends an entry to `scripts/vo-takes.json`: batch name, speaker IDs, voice, model, line IDs and an ISO timestamp. Each line maps to its latest entry. `--resplit` doesn't add entries, because it makes no new audio. The file is tracked in git, unlike the WAVs.

### Finding which line came from which old batch

The WAVs don't record their line IDs, so the old 11-19 batches need mapping before re-recording. A read-only script (`scripts/vo-trace.ts`) uses file times. The generator encodes every clip within about a second of saving its batch WAV, so a clip whose MP3 was written within 3 s after a WAV that includes its speaker is a **direct** match. The model then comes from that WAV's sample-count signature.

Some clips came from WAVs that a later run with the same batch name overwrote, or were re-cut from an older WAV. For those, the model is **inferred** from the surviving WAVs just before and after the clip's time: a run moves through models in one direction, so if both neighbours agree, the clip's lost batch was on that model too. A clip is flagged rather than guessed when its neighbours disagree, either neighbour is missing, or either is more than 30 minutes away. Its output seeds `vo-takes.json` for the existing clips. For Jay and Priya, a flagged line is cheap to just re-record on 3.1. For Giles and Okafor, a flagged line goes to the user to listen to, since re-recording on 2.5-flash would replace a take they like.

*Alternatives:* matching MP3 durations against WAV segments works for one batch (lengths agree to about 5 ms), but a single segment matches other WAVs by chance too often without knowing each batch's lines. Re-recording all of Giles's and Okafor's dialogue on 2.5-flash was rejected: it uses about a day's quota and throws away the group-A takes that are the reference.

## Risks / Trade-offs

- [2.5-flash is a preview model and could be retired] → Pinning stops the run instead of silently switching models. A retirement then becomes a deliberate recast of Giles and Okafor, recorded in the cast module.
- [A new 2.5-flash take can still differ from the 11-19 takes in delivery, even on the same model] → Listen to each new Giles and Okafor clip next to a group-A clip from the same scene before shipping it.
- [The duration match could mislabel a line when neighbouring lines have similar lengths] → Match in batch order, not by duration alone, and flag ties.
- [The daily quota cuts a run short] → Batches fail without side effects and the run lists them, so the next day's run picks up only those IDs.

## Migration Plan

1. Land the cast module, the no-fallback generators and `vo-trace.ts`. These are tooling only, and the game is unaffected.
2. Run `vo-trace.ts` and commit `vo-takes.json` for the existing clips.
3. Record in order: the 11 missing lines, then the Giles and Okafor 2.5-flash retakes (spread over days if the quota requires), then the Jay and Priya 3.1 retakes and reactions.
4. To roll back, the previous MP3s are in git: `git checkout` restores any clip.

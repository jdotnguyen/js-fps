# ADR-0010: Dialogue, vocal emotes and hints

Status: Accepted (non-verbal voices, silent player) / Proposed (synth details)

## Context
Teammates talk and give audible hints when the player is stuck [Decided]. Voices are
**non-verbal mood sounds plus subtitles**, in the style of Zelda's emotive grunts and gasps,
not real or synthesized speech [Decided]. Real voice files may override lines later
[Decided: hybrid]. The player is silent in this slice; dialogue choices come later and must
not appear in the slice [Decided].

## Decision
All lines live in `data/dialogue/<chapter>.json`. Each line has subtitle text and an
**emote**. A procedural vocal synth plays a short emote in the speaker's voice. No Web
Speech API. Because everything is Web Audio, radio and positional filters work for real.

## Details

### Line format
```json
{ "id": "giles_cover_01", "speaker": "engineer", "text": "Cover me, I'll get this open!",
  "emote": "urgent", "babble": false, "channel": "local", "priority": "story",
  "audio": null, "minDuration": 1.5, "choices": [] }
```
- `emote`: see the emote set below. Required unless `audio` is set.
- `babble`: optional syllable stream for the whole line (Animal Crossing style).
  Off by default [Assumed]; a global setting can turn it on.
- `channel`: `local` (positional, from the NPC) or `radio` (over comms, filtered).
- `priority`: `story` > `hint` > `combat` > `idle`. Higher interrupts lower; equal queues;
  `combat`/`idle` are dropped if they would wait more than 2 s.
- `choices`: reserved for the future dialogue-choice system; must be empty in the slice
  (the validator fails the build if not).
- Subtitle duration: max(minDuration, 0.35 s per word + 0.8 s).

### Emote set [Assumed]
| Emote | Sound | Typical use |
|---|---|---|
| `neutral` | short closed "hm" | statements |
| `question` | rising "hm?" | asking, wondering |
| `urgent` | sharp "hey!" | commands, "cover me" |
| `alarmed` | gasp | spotting enemies, reveals |
| `pained` | grunt | hit, downed |
| `relieved` | exhale/sigh | after fights |
| `laugh` | short huff | banter |
| `whisper` | breathy murmur | quiet moments |
| `dread` | low shaky exhale | horror beats |
| `scream` | long cry | set pieces only |

### Vocal synth (`dialogue/vocalSynth.ts`)
- Source: band-limited pulse wave (glottal) at pitch f0 + filtered noise for breath.
- Three parallel band-pass formant filters (F1-F3) moving between vowel targets
  (a, e, o, u, m) per emote; then a gentle saturator and the speaker's EQ.
- Per-emote pitch contour (rising, falling, sharp attack, tremolo for `dread`) and
  amplitude envelope; duration 0.2-0.9 s.
- Deterministic variation seeded by line ID: the same line always sounds the same, but
  repeated emotes are not identical.
- Babble mode: one 60-90 ms syllable per 1-2 letters of text, random vowels, pitch drift.

### Speaker voice profiles (`data/dialogue/speakers.json`)
| Speaker | Placeholder name | f0 | Character |
|---|---|---|---|
| `engineer` | August Giles | ~210 Hz | brighter formants, quick attacks |
| `medic` | Dr. Tomas Okafor | ~115 Hz | warm, slower, calm |
| `pa` | Station PA | n/a | flat chime + text only, radio filter |
| `crew_*` | Various | random | seeded profiles |
| `infected` | n/a | detuned | distorted, used in transformations |
- **Giles foreshadowing** [Assumed]: after foreshadow beat 2 (ADR-0014) his profile gains a
  faint rasp that increases slightly through the slice.

### Channels
- `local`: HRTF `PannerNode` at the speaker's head.
- `radio`: band-pass 300-3400 Hz -> waveshaper -> compressor, squelch click at start and end,
  low static bed.

### Real audio (later, per line)
- If `audio` is set (or `public/assets/vo/<id>.mp3` is in the manifest), the file plays
  instead of the emote, through the same channel chain.
- `npm run vo:export` writes a CSV (id, speaker, emote, text) for recording or TTS.

### Hint system
- Objectives in `data/objectives.json` define `hints: [tier1LineId, tier2LineId]` and a
  target (position, interactable or room).
- "Stuck" = objective active longer than the difficulty `hintDelay` and no progress events
  (no >3 m improvement in distance to the target over 20 s, no relevant interaction).
- Tier 1: a vague hint line. Tier 2: an explicit hint + automatic nav pulse (ADR-0012).
- Hints never fire during combat or over a story line.

### Combat barks
- Event-driven: `enemy:spotted`, `enemy:limbSevered`, `player:grabbed`, `player:downed`,
  `squad:reloading`, `squad:downed`, `medic:downed`, `player:lowHealth`. Pools of lines,
  per-bark cooldown 8-15 s, global cooldown 3 s.
- Teaching barks early: shooting torsos triggers "Legs! Take its legs!".

## Consequences
- Subtitles carry all meaning, so they default on and the setting warns when turned off.
- No dependence on browser voices: the game sounds the same on every machine.

## Alternatives rejected
- Web Speech API: uneven across browsers, cannot be filtered, breaks the horror tone.
- Text only: loses the "audible hints" decision.

## Execution steps
1. Line and speaker loaders, types and validation.
2. Vocal synth with emote set and speaker profiles; a debug page to audition all emotes.
3. Speech manager (priority queue, interruption, subtitle events) and channels.
4. Bark system.
5. Objectives + hint system.
6. File override path and VO export script.

## Definition of done
- Every emote is recognisable by mood without subtitles for both squadmates.
- A story line interrupts a combat bark; a hint fires after the delay, never during combat.

## Open questions
- Final names and personalities of the squadmates.

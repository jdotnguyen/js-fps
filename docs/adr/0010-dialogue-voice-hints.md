# ADR-0010: Dialogue, vocal emotes and hints

Status: Accepted (non-verbal voices; player speaks, see amendment) / Proposed (synth details)

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

## Progress
In progress on 2026-11-15 (branch `adr/0010-dialogue`, worktree `.worktrees/adr-0010`): steps 1-3.
- Step 1: `data/types/dialogue.ts` (line, chapter and speaker validators; `choices` must be
  empty), `dialogue/library.ts` (cross-file checks, `crew_*` seeded voices, subtitle duration),
  `data/dialogue/speakers.json`, placeholder `data/dialogue/slice01.json` (lines quoted in
  ADR-0014 plus a few stand-ins; ADR-0014 writing replaces them).
- Step 2: `dialogue/vocalSynth.ts` (offline source-filter synth, all 10 emotes, babble, PA
  chime, rasp override), `npm run voice:preview` (WAVs + spectrogram sheet in
  `previews/voice/`), debug page `/voices.html` in dev.
- Step 3: `dialogue/speech.ts` (priority queue, interruption, 2 s drop rule, `speech:*` and
  `subtitle:show/hide` events), `dialogue/voicePlayer.ts` (local HRTF + radio chain with
  squelch and static). Not wired into `game.ts`/`main.ts` yet, on purpose (parallel ADRs).
- Verified: typecheck, all Node tests (story interrupts combat is a test), page click-through
  in a stubbed DOM. Not yet verified by ear: "every emote recognisable by mood" needs Justin.
- Known gaps: no reverb send for local voices (engine's reverb input is private; add a
  public send when ADR-0013 room switching lands); real VO files (step 6) fall back to
  `neutral`; babble is a manager flag until ADR-0012 adds the setting; voices keep playing
  under the pause menu (ADR-0012 should call `stopAll` or duck the voice bus).

## Amendment (2026-11-16): Jay speaks
- **The player, Jay, now speaks** [Decided], reversing "the player is silent in this slice".
  Full lines in the on-rails scenes (intro ADR-0017, briefing ADR-0023): friendly, warm, kind
  banter. Elsewhere in the slice he only makes reaction sounds ("Ah!") at explosions and jump
  scares [Decided]. Lines in free-roam crew moments are [Open].
- Still **no dialogue choices** in the slice; they come after it [Decided].
- Jay's lines use the same format: subtitles (speaker label "Jay") plus non-verbal mood sounds
  in his own voice profile (`speaker: "player"`, a lower, calm timbre) [Assumed].

## Progress 2026-11-17: steps 4 and 5 (barks, hints), speech wired into the game
- `main.ts` now builds the SpeechManager + WebAudioVoicePlayer and a subtitle box
  (`ui/hud/subtitles.ts`, name in the speaker's colour, 2 lines, Subtitles setting); the game
  host gains `say`/`stopSpeech`, so sequence `say` steps speak in game (unknown ids warn).
  Squadmate lines are positional at their heads. Speech stops on title/restart.
- Barks `dialogue/barks.ts`: rules keyed by event, pools by id (`bark_<pool>_<n>` in
  `data/dialogue/barks01.json`), per-rule cooldown (8-40 s), 3 s global, chance rolls, never
  the same line twice, skipped (not queued) under story/hint lines, on rails or paused.
  Events: enemy:alerted/died/hit (severed -> limb bark; three torso hits in 6 s -> Okafor
  "Legs!"), squad:reloading/downed (the other one calls it)/up, squad:taskProgress,
  group:cleared, player:grabbed (+ Jay "Ah!", which skips the global cooldown),
  player:grabEscaped/downed/revived, player:lowAmmo/lowHealth (emitted by guidance),
  player:startled (Jay; sequences can `emit` it), idle barks after 75 s of quiet.
  50 barks; Jay has 4 reaction-only lines.
- Hints `dialogue/hints.ts`: per required objective, tiers from `objectives.json`; stuck clock
  runs only while free to act (not on rails/cutscene/tutorial/combat/paused/downed); tier k at
  d1 + k(d2-d1) (ADR-0008 hintDelay), last tier repeats every d2 and fires the nav pulse;
  progress (objective change, new room, 3 m closer than best, map download) resets the clock
  and steps back one tier (next variant). Waits out story and hint lines. 20 hint lines
  (Giles questions, Okafor statements; a test enforces it).
- Not verified by ear or in a browser. Assumed: "in combat" = any combat event in the last 8 s.

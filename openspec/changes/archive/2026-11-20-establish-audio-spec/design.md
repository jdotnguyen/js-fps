# Design

## Context

What the code does today (see proposal.md for why this change exists):

- `AudioEngine` has four buses (`ambience`, `sfx`, `ui`, `music`). They feed master, then the damage-muffle low-pass, then a limiter. A shared reverb send crossfades between per-room convolvers.
- `WebAudioVoicePlayer` builds its own `voice` gain node, wired straight to `master`. The local channel sends to `reverbIn`.
- Settings store only `masterVolume`. Pause ducking is `master × 0.45`, applied in `game.ts`.
- `SpeechManager` emits `speech:started` / `speech:ended`, and lines carry a priority (`idle < combat < hint < story`).
- `SAMPLE_URLS` in `sounds.ts` is the recorded-file registry. A sample with the same name as a `SOUND_SPECS` entry replaces it once decoded, and running loops upgrade through `onSampleLoaded`.
- The sequence `music` action has no host binding. The intro's two steps (`main_theme`, then `stop`) are skipped with a warning.
- A usage audit (Nov 20) found every `SOUND_SPECS` entry still referenced by code or content, and every file in `public/assets/audio/` referenced by the registry.

## Goals / Non-Goals

**Goals:**
- Make the code match the four specs, with the smallest change to each system.
- Retire the ADRs as a source of audio truth, without losing content the specs don't cover.

**Non-Goals:**
- Tension music, stingers and a threat-level system (a separate change; this one only gives it a music host to build on).
- Room-graph occlusion for sounds other than footsteps.
- Re-recording legacy VO onto the pinned model (tracked in `docs/voice-casting-standard.md` §7).
- Moving `SAMPLE_URLS` to JSON. The typed registry stays: names are checked at compile time.

## Decisions

### Voice becomes a fifth engine bus
`AudioEngine.buses` gains `voice`. `WebAudioVoicePlayer` takes that bus as its output, instead of creating a gain node on `master`. The `AudioOut.master` field becomes the voice bus in `main.ts`, so the player's internals don't change.
- *Alternative:* keep the player's private gain node and give it its own setter. Rejected: ducking, settings and pause would then need a second code path for voice.

### Volume settings scale the buses, not the master
New settings: `musicVolume`, `sfxVolume` and `voiceVolume`, each 0..1, default 1. Each bus's level = its base level (today's constants: ambience 1, sfx 1, ui 0.8, music 0.3, voice 1) × its setting. SFX scales `sfx`, `ambience` and `ui`. Master stays `masterVolume × pause factor`. Defaults of 1 mean existing players hear no change.
- *Alternative:* a separate ambience slider. Rejected for now: the spec asks for four sliders, and one can be added later without a spec conflict.

### Story ducking listens to speech events
The engine gets a `duck(amountDb, on)` helper that drives a separate gain stage, applied after the user's setting on `music` and `ambience`, with a time constant of about 0.15 s. `main.ts` subscribes to `speech:started` / `speech:ended`, and ducks only when the line's priority is `story`. `SpeechInfo` already carries `priority`. A counter of active story lines handles overlap lines (a PA plus squad talk): duck while the count is above zero.
- *Alternative:* sidechain compression on the voice signal. Rejected: it reacts to barks too, is harder to tune, and the spec wants ducking for story lines only.

### `music` host binds named tracks to MenuMusic
`gameHost` gets `music(id | null)`. `main_theme` maps to the existing "Pressure" theme, played at full level on the music bus regardless of game mode until stopped; `null` fades it out over about 2 s. Unknown ids are rejected by the sequence content check (the existing schema validation in `script/actions.ts` or the dialogue/sequence tests), naming the step. The tension-music change later adds more ids to the same map.
- *Alternative:* remove the two intro steps and reject `music` everywhere. Rejected: the intro was authored to open on the theme (ADR-0017 "the theme thins out to station sound").

### Pruning procedural sound is audit-driven
"Delete unused" means: remove a `SOUND_SPECS` entry only when no code, sequence or level references its name. Today's audit found none, so the task is a repeatable audit script (`scripts/audio-audit.ts`). It lists unreferenced procedural specs, unreferenced registry entries and unregistered files, and it runs in the test suite so dead entries fail CI. Fallbacks shadowed by a recording stay, as decided.
- *Alternative:* delete every procedural spec that has a recording. Rejected: that removes the fallback the spec requires.

### ADR retirement
ADR-0013 (audio) and ADR-0010 (dialogue, voice and hints) are deleted outright, as decided. For ADRs whose main topic is something else (0004, 0005, 0012, 0017, 0021, 0022, 0023, 0027), only the audio and voice paragraphs are removed and replaced with a one-line pointer to the relevant `openspec/specs/<capability>/` spec. `docs/adr/README.md` drops the two rows and links to `openspec/specs/`. Source comments citing "ADR-0013" or "ADR-0010" are changed to cite the spec.
- **Consequence to accept:** ADR-0010 also holds the speech-priority, bark and hint rules, which no spec covers yet. After deletion the code (`dialogue/speech.ts`, `barks.ts`, `hints.ts` and their tests) is the only record. A follow-up change can spec them as a `dialogue-flow` capability.

## Risks / Trade-offs

- [Bus volumes multiply with today's tuned constants, so a player at 100% hears exactly what they hear now; a later mix pass may want to change the base levels] → Keep base levels as named constants in one place.
- [Ducking stacks with pause ducking] → Both are multiplicative gain stages with time constants, so the result is smooth; verify by ear in the pause-during-story case.
- [The intro now starts music where it was silent before] → Listen to the intro; the `stop` step already fades it out where the scene wanted station sound.
- [Deleting ADR-0010 loses written rules for hints and barks] → Code and tests remain; the follow-up `dialogue-flow` spec is listed in tasks.

## Migration Plan

Settings gain new keys with defaults of 1, so saved settings without them load unchanged. There is no data migration. Rollback is a git revert.

## Open Questions

- Should dialogue keep playing at the paused level, or stop or pause with the menu? Today it continues at 45%. This doesn't change any task here and can be decided by ear.

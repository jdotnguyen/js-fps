# Proposal

## Why

Audio decisions are spread across ADR-0013, ADR-0010 and parts of ADRs 0004, 0005, 0012, 0017 and 0023, and the code has moved past most of them. Real voice acting replaced the non-verbal emotes, a TypeScript registry replaced the planned JSON manifest, and the ambience, door, footstep, zombie and radio systems shipped with no record. Nobody enforced the ADRs, so they now give wrong guidance. Specs become the one source of truth for audio, starting from what the game actually does today.

## What Changes

- Record current audio behaviour as specs: the mix graph, the asset registry and fallbacks, voice playback and in-world sound.
- **Decision: recorded audio is the default.** Procedural sounds are fallback-only. Existing fallbacks stay; procedural code that nothing plays is deleted. New and replacement SFX come from ElevenLabs over time.
- **Decision (reverses ADR-0010): dialogue is fully voiced** with Gemini TTS, one locked voice and one pinned model per character (`docs/voice-casting-standard.md`). The emote synth remains only as the fallback when a line's file is missing or fails to load.
- Add a dedicated `voice` bus. Music and ambience duck under story lines. Settings gain music, SFX and voice volume sliders next to master.
- Fix the settings text that still says teammates speak in non-verbal sounds.
- Stop silently dropping the sequence `music` step: it gets a host binding, or authored steps are removed.
- **Docs:** delete ADR-0013 and ADR-0010, and remove the audio content of the other ADRs. Point references at `openspec/specs/`.
- Out of scope: tension music (a separate change), per-room occlusion for sounds other than footsteps, heartbeat and breathing.

## Capabilities

### New Capabilities
- `audio-mix`: the Web Audio graph. Buses, master chain and limiter, damage muffle, pause and story ducking, room reverb switching, positional (HRTF) playback, occlusion, volume settings.
- `audio-assets`: how sounds are named, loaded and replaced. The recorded-sample registry, procedural fallback with hot upgrade, provider rules per asset class, credits.
- `voice-playback`: how dialogue lines sound. Voice files per line, local and radio channels, the fallback emote, voice casting consistency, the voice bus.
- `in-world-audio`: diegetic sound systems. Ambience presets and director, the TAG FM radio, door foley, footsteps, zombie vocalisations, weapon cue timing, sequence-driven `sfx`/`ambience`/`radio`/`music` steps.

### Modified Capabilities
- None (no specs exist yet).

## Impact

- Code: `src/audio/engine.ts` (voice bus, ducking), `src/dialogue/voicePlayer.ts` (route to the voice bus), `src/core/settings.ts` and `src/ui/menus/screens.ts` (sliders, subtitle text), `src/script/gameHost.ts` (`music` host), `src/audio/sounds.ts` (prune procedural specs nothing plays).
- Docs: `docs/adr/0013-audio.md` and `docs/adr/0010-dialogue-voice-hints.md` deleted; audio sections removed from ADRs 0004, 0005, 0012, 0017, 0021, 0022, 0023, 0027; `docs/adr/README.md` index and source comments that cite ADR-0013 or ADR-0010 updated.
- No new dependencies. `@fission-ai/openspec` is now a dev dependency.

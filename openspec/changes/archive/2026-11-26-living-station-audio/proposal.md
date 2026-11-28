# Proposal

## Why

While the Commons (`R02`) and Hydroponics (`R12a`–`R12e`) already feel alive with bespoke room beds, positional room-life foley, and overheard crew talk, most of `slice01`'s remaining 35 rooms still share generic fallback ambience (`hull_hum`, `office_hvac`, `dive_drip`), go silent between scripted beats, or play cheerful morning idle barks after the blackout. A unified full-station audio and ambient-speech pass gives every room a pure-fidelity acoustic identity, makes the inhabited morning shift feel genuinely busy, and sharpens the dread when the station falls quiet after the drop.

## What Changes

- **Per-room pure-fidelity ambience presets and room-life foley:** Replace generic `hull_hum`, `office_hvac`, and shared `dive_drip` assignments across Dock/Hub (`R01`, `R01w`, `R01a`, `R03`), Security/Armory (`R07`, `R07a`), Surgery (`R08b`), Power Bay (`R11`), Dive Bay (`R13a`, `R13c`, `R13e`), Admin Wing (`R14a`–`R14e`), and Transit Wing (`R15a`–`R16c`) with bespoke recorded ElevenLabs beds, room-specific one-shot palettes, and positional room-life foley (such as Admin office typing/phones/chairs, Security CRT/relay cues, and cold-storage compressors).
- **Station-phase reactive ambience:** Make `AmbienceDirector` and room-life foley react to the station's state (`morning`, `lockdown`, `blackout`) so work/crew beds and office activity stop at the drop, rooms shift to dead/failing acoustics under backup power, and horror cues (such as `distantMoan` in Dive Bay) never fire during the quiet morning half.
- **Multi-room overheard conversations and solo work snippets:** Generalize `OverheardDirector` and `data/overheard.json` from hardcoded `R02` to multi-room groups and solo ambient speakers across Admin (`R14a` Reception, `R14b` Open Office, `R14d` Boardroom), Hydroponics (`R12b` Grow Hall, `R12c` Seed Lab), Dive Bay (`R13b` Launch Hall, `R13e` Sample Store), and Docking Ring (`R01`), while preserving all existing Commons exchanges and stopping all living crew chatter at `drop_started`.
- **Ambient Station PA director:** Add periodic, non-blocking Station PA announcements played spatially from the station's `pa_speaker` wall grilles on `background` priority — routine TAG corporate and operational notices before the drop, and sparse degraded automated containment/fault warnings after the drop — with proximity-gated subtitles.
- **Phase- and room-aware squad and Jay commentary:** Gate the four existing cheerful `bark_idle_*` lines to pre-drop only, and add hushed post-drop idle barks plus contextual one-time remarks from Giles, Okafor, and Jay for morning rounds wings (`R01`, `R12`, `R13`, `R14`) and quiet post-drop side rooms (`R06`, `R07a`, `R08b`, `R16c`).
- **Additive only (non-goal):** Existing scripted story sequences, the blackout radio chatter, Priya's medical bay intercom arc, and existing combat/hint dialogue lines remain untouched.

## Capabilities

### New Capabilities

_(None — all behaviors extend existing audio and dialogue capabilities.)_

### Modified Capabilities

- `in-world-audio`: Expand room ambience presets to every room/zone, add station-phase reactive ambience and non-Commons room-life foley, generalize overheard exchanges to multiple rooms and solo ambient work snippets, and add periodic ambient Station PA announcements.
- `dialogue-channels`: Support `background`-priority Station PA announcements that yield to higher-priority speech without ducking or delaying idle timers, and gate idle/room commentary by station phase and room context.
- `voice-playback`: Gate subtitles for `background`-priority PA announcements to player proximity/earshot of the playing wall grille (keeping `story` PA subtitles station-wide), and extend the pinned voice cast for new ambient crew speakers.

## Impact

- **Audio & simulation code:** `src/audio/ambience.ts`, `src/audio/sounds.ts`, new room-activity/ambient-PA controllers under `src/audio/` and `src/ai/`, generalized `src/ai/overheard.ts`, `src/ai/speakerBodies.ts`, `src/dialogue/barks.ts`, `src/dialogue/speech.ts`, `src/dialogue/voicePlayer.ts`, and wiring in `src/app/session.ts`.
- **Level & dialogue data:** `src/data/levels/slice01.json` (per-room `atmosphere.ambience`, new NPC `chat` links and room-activity anchors), `src/data/overheard.json` + `src/data/types/overheard.ts`, new dialogue JSON files (`src/data/dialogue/`), `src/data/dialogue/barks01.json`, `src/data/dialogue/speakers.json`.
- **Assets & tooling:** `scripts/ambience-generate.ts` (new ElevenLabs beds, emitters, one-shots in `public/assets/audio/ambience/`), `scripts/lib/voCast.ts`, `docs/voice-casting-standard.md`, and Gemini TTS clips in `public/assets/vo/` verified with `scripts/vo-check.ts` and `scripts/vo-trace.ts`.
- **Memory (`runtime-memory` spec):** Adding bespoke stereo room beds increases decoded audio RAM by design (pure acoustic fidelity); steady-state decoded audio memory will be re-measured with `?slot=scratch&memprobe` and recorded in `design.md`.

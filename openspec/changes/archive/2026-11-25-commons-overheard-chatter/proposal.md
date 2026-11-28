# Proposal

## Why

The Commons is the busiest room before the Observation Gallery drop, and its crew are silent. Background conversations move mouths and gesture with no sound, and the room bed was generated with no voices, so a full lounge has only air, creaks and the radio. Giving these people voices is the first step in making the station feel lived in before it goes wrong.

## What Changes

- Two seated or standing pairs in the Commons (the bar and the wall) get short, voiced, overheard exchanges: one per pair before the briefing and two per pair after it, about 24 lines from 4 new voices.
- An exchange plays when the player lingers close by, one at a time, once each, with subtitles only at close range. Story, hint and bark lines always win.
- Every other conversation in the Commons becomes audible as a soft, wordless murmur from where those people are.
- A new line priority below idle barks, so background talk never ducks the mix, holds back barks or hints, or makes bystanders turn to stare.
- The two voiced pairs stay in their places until the drop instead of wandering to other seats.
- Overheard exchanges and murmur stop when the drop starts.

**Out of scope**, left for later changes: object sounds (coffee machine, vending hum, kitchen, cutlery, chair scrapes), per-round escalation and a hush at the gallery call, other areas (Admin, dive bay, hydroponics), return-visit lines for named crew, and unloading voice audio after the drop.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `dialogue-channels`: adds the background priority and how it yields to every other line.
- `voice-playback`: local background lines show subtitles only within a short range.
- `in-world-audio`: adds overheard exchanges in the Commons and the conversation murmur.

## Impact

- Speech manager and line priorities (`src/dialogue/`, `src/data/types/dialogue.ts`), background conversations and ambient crew movement (`src/ai/`), session wiring (`src/app/session.ts`), and a new positional murmur controller (`src/audio/`).
- Data: new dialogue lines and exchange definitions under `src/data/`.
- Assets: about 24 Gemini TTS clips (4 new cast entries in `scripts/lib/voCast.ts`) and 3 murmur loops. Roughly 20-25 MB more decoded audio, to be measured against the `runtime-memory` spec.
- Docs: `docs/voice-casting-standard.md`, `docs/PLAYTEST.md`.
- No level geometry, save format or dependency changes.

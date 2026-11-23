# Proposal

## Why

In Hale's office scene, Jay still says "Everything all right, Director?" after the player has walked out, sometimes to another part of the map. The `dialogue-channels` rule only drops Jay's line when the conversation is out of *earshot*, and earshot is generous: a voice stays audible through up to two room boundaries and about 30 m of route, even behind a closed door. Hale's lines also carry on to an empty office by design. The player's expectation is simpler: leave the room and the conversation is over.

## What Changes

- A sequence can name a room that its scene belongs to. When the player is outside that room, the scene ends for every party: the line playing stops with its subtitle, queued lines are dropped, and the sequence is released.
- The speakers of an ended scene return to idle and stop addressing the player (talk gesture and look-at cleared).
- An ended scene stays finished. Coming back does not restart it, and a `once` scene does not replay.
- Scenes opt in one at a time. `admin_hale` (Hale's office) and `researcher_walkby` (Jay's greeting to a passing researcher in the Commons) are the first; other stationary scenes can follow without a spec change.
- An early end lands what is left of the scene on its end state, as a skip does, so a spawned walk-by NPC is removed and the scene's flag is set.
- Scenes that do not opt in keep the earshot rule for Jay's lines, so walking-and-talking scenes with the squad are unchanged.

## Capabilities

### New Capabilities
- `scene-presence`: a scene tied to a room ends when the player leaves that room, stops all its speakers, and does not restart on return.

### Modified Capabilities
- `dialogue-channels`: "Jay answers the conversation he can hear" keeps its earshot rule for scenes that are not tied to a room. Its Hale's-office scenario moves to `scene-presence`, where the whole scene ends instead of only Jay's line.

## Impact

- `src/script/` (sequence schema, runtime, game host room test): new optional sequence field and a per-frame presence check.
- `src/dialogue/speech.ts`: stop and drop a scene's lines on its channel when the runtime ends it.
- `src/data/sequences/rounds.json`: `admin_hale` (`R14c`) and `researcher_walkby` (`R02`) opt in.
- `src/ai/` speaker bodies: clear talk gesture and look-at when a scene ends early.
- Tests: a scene-presence test with real room data, plus updated `speechChannels` and `script` tests.
- Out of scope: changing earshot thresholds, voice propagation, bark and hint behaviour, and any scene other than `admin_hale` and `researcher_walkby`.

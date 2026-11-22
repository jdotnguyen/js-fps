# Proposal

## Why

Dialogue doesn't behave as if it belongs to the people saying it. Director Hale's office lines are heard at full volume anywhere on the station, because his speaker id (`director`) has no body to play from. Every scripted line also shares one global voice slot. So a conversation the player has walked away from holds up the one they've just walked into: in the dive bay, Sung waits for Hale. The same queue delays the dive-bay stow. Pressing E clicks, but the objective completes only after Sung's acknowledgement gets its turn. To the player, it looks as if E did nothing.

## What Changes

- Every local line plays from its speaker's body. Speaker ids that don't map to an NPC today (`director` → `hale`, `crew_maint` → `maint_1`, `crew_botanist` → the botanists) are mapped, and a level test fails when a local line's speaker has no body in the level. It only passes a speaker that is deliberately disembodied.
- Local voices carry through the station the way sound would. They follow the room graph through doors: they're muffled and quieter for each room boundary they cross, much quieter through a closed door, and silent once they are several rooms away. A conversation across the map is silent.
- Subtitles for local lines show only while the speaker is within 20 m and the voice is audible. This is re-checked every frame, so a subtitle appears when the player walks into range and hides when they leave. Radio and PA lines are exempt.
- **BREAKING (dialogue behaviour):** the single global voice slot goes away. Each running sequence speaks on its own channel, keeping its own lines in order, and separate conversations play at the same time with their own subtitles. A speaker never talks over themself. Barks and hints still give way to story lines the player can hear. When two conversations want Jay at once, the one he can hear wins and the far one drops his line.
- The dive-bay stow completes on E. The click, the objective and the round flags happen at once, and Sung's "Locker's signed" plays without holding up the objective.
- The trunk-secure event avoids only dive-bay dialogue, not lines elsewhere on the station.
- The `round_dive` objective title names the Sample Store, not the airlock locker.

Out of scope: a handoff cutscene where Jay gives the case to someone who stows it. That needs a Jay → NPC give action, an NPC holding a case and a stow animation, so it's left for a follow-up change.

## Capabilities

### New Capabilities

- `dialogue-channels`: how scripted conversations, barks and hints share the voice. That covers one channel per conversation, ordering within a channel, a speaker never overlapping themself, and priority between story and barks or hints.

### Modified Capabilities

- `voice-playback`: the Local channel plays from the speaker's body for every speaker that has one, with propagation through the room graph and silence at range. Subtitles for local lines depend on distance and audibility.
- `in-world-audio`: World sound occlusion no longer excludes dialogue. Local voices are muffled through walls and closed doors by the propagation rule above.
- `dive-bay`: the Sample errand route completes on use without waiting for dialogue. Trunk secure avoids only dive-bay lines.

## Impact

- `src/dialogue/speech.ts`: the single `current` slot and global queue are replaced by per-channel state. `say` takes a channel key. The overlap lane folds into channels.
- `src/script/actions.ts`, `src/script/gameHost.ts`, `src/script/host.ts`: `say` passes the sequence run as the channel.
- `src/dialogue/barks.ts`, `src/dialogue/hints.ts`, `src/game/guidance.ts`: they check "a story line the player can hear" instead of "anything speaking".
- `src/dialogue/voicePlayer.ts`: a per-voice gain and low-pass driven by propagation, and no fixed 40 m floor.
- `src/audio/occlusion.ts` and `src/world/level.ts`: a room-graph propagation query (rooms, doors and door state).
- `src/ai/speakerBodies.ts`: speaker → NPC mapping.
- `src/ui/hud/subtitles.ts`: live show and hide by distance and audibility. More than two near subtitles at once still evict the oldest.
- `src/main.ts`: wiring.
- `src/data/sequences/rounds.json` (`dive_stow` step order) and `src/data/objectives.json` (`round_dive` title).
- Tests: `speech.test.ts`, `occlusion.test.ts`, `subtitles` and `quiet.test.ts`, plus a slice01 speaker-body test.

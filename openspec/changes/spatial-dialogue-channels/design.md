# Design

## Context

The motivation is in proposal.md (Why). Today:

- `SpeechManager` (`src/dialogue/speech.ts`) has one `current` line, one priority queue and a separate `overlaps` lane. A line can start only when `current` is empty. Every scripted line is `story` priority, so nothing pre-empts and everything waits.
- A sequence already keeps its own lines in order, because `say` waits for its handle unless `"wait": false` (`src/script/actions.ts`). So the global slot is the only thing that orders *different* scenes against each other.
- Local lines are positioned only if `npcIdForSpeaker` resolves to an NPC (`src/main.ts`). Otherwise they play centred. `director`, `crew_maint` and `crew_botanist` don't resolve.
- `WebAudioVoicePlayer` gives a local line an HRTF `PannerNode` (inverse falloff, ref 1.5 m, max 40 m), with no occlusion. The world occluder (`src/audio/occlusion.ts`) answers none, glass or wall from one ray, at the start of a one-shot only.
- The level knows each door's two rooms (`door.between`), its live state, and `roomAt(point)`. Glass pairs are declared in level data (room-visibility).
- Subtitles (`src/ui/hud/subtitles.ts`) show on `subtitle:show` and hide on `subtitle:hide`, with at most two rows.

## Goals / Non-Goals

**Goals:**
- Separate conversations never wait on each other. Lines within one conversation keep their order.
- How audible a voice is, and whether its subtitle shows, is decided continuously during a line, from one propagation query.
- All of it stays Node-testable: the speech manager gets propagation through an injected function, never from Three.js or the level directly.

**Non-Goals:**
- Re-pointing the panner at doorways (portal-based sound direction). The voice stays at the speaker's head. Only its gain and tone change.
- Changing PA routing (fixture choice, area-serving speaker) or radio processing.
- The Jay → NPC handoff cutscene, an NPC holding the case and removing the case from inventory.

## Decisions

### D1. Channel = sequence run

`say` gets a `channel` key. The script runtime passes the run's token, so each run of a sequence is its own channel and a replayed sequence gets a new one. `overlap: true` maps to a fresh one-off channel, which replaces the separate overlap lane. Callers outside sequences use fixed keys: `barks`, `hints`, `guidance` and `chatter:<id>`. Calls with no key fall back to `default`, which keeps today's behaviour for anything not yet migrated.

Per channel the manager keeps an optional `current`, a FIFO and a `nextStartAt` for the 0.15 s gap. A queued entry may start when:
1. its channel is idle and past `nextStartAt`, and
2. its speaker isn't talking on any other channel (D3), and
3. for `barks`, `hints` and `guidance` lines, no audible story line is playing (D4).

*Alternative considered:* a channel per speaker. Rejected because a back-and-forth (Sung, Jay, Sung) needs ordering across speakers. *Alternative:* keep one slot but skip lines that are out of earshot. Rejected because two audible conversations would still serialise, and you asked for both to play.

### D2. Propagation query: room-graph search

A new `voicePath(from, to)` on the level returns `{ boundaries, closedDoors, glass, pathLength }`. It searches over rooms: each door is an edge between its two rooms, and each declared glass pair is a glass edge. The cost is path length, with a heavy penalty for a closed door so an open route is preferred. The path length is the sum of segments from speaker to doorway centre, doorway to doorway, and doorway to listener. Speaker and listener with no room (`roomAt` is null) are treated as the same room with straight-line distance.

The graph is built once per level. Only the door state is read live. The search is capped at three boundaries, so it touches a handful of rooms.

`audibility(path)` maps that to `{ gain, cutoffHz }`:
- **Distance:** the current inverse falloff on `pathLength`, but reaching 0 smoothly between 25 and 30 m, instead of the panner's floor at 40 m.
- **Per boundary through an open doorway:** gain ×0.6, cutoff stepping down from 2.5 kHz to about 1.2 kHz.
- **Per closed door:** gain ×0.25, cutoff 520 Hz, matching `OCCLUDED_CUTOFF_HZ`.
- **Glass only:** the existing `GLASS_*` values.
- **Three or more boundaries, or a path over 30 m:** gain 0.

The constants live in `occlusion.ts` beside the existing ones, so one file defines "muffled".

*Alternative:* count walls along one ray. Rejected because a ray can't tell an open doorway from a wall it nearly grazes, and wall count across a station grid is noisy. The room graph matches how sound actually travels here, through doors.

### D3. Speaker exclusivity

The manager tracks which speakers are talking. If an entry's speaker is busy on another channel, the entry waits in its own channel's FIFO, and its channel is blocked behind it to keep that channel's order. Stowing during Sung's conversation then plays "Locker's signed" after his current line. His conversation's next line waits for the stow line, because Sung is busy, then continues.

### D4. Earshot, audible story and the Jay rule

The manager takes an injected `audibilityOf(entry) → { gain, cutoffHz, distance } | 'everywhere'`. `main.ts` builds it from `speakerHeadAt`, the camera position and D2. Radio and PA return `everywhere`. A line is **in earshot** when gain is above about −40 dB.

- **Barks, hints and guidance** check "an in-earshot story line is playing" instead of `speaking() !== null`. `speaking()` stays, but returns the nearest in-earshot line.
- **Jay rule:** when a Jay line reaches the head of its channel, the manager looks up the speaker of the last non-player line on that channel. If that line is out of earshot, Jay's line is dropped with `speech:dropped` and the channel moves on. If the channel has no other speaker yet (a Jay monologue), the line plays.
- **StoryDucker** ducks music only for in-earshot story lines. It reads a new `audible` flag on `speech:started`, and listens to `speech:audible` changes.

### D5. Per-frame voice and subtitle updates

`VoicePlayback` gets `setAudibility(gain, cutoffHz)`. The player inserts a `GainNode` and a `BiquadFilter` low-pass after the panner and ramps them over about 80 ms so changes don't click. The panner's `maxDistance` rises so it stops clamping, and D2 does the fading. The reverb send stays after the new nodes, so a muted voice sends no reverb.

`SpeechManager.update` calls `audibilityOf` for each active line every frame. It emits `subtitle:show` and `subtitle:hide` on transitions of `visible = everywhere || (distance ≤ 20 && in earshot)`. `subtitle:show` carries the remaining duration, not the full one. `speech:started` and `speech:ended` still fire once per line, whether it's visible or not, so mouths and listen-look keep working for far scenes.

### D6. Speaker → body mapping and the test

Add `director: 'hale'` and `crew_maint: 'maint_1'` to `SPEAKER_NPC`. For pools such as the botanists, map `crew_botanist` to the nearest living `botanist_*` when the line starts, chosen in `speakerHeadAt`. An explicit `DISEMBODIED` set in `speakerBodies.ts` lists speakers allowed to play centred: player, PA, `crew_mess` (unless a body is added) and the infected. A slice01 test walks every local line in the dialogue files and asserts that the speaker resolves to an NPC id present in the level, or is in `DISEMBODIED`.

### D7. Dive stow and objective title

Reorder `dive_stow` in `rounds.json` to: `sfx click` → `completeObjective round_dive` → `setFlag round_dive_done` → `emit round:complete` → `npcLookAt sung` → `say dive_sung_03`. The say still waits, so the run lasts until Sung has spoken, but nothing after it matters. Rename the `round_dive` title to "Dive bay: stow the sample case in the Sample Store".

## Risks / Trade-offs

- **Busy subtitles when two conversations are close:** two rows plus the PA lane can still evict lines. → The 20 m cutoff removes most of it. If playtests show more than two near lines at once, raise the limit to three in a follow-up, without a spec change.
- **Story beats that relied on serialisation across scenes:** a scene might trigger while another is mid-line, near the player, and they used to take turns. → Run the quiet-half and intro tests. Look for sequences that `say` while another `exclusive` sequence runs. Mark any that must stay ordered as one shared channel, using an explicit `channel` key on the sequence.
- **A speaker busy on a far channel delays a near line:** for example, Giles mid-line in a scene the player has left. → It is at most one line's wait. If it bites, cut the far line when the same speaker's line in earshot is due.
- **Sound bleeding through thin rooms that aren't connected by doors:** the graph has no wall-transmission edge, so sound in adjacent rooms with no door between them is silent. → Acceptable for a pressure-hull station with steel bulkheads. Add wall edges if a playtest calls it out.
- **Per-frame cost:** a few active lines × a small graph search. → Cache by `(speakerRoom, listenerRoom, doorStateVersion)`.

## Migration Plan

There are no save or data migrations, because speech isn't saved. Roll out in one change, behind no flag. To roll back, revert the change. `default` channel behaviour means unmigrated callers behave as today until they pass a key.

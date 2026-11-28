# Design

## Context

`WebAudioVoicePlayer` currently sends radio lines to a shared, centred comms chain. Its local branch already places a voice in 3D. `SpeechManager` owns playback timing, subtitles and a separate lane for overlapping lines. The quarantine cue uses that lane while Jay and the squad walk to the kitchen.

## Goals / Non-Goals

Give the existing recordings a physical source the player can identify by sight and sound. Keep mixing and source selection inside voice playback so the speech manager can continue to handle overlap, subtitle ordering and scene cleanup. Voice casting, headset comms and the TAG FM music player have their own established behavior.

## Decisions

1. **Represent the station PA as a dialogue channel.** Add `pa` alongside `local` and `radio` and migrate the four lines spoken by `pa`. This makes the spatial and tonal treatment explicit in content. Adding a position to a radio line alone would still feed the shared centred comms effects.

2. **Place the emitter with the model.** Build the shallow box, recessed grille and bracket from the existing kit materials. Derive a fixed world position from the grille's local offset and the authored prop transform, and associate it with the prop ID and room. Use level placement data so room mesh culling cannot move or remove an active audio source. A separate hand-placed audio anchor could drift away from the box during level edits.

3. **Choose one fixture when playback begins.** Give the dock, walk and lockdown cues explicit fixture IDs. The intro quarantine and the rounds repeat share one recording, so assign the fixture on the cue, not on the recording. For either rounds cue, choose the nearest serving fixture in the listener's room, with an authored adjacent fixture for rooms served through a doorway. Cover Hydroponics, Dive Bay, Admin and the exits reachable during the scripted delays. Resolve at audible start, then hold the selected position through the last word. Constantly choosing the nearest box would pull the voice across the room mid-sentence.

4. **Filter before positioning.** Feed the recording and any PA chime through the same source position. Use a speech-band filter with mild midrange coloration, HRTF panning, distance attenuation and a small send to the active room reverb. Route the direct signal to the voice bus and apply its volume to the wet feed as well. Keep the existing story ducking for music and ambience. Set the PA level by listening to the actual overlap with Giles.

## Risks / Trade-offs

- A grille too far from the opening camera could be hard to identify. Place it beside the window on solid wall and check the shot from Jay's post.
- A long reverb tail or a close pass under the corridor box could mask Giles. Listen with subtitles off and adjust the placement, PA gain and reverb send together.
- A nearby room across a bulkhead could win a distance-only search. Use authored room coverage and check reachable rooms for missing sources. If a placement is missing at runtime, retain the subtitle and scene timing and report the missing fixture during development.

## Migration Plan

Land the channel, level placements and four dialogue entries together. Regenerate the slice from its generator. Fixture selection is transient playback state, so an existing checkpoint resolves the next announcement from the loaded level.

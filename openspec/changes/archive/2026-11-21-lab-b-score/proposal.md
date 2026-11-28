# Proposal

## Why

The Lab B kill is the slice's first horror set piece, and it plays with no score at all: in play the music bus is silent
unless a sequence cues the single menu loop. The kill's beats, the walk to R05 and the creature fight have no musical
arc, so the escalation the animation, gore and klaxons build is never carried by the music.

## What Changes

- New adaptive score for the Lab B incident, generated in code like the menu theme "Pressure" (D, b2/tritone colour,
  the heartbeat motif). It is a set of synced loops on one shared clock (92 BPM, 8 bars of 2.6 s) whose levels follow
  the kill, plus one-shot stingers.
- The score follows each kill beat: drone and slow heart at scratch, pulse and an endless rising string glissando
  through panic, stabs on each palm hit at the glass, everything at full at the arch, a hard cut to silence at the
  burst, a single quiet note at still, a creature swell, then a sparse hold.
- The score plays at one steady loudness, about as loud as the menu theme or louder, from the scratch to the creature's
  death (only the burst cuts to silence), and the room ambience steps back about 6 dB while it plays. The engine can tie
  layers to distance or dip for in-world hits; Lab B does not use either.
- The contact scene's knocks play over near silence, the door opening fires a slam stinger, the fight brings the arch
  material back, and the score ends (final hit, drone tail) when the creature is killed. The trickle wave after it has
  no score.
- Klaxon steps can wait for the score's next beat, so the Lab B alarm lands on the music's grid.
- Kill beats can fire score stingers at authored times (`kills.json`), so stabs land on the victim's hands.
- Restoring at `cp_drop` resumes the score in its hold state. Restart or quitting to the title stops it.
- The contact scene releases the creature from behind the glass as the enemy the player fights, with its body and from
  where it stood, instead of despawning it and spawning a stand-in at the door (the existing `infection-kills`
  requirement "The creature stays behind the glass until it breaks out", which the content does not meet today).

## Capabilities

### New Capabilities
- `adaptive-music`: scored set pieces in play: synced layers on a shared musical clock, cues from game events, stingers,
  hard cuts, distance-driven layers, ducking for in-world hits, resume from checkpoints, and the Lab B score's arc.

### Modified Capabilities
- `in-world-audio`: sequence sound steps can wait for the score's next beat.
- `infection-kills`: kill beats can fire score stingers, and each creature blow on the glass is reported so the score
  can make room for it.

## Impact

- Audio: new score renderer next to `src/audio/music.ts`, a worker render, a score player on the `music` bus, and
  `musicTracks.ts`/`menuMusic.ts` so a score and the menu theme do not fight over the bus.
- Script: a new `score` sequence action, a `beat` option on `sfx`, `drop.json` and `action_contact.json` cues.
- Kills: `kills.json` stinger events, a pound event from `npcKills.ts`.
- Content: the contact scene's creature hand-off (`action_contact.json`, the `r05_contact` spawn).
- Memory: about 35 MB of decoded score audio while the Lab B score is loaded (rendered at the rounds, freed after
  contact); recorded per `runtime-memory`.
- No new dependencies. ElevenLabs stays the fallback if the generated layers do not hold up.

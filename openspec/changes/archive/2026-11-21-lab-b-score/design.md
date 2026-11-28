# Design

## Context

See proposal.md - Why. What exists today, as it shapes the approach:

- `music.ts` renders "Pressure" in a worker (`musicWorker.ts`, 32 kHz): a 64 s loop whose periodic parts are snapped to
  whole cycles per loop and whose reverb tail is folded back over the start. `MenuMusic` plays it with
  `engine.loopStereo()` (a gain-controllable `LoopHandle` on the `music` bus) and fades it by game mode; the `music`
  sequence step can cue one track (`MUSIC_TRACKS = ['main_theme']`).
- `npcKills.ts` emits `kill:<beat>` on the event bus as each beat begins, and `kill:done`. Beat events in `kills.json`
  are timed per beat (`t`), and the glass beat already places the four palm hits at 0.4, 0.8, 1.2 and 1.6 s.
- After the kill, `Pounder` drives the creature's flurries on the glass (3-6 blows, 0.8-2.2 s rests).
- `drop.json` starts the klaxon loop (3 x every 2.6 s) at `kill:arch`. `action_contact.json` knocks, opens the door,
  `despawn`s `researcher_b_creature` and `spawnGroup`s `r05_contact` (one `necromorph` spawn, `r05_door`, at the door).
- Story ducking already lowers the `music` bus under story lines.
- `audio-assets` names providers for SFX, ambience and voice, not music; the menu theme is already generated.

## Goals / Non-Goals

**Goals:**
- A score system reusable by later set pieces: a score is data (layers, stingers, cues) plus a render function.
- Sample-accurate sync between layers with no runtime rescheduling.
- The Lab B score itself, end to end, including the creature hand-off its ending depends on.

**Non-Goals:**
- Horizontal re-sequencing (jumping between different loops on bar lines). Everything is vertical layering.
- Recorded music. The ElevenLabs fallback stays possible because stems are played by name, but no files ship here.
- Combat music for other fights.

## Decisions

### D1. Vertical layering on one AudioBufferSource clock
All layers are the same length (8 bars x 2.6 s = 20.8 s), start with one `start(when)` at the same AudioContext time and
loop forever; cues only move gains. This keeps them in step by construction.
*Alternatives:* scheduling clips per bar (drift and look-ahead bookkeeping); one mixed loop per state crossfaded (no
per-layer control, more memory).

### D2. Layers and stingers for Lab B
```
layer     content                                              loudest at
--------  ---------------------------------------------------  -----------------
drone     D sub drone + horror bass (from Pressure)            whole score
heartSlow double-thump heart at 46 BPM                         scratch
heartFast double-thump heart at 92 BPM                         panic..arch, walk (near)
pulse     low toms / sub hits on the 92 BPM grid               panic..arch, fight
rise      Shepard-Risset glissando, string-like cluster         panic..arch, fight
voice     formant choir oo<->ah, breath, dissonant cluster      glass..arch, walk (near)
brutal    full percussion, bowed metal, b2/tritone hits        arch, fight
hold      sparse pads with deliberate gaps, distant groans     still..walk
```
Stingers (one-shots): `stab` (2 variants), `swell` (creature), `rise` (into the door), `slam` (door), `end` (final hit +
3 s drone tail). The Shepard glissando loops cleanly because each partial wraps within the loop.

### D3. The score is data plus a renderer
`src/audio/scores/labB.ts` exports the render (layers + stingers, seeded `Rng('score:labB')`) and `src/data/scores.json`
holds the cue table: per cue, a target gain per layer, a fade time, an optional stinger, `cut: true` for a hard cut,
and distance ties. Cues are named by the game events that fire them (`kill:scratch` ... `kill:creature`) or set by a new
`{ "do": "score", "id": "labB", "cue": "<name>" }` sequence step (`load`, `contact`, `door`, `fight`, `end`, `stop`).

```
cue            drone heartS heartF pulse rise voice brutal hold  extra
-------------  ----- ------ ------ ----- ---- ----- ------ ----  -------------------------
kill:scratch   0.6   0.5    0      0     0    0     0      0
kill:panic     0.7   0.2    0.6    0.5   0.4  0     0      0
kill:glass     0.8   0      0.7    0.6   0.6  0.5   0      0     stab on kills.json events
kill:arch      1.0   0      0.9    0.9   0.9  0.8   1.0    0
kill:burst     0     0      0      0     0    0     0      0     cut: true
kill:still     0.15  0      0      0     0    0     0      0.4   (a single high note in hold)
kill:creature  0.5   0      0      0     0    0.2   0      0.7   swell
contact        0.4   0      0.3    0     0    0.3   0      0.3   (knocks over near silence)
door           0.9   0      0.8    0.9   0.9  0.7   1.0    0     slam
end            0     0      0      0     0    0     0      0     end, then stop
```
`kill:creature` turns on the distance tie: `voice` 0.2->0.7 and `heartFast` 0->0.6 as the player goes from 14 m to 3 m
of `door:D_R04_R05`. `contact` turns it off.

### D4. ScorePlayer next to MenuMusic, sharing the music bus
A `ScorePlayer` owns the score's loop handles and a sub-gain on the `music` bus. It renders in a worker when asked
(`load`), remembers the latest cue until the render lands, then starts every layer at once and applies that cue.
`MenuMusic` already fades to 0 in play; while a score is active, a `music` step still works and the two simply sum (no
content does both). Quit to title or `game:restarted` stops the score.
*Alternative:* fold scores into `MenuMusic` (it is one-track by design; growing it would mix two concerns).

### D5. Beat-quantised sound steps
`ScorePlayer.nextBeat()` returns the AudioContext time of the next beat (now if no score). `sfx` gains `beat: true`;
the host delays the play until then (at most 0.65 s). `drop.json`'s klaxon steps use it.

### D6. Distance tie and ducking run per frame (engine features; Lab B leaves them off)
Each frame the player position feeds the active distance ties (smoothed, so walking does not zipper). `npcKills.ts`
emits `creature:pound { npc }` when a flurry starts; the score dips its sub-gain by 6 dB for 0.6 s and recovers over
about 0.8 s.

### D7. Kill beat stingers
`KillEvent` gains `do: "stinger"` with `id`, which emits `score:stinger { id }`; the score plays it if it has that
stinger. The four palm hits in `kills.json` get one each.

### D8. Resume from checkpoints
The score cue table has `resume`: `[{ "flags": { "drop_done": true, "contact_done": false }, "cue": "hold" }]`.
When a checkpoint restore lands, the score checks it and, if it matches, loads and starts at that cue: `hold` has the
same levels and distance tie as `kill:creature` but no swell stinger, since nothing is emerging on a restore.

### D9. The creature becomes the R05 enemy
`spawnGroup` gains an optional `from: "npc:<id>"`: each spawn in the group starts at that NPC's position and takes its
look, and the NPC is removed in the same frame. `action_contact.json` replaces `despawn` + `spawnGroup` with
`spawnGroup r05_contact from npc:researcher_b_creature`, and `r05_door` uses `look: "lab_creature"`. The creature then
paths through the opened door like any enemy. `waitGroup r05_contact` resolving fires the `end` cue.

### D10. Lab B plays at one level (revised after the first playtest)
The first mix built in loudness (scratch quiet, arch loudest, the walk building with distance, dips under the blows)
and was buried under the room noise. The playtest asked for a steady, louder score instead. Every cue's layer levels
are now scaled so its mix has the same loudness (RMS 0.09 before `level`, within 1 dB across cues); `level` is 5, about
4 dB over the menu theme. The distance tie and pound ducking stay in the engine, unused by Lab B. While any score plays,
the ambience bus steps down to 0.5 (about -6 dB). The cue table in D3 shows the first mix's levels; `scores.json` holds
the current ones.

## Risks / Trade-offs

- [Generated strings and choir can sound cheap] -> keep them dissonant clusters with slow movement and heavy reverb,
  no melodies; preview with `npm run music:preview`; fall back to ElevenLabs stems under the same layer names.
- [Render time ~2x Pressure's] -> render at the rounds (well before the drop) in a worker; a late render only delays the
  music, never the kill.
- [Memory ~49 MB decoded while loaded, see Measurements] -> released 5 s after the creature dies; recorded per `runtime-memory`.
- [Klaxon up to 0.65 s late] -> accepted by the user; it reads as the alarm joining the music.
- [Spawning from the creature's position could put the enemy inside the glass] -> the creature stands on the victim side
  of the pane, which the nav mesh already covers; the enemy paths around through the open door.

## Measurements

Decoded score audio (runtime-memory "Steady-state memory is recorded"), from the render at 32 kHz stereo float:

```
state                                   decoded audio
--------------------------------------  -------------------------------------------------
before the rounds end                   0
loaded (8 layers x 20.8 s)              42.6 MB in AudioBuffers
  + stingers (6 renders, 24.6 s)        6.3 MB in JS (copied into a short-lived buffer per play)
  hand-off (layers copied into Web       up to ~43 MB more for one GC cycle, then dropped
  Audio, the JS copies released)
after the end cue + 5 s                 0
```

This is a +49 MB rise in decoded audio over the drop, the walk and the R05 fight, which is over the 15% threshold: it
is the cost of eight full-length stems; it is temporary and returns to zero after the fight. Render time: about 3.8-4.9 s
in the worker on this machine (main thread unaffected). Still to measure in the browser with `?slot=scratch&memprobe`
during the playtest (task 4.2).

## Migration Plan

1. Score engine (player, worker, data, `score` step, `beat` sfx) with a minimal test score.
2. Lab B render and cue table; `drop.json` / `kills.json` cues.
3. Creature hand-off and the ending.
Rollback: remove the `score` steps; the slice plays silent as today.

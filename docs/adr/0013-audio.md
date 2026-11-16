# ADR-0013: Audio

Status: Proposed (whole ADR is [Assumed] detail serving [Decided] horror tone)

## Context
The prototype synthesizes all sound with Web Audio and ships no files. The game needs
oppressive deep-sea ambience, readable combat sound, positional enemies and voices, and a
path to real recorded files later, following the same hybrid rule as geometry and voice.

## Decision
A Web Audio engine with mix buses, per-room procedural reverb and ambience, procedural SFX
now, and a file registry that overrides any sound ID when a file exists.

## Details

### Graph
`sources -> (panner) -> bus (sfx | voice | music | ambience | ui) -> room reverb send ->
master compressor/limiter -> destination`.
- Duck music and ambience by 4 dB while story lines play.
- Low-pass "muffle" filter on the master for damage, explosions and underwater moments.

### Reverb
- `ConvolverNode` with impulse responses generated procedurally (decaying filtered noise)
  per room type: `metal_corridor` (short, bright), `metal_hall` (long), `small_office`
  (dry), `flooded` (dark, long). Switched on room change with a 0.5 s crossfade.

### Positional audio
- HRTF `PannerNode` for enemies, squad local voice, doors, set pieces. Listener follows the
  camera.
- Occlusion approximation: sounds in non-adjacent rooms get low-pass and -9 dB; through
  closed doors -6 dB and low-pass. (Uses room graph from ADR-0003.)

### Ambience (procedural)
- Hull groans: low noise through resonant band-pass with slow pitch bends, random every
  20-60 s. Pressure pings, distant metal knocks, dripping, HVAC hum, electrical buzz near
  lights (follows light pattern), alarms.
- Room `ambience` key selects a preset mix.

### SFX (procedural, ported and extended)
Vocal emotes for dialogue (synth defined in ADR-0010), pistol, shotgun and pump, dry-fire, reload parts, footsteps per surface, wading, flesh hits,
sever, bone crack, debris thuds, door hiss and seal, glass crack and shatter, console beeps,
enemy groans/screams (formant-like synthesis with noise), grab struggle, heartbeat,
breathing.

### Music
- No composed tracks in the slice. Dynamic tension system: 3 drone layers fade in with
  "threat level" (nearest alerted enemy distance and count). Stingers on scripted reveals
  and on play-dead wake-ups. Silence is a deliberate tool in the quiet opening.

### File override
- `data/audio-manifest.json` maps IDs to files in `public/assets/audio/`. If present, the
  file plays instead of the synth; same bus, panner and reverb.

### Unlock
- Audio context resumes on the first click (title screen "Start").

## Consequences
- Procedural sound sets the mood fast; real recordings can replace the weakest sounds
  first.

## Alternatives rejected
- Howler.js or similar: unneeded on top of Web Audio.

## Execution steps
1. Engine, buses, listener, master chain, settings volumes.
2. Reverb presets and room switching.
3. Ambience presets.
4. Port and extend SFX.
5. Tension music and stingers.
6. File override manifest.

## Definition of done
- Walking from a corridor into a hall audibly changes reverb; enemies are locatable by ear.

## Open questions
- Real music later (style, composer).

## Progress log
- 2026-11-15: Implemented early for the demo corridor, at Justin's request.
  - `audio/dsp.ts`: offline DSP kit (biquads, noise colours, seamless loops, stereo IR).
  - `audio/sounds.ts`: 17 procedural sounds, 39 variants: room tone, vent fan, fluorescent
    buzz, water rumble, console hum, hull groan, metal knock, pressure ping, drip, creak, zap,
    console beep, klaxon, distant moan, footsteps (plate / grating), flashlight click.
  - `audio/engine.ts`: buses -> master -> limiter, convolution reverb send, HRTF panners,
    muffled (low-pass) voices, listener following the camera (Firefox fallback).
  - `audio/scheduler.ts` + `world/demoRoomAudio.ts`: hallway soundscape.
  **Deviation:** sounds are rendered offline into AudioBuffers instead of built from live
  oscillator graphs. Same "pure math" approach as textures: testable in Node, previewable
  as WAV (`npm run sounds:preview`), identical on every machine, and cheap at runtime.
  **Deviation:** one shared reverb for now; per-room presets arrive with ADR-0003 rooms.
  Verified in sandbox: 55 unit tests (no NaN/clipping, audible, deterministic, loops
  seamless, IR decays, scheduler intervals), levels report, spectrogram sheet inspected.
  **Not yet verified:** listening in the browser, mix balance, CPU cost.
- 2026-11-15: Menu theme "Pressure" added at Justin's request (deviation: ADR said no composed tracks in the slice).
  - `audio/music.ts`: procedural 64 s seamless stereo loop in D (sub drone, clashing pads, sonar ping + echo,
    detuned bell motif, hull groans, faint heartbeat, shimmer, damped-comb reverb folded over the seam).
  - `audio/musicWorker.ts` renders it off the main thread at 32 kHz (about 28 s at 44.1 kHz on the main thread
    otherwise); `audio/menuMusic.ts` loops it on the new `music` bus: full on title, 40% when paused, faded out
    while playing. `npm run music:preview` writes `previews/music/menuTheme.wav`.
  - Verified in sandbox: typecheck of the new files, 112 unit tests (finite, no clipping, deterministic, seam).
    **Not yet verified:** listening by ear, mix level against ambience, `vite build` bundling of the worker.

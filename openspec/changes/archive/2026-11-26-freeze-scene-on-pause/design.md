# Design

## Context

See `proposal.md` for the motivation. Findings below are from reading the code on 2026-11-26. None of them has been
reproduced in a browser.

- One `AudioEngine` (one `AudioContext`) carries everything. Pause multiplies its master by 0.45 (`Game.applyVolume`),
  and `ambience.ts`, `propAudio.ts` and `murmur.ts` apply their own `paused` levels. No source is stopped.
- `speech.update` runs only in `playing`, so subtitle and queue timers hold while the voice source plays on.
- `shell.ts` calls `audio.resume()` on every `pointerdown` and `keydown`.
- The render hook in `session.ts` passes the real frame time to `world.update`, `viewmodel.update` and the effect
  systems in every mode. Doors travel and close, and a reload completes and emits its sound cues, while paused.
- A blocking tutorial pop-up returns early from the fixed step, but `speech.update` runs just before that return. No
  spec or comment gives a reason.
- Wall-clock delays: death restart (`game.ts`), cutscene skip (`cutscene.ts`), title card hold, beat-aligned sequence
  sound (`gameHost.ts`), footstep drip, casing clink, HUD hint expiry, and the engine's fade-stop and reverb
  disconnect.
- Loading a save in the loaded level calls `Game.restore` synchronously, which sets `playing` before it emits
  `game:restarted`. Loading another level disposes the session. Quit to title sets `title`, then the shell disposes the
  session in the same call.
- `session.ts`, `speech.ts` and `voicePlayer.ts` had uncommitted edits from other work when this was written.

## Goals / Non-Goals

**Goals:**

- One switch decides whether the scene is frozen, and picture, sound and delays all follow it.
- Systems keep scheduling sound as they do now; none of them needs to know how to pause its own.

**Non-Goals:**

- Screen fades already in progress and the title card's logo animation may finish or keep animating. They are overlays,
  not the scene.
- Drift between sound and simulation on slow frames during play.
- Title screen, splash and end credits audio.

## Decisions

### D1: Suspend the scene's audio context

Suspending stops the context's clock, so every source, loop, scheduled start and parameter ramp holds and later carries
on by itself.

Alternatives: stop each source and restart it at its offset (Web Audio sources cannot pause, so every source, ramp and
reverb tail would need tracking), or set playback rates to zero (scheduled times and ramps would still run).

### D2: A second audio output for menu sound

The shell owns a second `AudioEngine` for interface sounds and the menu theme. The existing engine stays the scene's,
and the splash stays on it. Both follow the volume settings. The menu engine's master is the master setting, times 0.45
while a pause screen is open, which keeps today's menu loudness. The pause factor leaves the scene engine.

Interface samples load into the menu engine, and checks of the context state before a menu sound read the menu context.
Both contexts need the first-input unlock.

Alternatives: silent menus (rejected by the user), or media elements for menu sound (a second mixing path outside the
buses).

### D3: The menu theme and a scene's cued track are separate loops

`MenuMusic` plays the theme on the menu engine for the title and pause screens, silent in play, and `hold` for the
credits applies there. A sequence `music` cue raises a second loop of the same render on the scene engine, so it holds
with the scene. Both loops share one decoded `AudioBuffer`, which is not tied to a context, so the theme is not stored
twice. A cue at the start of a new game picks up where the title theme is. Leaving a pause screen, the theme goes within
a fraction of a second, so it cannot trail over a tutorial pop-up that returns with the play.

### D4: The engine owns a held state

`setHeld(true)` ramps an output gain after the limiter to zero over about 20 ms, then suspends. If the document is
hidden it suspends at once, because background timers are throttled. `setHeld(false)` cancels a pending suspend,
resumes and ramps back. While held, the unlock call `resume()` does nothing. The wanted state is applied again when a
`suspend` or `resume` promise settles, so a quick pause and resume cannot end in the wrong one.

### D5: One frozen flag, held at once and released late

Frozen means `paused`, or `playing` with a tutorial pop-up open. The session holds immediately on `game:mode` (the
animation frame loop may already be stopped in a hidden tab) and after the tutorial step. It releases in a microtask,
so restore and quit listeners running in the same call finish first. Session disposal releases the hold.

### D6: Scene updates get no time while frozen

In the render hook, the world, view model, player camera, flashlight, muzzle light, water, wading sloshes, splashes,
sparks and surveillance feeds receive zero time (or are skipped where they only advance). HUD, guidance and menus keep
real time. The fixed step returns early whenever the scene is frozen, with `speech.update` below that check. This also
holds the scene clock (light patterns, water), which until now advanced during pause.

`world.update` is still called, with zero time, because a quality change in the pause menu needs culling and lighting.

### D7: Delays count play time

A small timer queue, stepped in the fixed step after the tutorial check and cleared on restart and quit, replaces the
wall-clock delays for the death restart, cutscene skip, title card, footstep drip, casing clink and HUD hint. A
beat-aligned sound instead passes a start delay to `engine.play`, so it stays on the audio clock and on the beat. The
engine's own fade-stop and reverb cleanup follow the audio clock too.

### D8: Discard before release

`Game.restore` and `Game.quitToTitle`, and session disposal, drop held sound first when the engine is held: the engine
stops and disconnects the one-shots it started, along with the voice sources registered with it, and replaces the
reverb to drop its tail. While held, a stop
request from any owner (voice, loop, score) is immediate instead of faded. Discarding at the start of a restore leaves
sounds that the restore itself starts untouched.

### D9: Remove the pause levels

The `paused` levels in ambience, prop audio and murmur go. Left in, held sound would come back quiet and ramp up.

### D10: A hidden tab pauses

A `visibilitychange` listener calls `game.pause()` when the document hides during play.

## Measurements

Decoded audio from the memory probe on 2026-11-26 (dev server, headless Chrome, 1280x720, fresh profile, sampled once
the figure had held for 15 s), before and after the second engine (D2, D3).

| Scene | Before | After |
|---|---|---|
| Title (`?slot=scratch&memprobe&nosplash`) | 471 MB | 491 MB |
| `slice01` (`?level=slice01&slot=scratch&nosplash&memprobe`) | 730 MB | 749 MB |

About 16.4 MB of each rise is the 64 s menu theme, which the probe did not count before. Each page created one stereo
buffer of that length, so both loops share it. The real addition is about 3 MB (interface sounds and a reverb impulse
in the menu engine), well under the 15% that `runtime-memory` asks a change to explain.

## Risks / Trade-offs

- [A cut mid-waveform clicks] -> the output ramp in D4; confirm by ear.
- [Resuming after a pop-up dismissed by mouse movement has no user gesture] -> the context was already unlocked, which
  should be enough; verify the Look pop-up in Chrome. The next click or key also resumes.
- [A sound requested while held plays on release] -> a frozen scene should request none; cover pause and pop-up with a
  test, and look for stray starts during browser verification.
- [An update misbehaves when given zero time] -> no division by the frame time was found in render, world or actor
  code; still exercise each pause screen in the browser.
- [A second context costs memory and an audio stream] -> shared theme buffer; re-measure decoded audio as
  `runtime-memory` requires.
- [Shared checkout with edits in the same files] -> start from the then-current files and commit only this change's
  hunks.

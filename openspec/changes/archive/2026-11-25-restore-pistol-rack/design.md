# Design

## Context

See proposal.md for motivation. The pistol's `Take` clip (0.33 s) never moves the slide or the support hand. The `Reload` clip ends with a rack: the hand reaches the slide, which starts back at 3.05 s and is home at 3.25 s.

## Goals / Non-Goals

**Goals:**
- A visible rack on the draw using the authored animations only.

**Non-Goals:**
- A separate draw-and-rack clip, or moving the slide bone by code.

## Decisions

### The draw reuses the end of the reload

After `Take`, `Reload` plays from 2.55 s to its end with a 0.2 s cross-fade. It is not a reload: no reload state or events, and no ammunition change.

Alternative: move the slide bone by code. Rejected: the slide would move with no hand on it.

### The rack is part of the draw's timeline, not a busy state

The player can act as soon as before (0.33 s). A shot, a reload or a switch clears the timeline, which drops the rack and any sound not yet started.

### Shorten the pause in the original recording

The old fitted file had its click peaks about 0.29 s apart, for the old model. The slide is now back and home about 0.1 s apart, so `scripts/fit-weapon-audio.mjs` cuts the recording to peaks 0.14 s apart. Alternative: slow the animation to the old sound. Rejected: it would change the authored reload speed that the spec fixes.

### One sound name for both uses

`pistolReloadSlide` now plays the new file, so the session's cue handling is unchanged.

## Risks / Trade-offs

- [The rack plays on every draw and could become repetitive] -> Accepted; it can be limited to the first draw later.
- [On the drop it follows the very loud duct bang and may be hard to hear] -> Not checked in play.

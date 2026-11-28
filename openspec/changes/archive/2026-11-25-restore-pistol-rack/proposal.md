# Proposal

## Why

The pistol used to cock with an audible double click. That sound was removed when the first-person weapons were swapped to the current animated models (swap-viewmodels-to-just-models): the reload now ends on a single short click, and drawing the pistol is silent and never moves the slide.

## What Changes

- The end of the reload plays the two-click rack sound again, timed to the slide being pulled back and snapping home.
- Drawing the pistol ends with the support hand racking the slide, with the same sound. A shot, a reload or a switch cuts it short.
- The sound is rebuilt from the original recording with the pause between its clicks shortened to match the current animation, and the single-click file is removed.

Out of scope: new animation data, the shotgun, gun-shot and magazine sounds, and any change to when the player can fire.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `weapon-viewmodels`: adds requirements for the two-click slide rack sound and for the rack at the end of the pistol's draw.

## Impact

- `src/render/viewmodel/viewmodel.ts`: the draw sequence and the slide cue time.
- `src/audio/sounds.ts`: which file `pistolReloadSlide` plays.
- `public/assets/audio/weapons/`: `pistol-cock-fit.mp3` added, `pistol-reload-slide.mp3` removed.
- `scripts/fit-weapon-audio.mjs`: builds the new file.
- `src/render/viewmodel/viewmodel.test.ts` and `docs/PLAYTEST.md`.

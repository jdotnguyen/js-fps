# Tasks

## 1. Rack sound

- [x] 1.1 Build `pistol-cock-fit.mp3` from the original recording with `scripts/fit-weapon-audio.mjs`. Verify its click peaks are 0.14 s apart (measured at 0.07 s and 0.21 s).
- [x] 1.2 Play it for `pistolReloadSlide`, start it at 3.04 s of the reload, and remove `pistol-reload-slide.mp3`. Verify the casing, engine and viewmodel tests pass and that in game it starts about 3.1 s after the reload key (measured 3.07 s).

## 2. Draw

- [x] 2.1 End the pistol's draw with the reload's rack segment, cut short by a shot, a reload or a switch. Verify with viewmodel tests for the rack and for firing during it, and in game by the sound about 1.5 s after switching from the shotgun (measured 1.48 s) with screenshots of the hand on the slide.
- [x] 2.2 Describe the reload clicks and the draw rack in `docs/PLAYTEST.md`. Verify the text matches the behaviour, and that the user is satisfied with the sound in game.

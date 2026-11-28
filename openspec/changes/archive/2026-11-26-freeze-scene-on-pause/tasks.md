# Tasks

## 1. Holding and discarding scene audio

- [x] 1.1 Give the Web Audio test fake `suspend`, `resume`, context state and a settable clock; verify `npm test -- src/audio/engine.test.ts` still passes
- [x] 1.2 Add the engine's held state with its output ramp (design D4); verify tests cover: held suspends, `resume()` does not release, a quick hold and release ends running, a hidden document suspends at once
- [x] 1.3 Track `play` one-shots, add discard with a reverb replacement, and make stops immediate while held (D8); verify tests show nothing from before a discard stays connected
- [x] 1.4 Add a start delay to `play` and move the fade-stop and reverb cleanup to the audio clock (D7); verify a test that holds during a fade finds the fade still pending on release
- [x] 1.5 Make a voice line stop immediately while held (D8); verify in `src/dialogue/voicePlayer.test.ts`, including radio static and the PA chime

## 2. Menu audio output

- [x] 2.1 Create the menu engine in the shell and route interface sounds, their samples, context-state checks and the first-input unlock to it (D2); verify tests show menu sounds start while the scene engine is held
- [x] 2.2 Apply volume settings to both engines and move the 45% pause factor to the menu engine (D2); verify tests for master 0% and for the scene master being unchanged by pause
- [x] 2.3 Split `MenuMusic` into the theme loop and the scene cue loop sharing one buffer (D3); verify in `src/audio/menuMusic.test.ts` the pause, cue-during-pause and credits hold cases
- [x] 2.4 Remove the `paused` levels from ambience, prop audio and murmur (D9); update their tests and verify they pass with the level unchanged by pause
- [x] 2.5 Count both engines in the memory probe with the shared buffer once, then measure decoded audio in `?slot=scratch&memprobe` before and after; record both figures in `design.md`

## 3. Freezing the scene

- [x] 3.1 Add the frozen flag in the session: hold on `game:mode` and after the tutorial step, release in a microtask and on disposal (D5); verify tests cover pause, map, save station, pop-up and a pause over a pop-up
- [x] 3.2 Discard held sound at the start of restore and quit to title, and on session disposal (D8); verify tests for load in the same level, load of another level and quit, and that restore's own sounds survive
- [x] 3.3 Give scene updates zero time while frozen and move `speech.update` below the tutorial check (D6); verify tests that a reload, a door and a line do not advance while frozen
- [x] 3.4 Pause on a hidden tab (D10); verify a test that hiding during play pauses and hiding on the title does nothing
- [x] 3.5 Add the pause and pop-up checks from `specs/game-pause/spec.md` to `docs/PLAYTEST.md`; verify each scenario there has a step

## 4. Delays on play time

- [x] 4.1 Add the play-time timer queue, stepped after the tutorial check and cleared on restart and quit (D7); verify unit tests for firing, holding and clearing
- [x] 4.2 Move the death restart and cutscene skip onto it; verify tests that neither fires while paused and both fire after resume
- [x] 4.3 Move the title card hold and HUD hint expiry onto play time; verify tests that pausing does not shorten either
- [x] 4.4 Wire the footstep drip and casing clink to the queue; verify `src/audio/footsteps.test.ts` and `src/audio/casings.test.ts`
- [x] 4.5 Schedule a beat-aligned sequence sound with the engine's start delay; verify a test that it starts on the score's next beat after a hold

## 5. Integration

- [x] 5.1 Run `npm run typecheck` and `npm test`; verify both pass, noting any failure that predates this change
- [x] 5.2 Playtest in the browser with `?slot=scratch`: run the new `docs/PLAYTEST.md` steps and verify the scene context's clock does not move while frozen and no scene sound starts during a freeze
- [x] 5.3 In Chrome, dismiss the Look pop-up by mouse movement alone and verify scene sound returns
- [x] 5.4 Have a person listen to pause and resume mid-line, mid-gunfire and during the intro music; verify there is no click and voices stay in step with mouths and subtitles

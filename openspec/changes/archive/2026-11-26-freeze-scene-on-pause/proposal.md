# Proposal

## Why

Pausing only turns the volume down. Sounds already playing run to their end while the picture holds, so on resume a
voice line is gone while the speaker's mouth still moves and the subtitle sits over silence. Doors, reloads and some
timers also keep running during pause, and tutorial pop-ups freeze characters while voices carry on.

## What Changes

- The pause menu, map, save station screen and tutorial pop-ups freeze the scene. Scene sound is held and resumes from
  the same point.
- The pause menu, map and save station screen keep the menu theme and interface sounds. Tutorial pop-ups are silent.
- Doors, reloads, weapon movement, scene effects and anything waiting on an amount of play time (death restart, title
  card, cutscene skip, delayed sound effects) freeze with the scene.
- Loading a save, restarting or quitting to title discards held sound, so nothing from the old moment is heard.
- Hiding the game's tab during play opens the pause menu, even when the game has not captured the mouse.
- **BREAKING**: room ambience, equipment loops and conversation murmur no longer continue quietly under pause, and a
  scene's own music no longer continues dipped under the pause menu. The menu theme plays there instead.

## Capabilities

### New Capabilities

- `game-pause`: what holds still and what is still heard while the game is paused or waiting on a tutorial pop-up, and
  how play resumes from the same moment.

### Modified Capabilities

- `audio-mix`: the master stage and limiter rules allow scene sound and menu sound to be held independently; pause
  ducking applies to menu sound only.
- `in-world-audio`: ambience, prop loops, murmur and scripted scene music are held under pause instead of playing
  quietly.

## Impact

- Audio: `src/audio/engine.ts`, `menuMusic.ts`, `ambience.ts`, `propAudio.ts`, `murmur.ts`, `footsteps.ts`,
  `casings.ts`, the Web Audio test fake, and `src/dialogue/voicePlayer.ts`.
- App and game: `src/app/shell.ts`, `src/app/session.ts`, `src/game/game.ts`, `src/game/cutscene.ts`,
  `src/script/gameHost.ts`.
- UI: `src/ui/titleCard.ts`, `src/ui/hud/playerHud.ts`, `src/ui/tutorialPrompts.ts`.
- No new dependencies, and no change to save data or level data.
- A second audio output adds a little memory and needs the decoded-audio figure re-measured (`runtime-memory`).

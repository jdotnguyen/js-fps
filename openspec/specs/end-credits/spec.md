# end-credits Specification

## Purpose
Defines the presentation and audio handoff of the in-game end credits overlay, including how music carries from the ending surveillance stinger into the credits and transitions back to the title menu.

## Requirements

### Requirement: Surveillance stinger music continues into the end credits
When the slice finishes and opens the end credits directly (`instant`), the active surveillance score (`labB` `kill:still` from `stinger_priya`) SHALL continue playing seamlessly underneath the credits rather than cutting to silence or starting the menu theme. While the credits remain open, the menu theme SHALL stay held silent (`menuMusic.hold(true)`).

#### Scenario: Seamless carry from CAM 04 stinger to credits
- **WHEN** `stinger_priya` finishes and triggers `endSlice` -> `showCredits({ instant: true })` while `labB` `kill:still` is playing
- **THEN** the `labB` `kill:still` score continues playing without interruption underneath the end credits
- **AND** the menu theme does not start while the credits are open

#### Scenario: Returning to the title when credits close
- **WHEN** the end credits finish or are closed by the player
- **THEN** the carried surveillance score fades out over ~3 s (`fadeOutAll`) while the title menu theme fades back in over the same duration

### Requirement: End credits open directly over the stinger blackout
When triggered by `endSlice`, the end credits SHALL cover the black frame immediately (`instant`, with no fade-in exposing the game or title menu underneath) and only then return the underlying session to the title screen, without playing the title menu open sting while the credits are visible.

#### Scenario: No flash or menu sting between stinger and credits
- **WHEN** `stinger_priya` fades to black and calls `endSlice`
- **THEN** the end credits appear opaque over the black with no frame of the game world or title menu visible in between and no menu open sting

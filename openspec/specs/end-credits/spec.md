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

### Requirement: End credits fade in over the stinger blackout
After `stinger_priya` holds on green static for 2.8 s and cuts to black (`s: 0`), it SHALL hold on black for 3.5 s while the surveillance score continues before calling `endSlice`. When triggered by `endSlice`, the end credits SHALL fade in smoothly over the black frame (`fromSlice: true`, starting on the director credit) and only then return the underlying session to the title screen once opaque, without playing the title menu open sting while the credits are visible.

#### Scenario: Clean fade from blackout to credits
- **WHEN** `stinger_priya` holds on static for 2.8 s, cuts to black, holds for 3.5 s, and calls `endSlice`
- **THEN** the end credits fade in smoothly over the black frame with no frame of the game world or title menu visible in between and no menu open sting

### Requirement: Escape on the closing credits goes to the main menu
Pressing Escape on the credits that `endSlice` opened SHALL end the session and show the main menu, at any point after they
open, including while they are still fading in. The game world SHALL NOT be shown again.

#### Scenario: Skipping while they fade in
- **WHEN** the player presses Escape before the end credits are fully opaque
- **THEN** the session is gone and the main menu is shown, with no frame of the game world

#### Scenario: Skipping during the roll
- **WHEN** the player presses Escape during the credit roll after the slice
- **THEN** the main menu is shown

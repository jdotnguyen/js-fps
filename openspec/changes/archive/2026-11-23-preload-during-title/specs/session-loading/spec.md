## MODIFIED Requirements

### Requirement: Title screen opens without loading a 3D session
Booting the game to the title screen SHALL initialize the application shell (settings, saves, menu UI, UI interaction sounds, title music, splash sequence, and a lightweight non-WebGL title backdrop). It SHALL NOT create a renderer or hold GPU resources before the player starts or loads a playthrough (a context that only reads the GPU limits and is released at once is allowed). It MAY fetch and prepare session assets that need no renderer, including building the default level's world in memory, as the `title-preload` capability defines.

#### Scenario: Cold boot to title menu
- **WHEN** the player opens the game URL with no debug or sandbox auto-load parameters
- **THEN** the splash sequence and title menu appear without creating a renderer
- **AND** nothing is uploaded to the GPU and no frame is rendered while on the title screen

#### Scenario: Changing graphics quality on the title screen
- **WHEN** the player changes the graphics quality setting on the title screen and then starts a game
- **THEN** the session generates and loads textures and rendering settings directly for that selected quality tier

## ADDED Requirements

### Requirement: The splash plays in full
After the player unlocks audio with a click or key press, the splash sequence SHALL play to its end and SHALL NOT be skippable. The audio-unlock prompt SHALL stay. Debug and sandbox URLs that bypass the splash SHALL keep doing so.

#### Scenario: Pressing a key during the splash
- **WHEN** the player presses Escape, Enter, Space or clicks while a splash stage is playing
- **THEN** the splash keeps playing and reaches the title menu at its normal time

#### Scenario: Developer URL with the splash disabled
- **WHEN** the game is opened with `?nosplash`
- **THEN** the splash is not shown and the title or the requested session loads as before

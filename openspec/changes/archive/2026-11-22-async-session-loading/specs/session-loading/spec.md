# Spec Delta

## Purpose

Defines fast shell-only startup with a non-WebGL title backdrop, staged asynchronous session loading with responsive progress feedback, pre-warmed rendering and audio to prevent start-of-play and mid-game stutters, clean resource disposal when returning to the title screen, and automatic loading for developer/sandbox URLs.

## ADDED Requirements

### Requirement: Title screen opens without loading a 3D session
Booting the game to the title screen SHALL initialize only the application shell (settings, saves, menu UI, UI interaction sounds, title music, splash sequence, and a lightweight non-WebGL title backdrop). It SHALL NOT create a WebGL rendering context, fetch level files, download 3D models or photo textures, build a navmesh, or synthesize gameplay sound effects before the player starts or loads a playthrough.

#### Scenario: Cold boot to title menu
- **WHEN** the player opens the game URL with no debug or sandbox auto-load parameters
- **THEN** the splash sequence and title menu appear without creating a WebGL context
- **AND** no level JSON, 3D model (`.glb`), photo texture (`.webp`), navmesh WASM, physics WASM, or gameplay VO audio file is fetched while on the title screen

#### Scenario: Changing graphics quality on the title screen
- **WHEN** the player changes the graphics quality setting on the title screen and then starts a game
- **THEN** the session generates and loads textures and rendering settings directly for that selected quality tier

### Requirement: Lightweight atmospheric 2D title backdrop
The title screen SHALL display a lightweight CSS/SVG and subtle ambient 2D canvas backdrop aligned with the station visor aesthetic, respecting the reduced-motion and reduced-flashing accessibility settings.

#### Scenario: Reduced motion on title screen
- **WHEN** reduced motion is enabled in settings or system preferences while on the title screen
- **THEN** ambient backdrop animation pauses or reduces to a static presentation while keeping the menu legible

### Requirement: Staged asynchronous loading screen on session start
Selecting **New game**, **Continue**, or **Load game** from the title screen SHALL display a fullscreen loading screen featuring a station graphic, a progress bar, and a stage label while the session loads asynchronously. Loading work SHALL yield between stages and chunks so the progress bar and UI remain responsive throughout the load.

#### Scenario: Starting a new game
- **WHEN** the player chooses a save slot and difficulty under **New game**
- **THEN** the menu hides and the fullscreen loading screen appears with a station graphic, progress bar, and stage label
- **AND** the progress bar advances monotonically across loading stages without freezing the UI for multi-second blocks

#### Scenario: Continuing or loading a saved game
- **WHEN** the player chooses **Continue** or selects a save under **Load game** from the title screen
- **THEN** the loading screen appears, builds the session, restores the save state, and transitions into the restored playthrough

#### Scenario: Load failure recovery
- **WHEN** a required level asset fails to load during session startup
- **THEN** the loading screen clears cleanly, any partially allocated session resources are disposed, and a readable error is presented instead of leaving the player stuck on the loading screen

### Requirement: Stutter-free transition into gameplay and mid-game play
Before the loading screen fades out, the session SHALL pre-warm its rendering pipelines and textures across all rooms, cast and enemy body shaders, viewmodel, gore effects, standing water reflections/ripples, and security camera feed shaders, and SHALL initialize enabled physics before play starts. Background decoding of non-critical sound effects and voice-over clips SHALL be throttled so it does not compete with active gameplay frames.

#### Scenario: First frame of a new game
- **WHEN** the loading screen completes for a new game on `slice01`
- **THEN** the opening cutscene fades in without a multi-frame shader-compilation or texture-upload freeze

#### Scenario: Entering new rooms and first combat encounters
- **WHEN** the player enters a newly opened room (including flooded rooms), triggers a security camera feed, or encounters and damages the first enemy
- **THEN** textures, body shaders, gore decals, water reflection targets, and feed shaders are already prepared and do not cause a first-use compilation stall

### Requirement: Seamless handoff into gameplay without an extra click gate
When session loading reaches 100%, the loading screen SHALL fade directly into gameplay without requiring an intermediate confirmation screen.

#### Scenario: New game intro handoff
- **WHEN** a new game finishes loading on a level with an intro sequence
- **THEN** the loading screen fades directly into the on-rails intro and mouse capture activates on the player's click once free control begins

#### Scenario: Continue or Load game handoff
- **WHEN** a saved game finishes loading from the title screen
- **THEN** the loading screen fades directly into the live scene and displays the existing click-to-continue prompt until the player clicks to capture the mouse

### Requirement: Returning to the title screen disposes the play session
Selecting **Quit to title** SHALL stop the simulation and render loop, dispose the active 3D world, navmesh, physics world, post-processing targets, water and camera-feed targets, characters, viewmodel, gore, textures, materials, session voice-over buffers, and WebGL context, and return to the non-WebGL 2D title backdrop.

#### Scenario: Quit to title and start again
- **WHEN** the player quits to the title screen and starts a new game or loads a save
- **THEN** the previous session has been fully torn down and a fresh session loads cleanly without duplicated event listeners, leaked audio loops, or stale level state

### Requirement: Developer and sandbox URLs auto-trigger session loading
Opening the game with developer or sandbox URL parameters that target an in-world state (`?debug&jump=`, `?level=`, `?enemies=`, `?seq=`) SHALL automatically bypass the title menu and run the session loading pipeline directly into the requested level or jump state.

#### Scenario: Debug jump URL
- **WHEN** the game is opened with `?level=slice01&debug&jump=r11` (with or without `?nosplash`)
- **THEN** the shell automatically launches session loading and enters the `r11` jump state without requiring manual menu navigation

#### Scenario: Sandbox level URL
- **WHEN** the game is opened with `?level=lab` or `?level=corner` or `?level=demo`
- **THEN** the shell automatically loads that sandbox level via the loading screen and enters play

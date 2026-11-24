# title-preload Specification

## Purpose

Prepares the first play session's player-independent assets and engines while the splash and title menu show, without a renderer or GPU resources, so starting a game loads faster while falling back cleanly to a normal load.

## Requirements

### Requirement: The title prepares the session's player-independent assets
While the splash and title menu are showing, the shell SHALL prepare the assets and engines a session needs that do not depend on which menu entry the player picks and do not need a WebGL context. The title SHALL create no renderer and hold no resources on the GPU; a context that exists only to read the GPU's limits is allowed if it is released at once.

#### Scenario: What gets prepared
- **WHEN** preparation has finished on the title
- **THEN** the session, mocap, physics and navmesh code and wasm, the default level's data, built world and navmesh, the body, weapon and environment models, the mocap packs, the procedural textures, the procedural sound effects and the gameplay samples are ready

#### Scenario: The prepared world is used whole
- **WHEN** a session adopts the prepared world for the default level
- **THEN** it plays with the same level state, events and inventory as a world built during the load
- **AND** no part of that world was built by the loading screen

#### Scenario: Preparing during the splash
- **WHEN** the game boots to the title with no debug or sandbox auto-load parameters
- **THEN** preparation starts as soon as the title is entered, behind the splash, without waiting for the audio-unlock click
- **AND** no renderer exists and nothing is held on the GPU at any point on the title

#### Scenario: Preparing during the splash on auto-load URLs
- **WHEN** the game boots with debug or sandbox auto-load URL parameters (`?level=`, `?debug&jump=`, `?enemies=`, `?seq=`)
- **THEN** preparation starts behind the splash for the requested station level (or shared assets only for sandbox levels) without creating a renderer
- **AND** the auto-loaded session adopts any matching prepared results when the splash finishes

#### Scenario: Starting a game after preparation finished
- **WHEN** the player chooses New game, Continue or Load game on the default level after preparation finished
- **THEN** the loading screen does not fetch, synthesize, decode or build anything that preparation already produced
- **AND** the session reaches gameplay with the same behavior as an unprepared load

### Requirement: Prepared results are keyed by level, quality and GPU limits
Prepared results SHALL be valid only for the level, graphics quality and GPU limits they were made for. Changing the graphics quality on the title SHALL discard the quality-dependent results, including the built world, and prepare them again. A session SHALL use prepared results only when the level, quality and GPU limits all match. A discarded result SHALL release what it holds.

#### Scenario: Changing quality on the title
- **WHEN** the player changes the graphics quality on the title after preparation has started or finished
- **THEN** the textures and any other quality-dependent results made for the old quality are discarded and prepared again
- **AND** the next session loads with textures generated for the newly selected quality

#### Scenario: Loading a save on a different level
- **WHEN** the player chooses a save whose level is not the prepared level
- **THEN** the level-specific results (level data, built world, navmesh) are dropped and built by the normal load
- **AND** the shared engines, models, mocap packs, sounds and samples that preparation produced are still used

### Requirement: Preparation yields to the splash, the menu and the music
Preparation SHALL NOT make the splash animation, the title menu, the menu music or the title backdrop stutter. Work SHALL run in workers where it can, and otherwise in short slices that yield between them. Player interaction with the menu SHALL pause main-thread slices until the menu is idle.

#### Scenario: The splash stays smooth
- **WHEN** the splash is playing while the title prepares the first session
- **THEN** preparation hands the thread back after short slices of work, and work that cannot be cut into short slices waits until the splash has ended
- **AND** the splash does not show a frame stall of a quarter of a second or more

#### Scenario: Menu interaction during preparation
- **WHEN** the player moves through the title menu while preparation is running
- **THEN** menu input responds without a visible multi-frame stall
- **AND** preparation resumes when the menu is idle

### Requirement: A missing or failed preparation falls back to the normal load
A session SHALL be able to load with no preparation, a partial preparation or a failed preparation, and SHALL behave the same as a load that prepared nothing. A failed preparation SHALL NOT block or fail Continue, Load game or New game, and SHALL NOT leave stale results that a later session reuses.

#### Scenario: Starting before preparation finishes
- **WHEN** the player chooses a menu entry while preparation is still running
- **THEN** the loading screen waits for the work already in flight and does not start it a second time
- **AND** work that was not started yet runs as part of the load

#### Scenario: A preparation step fails
- **WHEN** a preparation step fails, for example a model download
- **THEN** that result is discarded and the title keeps working
- **AND** the next load builds it as the normal load does, and reports the real error only if that also fails

### Requirement: Returning to the title prepares again
After **Quit to title** disposes a session, the shell SHALL prepare again for the title it returns to. Results that the disposed session adopted SHALL NOT be reused by the next session.

#### Scenario: Quit to title and start again
- **WHEN** the player quits to the title and then starts or loads a game
- **THEN** the next session's textures, sounds and navmesh come from a fresh preparation or a normal load
- **AND** nothing is shared with the disposed session

### Requirement: Session loading reports per-stage timings
A session load SHALL log how long each loading stage took and how much of its work came from prepared results, so loads can be compared with and without preparation.

#### Scenario: Reading the timings
- **WHEN** a session finishes loading
- **THEN** the console reports a duration for each loading stage and the total
- **AND** each stage says whether it used prepared results

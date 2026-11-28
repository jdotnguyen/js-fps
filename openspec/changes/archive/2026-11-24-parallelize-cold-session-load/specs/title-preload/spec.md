# Spec Delta

## MODIFIED Requirements

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

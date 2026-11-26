# physics-world Specification

## Purpose

Hosts the rigid-body physics simulation for a level: when it loads, how it steps, what static world it collides with, how it is switched on and off, and what happens when it is unavailable.

## Requirements

### Requirement: Physics loads on demand
The physics engine SHALL NOT be part of the initial game bundle. It SHALL be fetched only when a level with at least one physics feature switched on starts loading, and the title screen SHALL NOT wait for it.

#### Scenario: Title screen
- **WHEN** the game is opened and stays on the title screen
- **THEN** no physics engine code or WebAssembly has been downloaded

#### Scenario: All physics switched off
- **WHEN** every physics feature is switched off and a level is played
- **THEN** the physics engine is never downloaded

### Requirement: Game works without physics
Whenever the physics engine is switched off, fails to load, or has not finished loading, every feature that uses it SHALL behave as it did before this change. Nothing SHALL stall, error or wait for it.

#### Scenario: Engine fails to load
- **WHEN** the physics engine download fails
- **THEN** the level plays with floor-only debris and authored corpse poses
- **AND** a single warning is logged

#### Scenario: Kill before the engine is ready
- **WHEN** a limb is severed before the engine has finished loading
- **THEN** that limb uses the fallback motion and nothing waits for the engine

### Requirement: Physics collides with the level as the player does
The physics world SHALL contain a static collider for every enabled box of the level's player collision. A door's static collider SHALL be present exactly when the door's player collider is enabled.

#### Scenario: Wall
- **WHEN** a physical body is thrown at a wall the player cannot walk through
- **THEN** it does not pass through the wall

#### Scenario: Door opens
- **WHEN** a door opens far enough that the player can pass
- **THEN** physical bodies can also pass through the doorway

#### Scenario: Door closes on a body
- **WHEN** a door closes while a physical body lies in the doorway
- **THEN** the body is pushed out of the door's volume or left resting against it, never left inside it

### Requirement: Fixed simulation step
Physics SHALL advance in the game's fixed simulation step, independent of frame rate, and SHALL NOT advance while the game is paused.

#### Scenario: Pause
- **WHEN** the pause menu is open
- **THEN** no physical body moves

#### Scenario: Low frame rate
- **WHEN** the frame rate drops to 30 fps
- **THEN** bodies fall and settle at the same speed as at 60 fps

### Requirement: Each physics feature has its own switch
Severed debris and physical interaction SHALL each be switchable on and off independently, by a URL flag and by a stored setting, and switching one off SHALL NOT affect the other beyond the fallbacks they define. Both SHALL be on by default.

#### Scenario: New or earlier save
- **WHEN** the game starts with no stored settings, or with settings saved while physics defaulted off
- **THEN** severed debris and physical interaction are on

#### Scenario: Debris on, interaction off
- **WHEN** severed debris is switched on and physical interaction is switched off
- **THEN** severed limbs collide physically, and neither the player nor a scripted kill pushes any body

### Requirement: Physics stays within its time budget
The physics step SHALL take no more than 1.5 ms per frame on average, and no more than 3 ms in any frame, during the heaviest combat of the slice on the target hardware (the developer's desktop PC) at High.

#### Scenario: Heaviest fight
- **WHEN** the heaviest slice combat is played with every physics feature on
- **THEN** the measured average and peak physics step times are within budget

### Requirement: Physics colliders can be inspected
With the debug flag set, a view SHALL draw every physics collider and mark each body as active, asleep or frozen.

#### Scenario: Debug view
- **WHEN** the game runs with `?debug` and the physics view is turned on
- **THEN** static colliders, dynamic bodies and their sleep state are drawn over the scene

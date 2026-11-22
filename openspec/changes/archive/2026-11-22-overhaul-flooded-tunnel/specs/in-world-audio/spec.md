# Spec Delta

## MODIFIED Requirements

### Requirement: Footsteps by surface
Footsteps for the player and every body SHALL use the sound bank for the floor surface: concrete, metal plate, grate,
rubber or water. Steps SHALL scale with gait (pivot, walk, jog, shamble, heavy). Each actor SHALL have a slightly
different pitch so boots are distinguishable. Steps in water SHALL be wading sounds that get heavier with depth.

#### Scenario: Corridor to grating
- **WHEN** the player walks off a concrete floor onto a grate
- **THEN** the step sounds change from concrete to grate on the first step on the grate

#### Scenario: Into the water
- **WHEN** the player walks down the stairs into standing water
- **THEN** the first submerged step plays a splash, and later steps are wading sounds, heavier on each deeper step

## ADDED Requirements

### Requirement: Wading slosh
While a body moves through standing water, it SHALL play a positional slosh loop that follows its speed and depth and
fades out when it stops. Other bodies' slosh SHALL follow the same range and occlusion rules as their footsteps.

#### Scenario: Stopping in the water
- **WHEN** Jay stops moving in the water
- **THEN** his slosh fades out within about half a second, leaving only the water settling

### Requirement: Jumping and landing in water
A jump that starts in water SHALL play a takeoff splash. Landing in water SHALL play a splash scaled to the fall height
in place of the landing footstep. Landing on a dry top after a jump from the water SHALL play that top's landing
footstep followed by water dripping off Jay.

#### Scenario: Jump onto a case
- **WHEN** Jay jumps from the water onto a steel case
- **THEN** a takeoff splash plays, then a metal landing step and dripping

#### Scenario: Landing back in the water
- **WHEN** Jay drops from the case back into the water
- **THEN** a landing splash plays, and no dry landing footstep plays

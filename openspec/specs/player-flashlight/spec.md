# player-flashlight Specification

## Purpose

Defines the flashlight beam the player carries in first person: where it leaves from whatever weapon is drawn, how it follows the view, and the lens pattern it casts. There is no flashlight model on screen.

## Requirements

### Requirement: The beam has a lens pattern
The flashlight beam SHALL project a subtle lens pattern: a brighter hot spot, a faint ring towards the edge, and slight uneven smudging. The pattern SHALL stay faint enough that the lit spot still reads as one even pool of light, and it SHALL appear on every tier.

#### Scenario: Beam on a flat wall
- **WHEN** the flashlight is on and the player faces a flat wall 2 m away
- **THEN** the lit spot is brightest near its centre, shows a faint ring near its edge, and has no hard-edged shapes inside it

#### Scenario: Low tier
- **WHEN** quality is Low and the flashlight is on
- **THEN** the beam shows the same lens pattern as on High

### Requirement: The beam leaves the chest whatever is drawn
The flashlight SHALL be only a beam: no flashlight model SHALL be on screen. The beam SHALL come from a point low and to the left of the camera, as if carried at the chest, with the pistol drawn, the shotgun drawn or no weapon out, and switching weapons SHALL NOT change it.

#### Scenario: Pistol, shotgun and no weapon
- **WHEN** the flashlight is on and the player draws the pistol, then the shotgun, then holsters
- **THEN** the beam stays on and leaves the same chest-left point each time, and no flashlight model is ever on screen

#### Scenario: Switching on and off
- **WHEN** the player presses the flashlight key
- **THEN** the beam fades in over under 0.3 s, and pressing it again fades it out, with nothing rising or lowering on screen

### Requirement: The beam follows the view with no delay
The beam direction SHALL equal the camera's look direction on every frame. It SHALL NOT trail, overshoot or ease behind the view while the player turns, looks up or down, or lands from a jump.

#### Scenario: Fast turn
- **WHEN** the flashlight is on and the player turns 90° in a quarter of a second
- **THEN** on every frame of the turn the beam's direction equals the camera's look direction

#### Scenario: Stopping a turn
- **WHEN** the player stops turning
- **THEN** the beam stops on that frame and does not drift on

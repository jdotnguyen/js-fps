# Spec Delta

## Purpose

Defines the flashlight the player sees in first person: when the model is on screen, where it sits, and how it relates to the weapons and to the beam it casts.

## ADDED Requirements

### Requirement: The flashlight is seen while it is on
While the flashlight is on and the pistol or no weapon is drawn, a flashlight model SHALL be on screen. While the flashlight is off, the model SHALL NOT be on screen. Switching it on or off SHALL bring the model up or lower it over 0.15 s to 0.35 s, never in one frame.

#### Scenario: Switching on with the pistol
- **WHEN** the player has the pistol drawn and presses the flashlight key
- **THEN** the flashlight model rises into the lower left of the screen within 0.35 s and the beam comes on

#### Scenario: Switching off
- **WHEN** the player presses the flashlight key again
- **THEN** the model lowers out of view within 0.35 s and the beam goes off

### Requirement: The flashlight never looks like it is floating
The flashlight model SHALL sit close to the camera in the lower left of the screen, pointing forward, with its tail running off the left or bottom edge of the screen at every supported aspect ratio and field of view. No hand or arm SHALL be drawn holding it, and its tail end SHALL never be visible.

#### Scenario: Widescreen and narrow windows
- **WHEN** the flashlight is on with the pistol drawn at 16:9, 21:9 and 4:3, at the lowest and highest field-of-view settings
- **THEN** in each case the lens end is on screen and the model leaves the screen through its left or bottom edge

#### Scenario: Aiming and moving
- **WHEN** the player aims, sprints, jumps or reloads the pistol with the flashlight on
- **THEN** the model sways with the view and its tail stays off screen

### Requirement: The shotgun puts the flashlight away
With the shotgun drawn, the flashlight model SHALL NOT be on screen, and a flashlight that is on SHALL stay on, its beam coming from the chest as it does without the model.

#### Scenario: Switching to the shotgun
- **WHEN** the flashlight is on with the pistol drawn and the player switches to the shotgun
- **THEN** the flashlight model lowers out of view and the beam stays on

#### Scenario: Back to the pistol
- **WHEN** the player switches back to the pistol with the flashlight still on
- **THEN** the flashlight model rises back into view

### Requirement: The beam comes from the model
While the flashlight model is on screen, the beam SHALL appear to leave the model's lens, and its glass SHALL glow when the flashlight is on.

#### Scenario: Lens and beam line up
- **WHEN** the flashlight is on with the pistol drawn and the player faces a wall 3 m away
- **THEN** the lit spot on the wall is centred within 10° of the direction the lens points, and the lens glows

### Requirement: The flashlight model is credited
The flashlight model SHALL be "Flashlight" by MAR.COS. (https://sketchfab.com/3d-models/flashlight-5fa9a65e7b0141ee877ed18f4f42d953), used under CC BY 4.0, and SHALL be credited with its author, link and license in the game's credits.

#### Scenario: Credits list the model
- **WHEN** the player opens the credits
- **THEN** the flashlight is listed with "MAR.COS.", the model page and "CC BY 4.0"

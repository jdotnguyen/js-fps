# Spec Delta

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: The flashlight is seen while it is on
**Reason**: The flashlight model is dropped. Both new weapons are held with two hands, so there is no free hand for it, and the beam now comes from the chest with every weapon.
**Migration**: The beam alone shows the flashlight is on. See "The beam leaves the chest whatever is drawn".

### Requirement: The flashlight never looks like it is floating
**Reason**: There is no flashlight model on screen to float.
**Migration**: None. The weapons' own arms are covered by "No hand or forearm floats in view" in `weapon-viewmodels`.

### Requirement: The shotgun puts the flashlight away
**Reason**: There is no model to put away, and the beam behaves the same with every weapon.
**Migration**: See "The beam leaves the chest whatever is drawn".

### Requirement: The beam comes from the model
**Reason**: The beam no longer has a model to come from, and the lens glow goes with it.
**Migration**: See "The beam leaves the chest whatever is drawn".

### Requirement: The flashlight model is credited
**Reason**: The "Flashlight" model by MAR.COS. is no longer shipped, so its credit is removed.
**Migration**: None.

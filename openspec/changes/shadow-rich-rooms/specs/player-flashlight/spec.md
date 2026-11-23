# Spec Delta

## ADDED Requirements

### Requirement: The beam has a lens pattern
The flashlight beam SHALL project a subtle lens pattern: a brighter hot spot, a faint ring towards the edge, and slight uneven smudging. The pattern SHALL stay faint enough that the lit spot still reads as one even pool of light, and it SHALL appear on every tier.

#### Scenario: Beam on a flat wall
- **WHEN** the flashlight is on and the player faces a flat wall 2 m away
- **THEN** the lit spot is brightest near its centre, shows a faint ring near its edge, and has no hard-edged shapes inside it

#### Scenario: Low tier
- **WHEN** quality is Low and the flashlight is on
- **THEN** the beam shows the same lens pattern as on High

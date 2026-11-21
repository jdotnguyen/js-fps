# Spec Delta

## ADDED Requirements

### Requirement: Shadows have soft edges
Shadows cast by the flashlight and by shadow-casting room lights SHALL have soft edges, without visible stair-steps or banding.

#### Scenario: Flashlight on a chair
- **WHEN** the flashlight shines on a chair near a wall
- **THEN** the chair's shadow on the wall has a soft edge with no stair-stepped outline

#### Scenario: Sofa under the gallery lamp
- **WHEN** quality is High and the east lamp in the Observation Gallery lights the sofa
- **THEN** the sofa's shadow on the carpet has a soft edge with no stair-stepped outline

# Spec Delta

## MODIFIED Requirements

### Requirement: Area material palettes
Wall and floor pieces SHALL take their materials from the room's area palette unless the level data overrides them for that piece.

#### Scenario: Dive bay floors
- **WHEN** the dive bay area is built
- **THEN** its floors use clean treadplate, with grating around the launch trunk, and no rusty treadplate

#### Scenario: Dive bay maintenance corridor
- **WHEN** the dive bay's maintenance corridor (R13d) is built
- **THEN** the level data overrides its walls and floor with rust materials, so it alone in the dive bay looks decayed

#### Scenario: Lab B after the outbreak
- **WHEN** the outbreak sequence event fires
- **THEN** Lab B's floor material changes from `labTile` to `tileBroken`

#### Scenario: Lab wing walls
- **WHEN** the lab wing (R04, R05, R06) is built
- **THEN** its walls use clean panel materials with a slate service band, and no rust or peeling-paint material

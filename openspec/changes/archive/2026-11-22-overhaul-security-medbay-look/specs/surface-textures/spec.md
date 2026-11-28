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

#### Scenario: Security office surfaces
- **WHEN** the security area (`R07`) is built
- **THEN** its walls, ceiling, trim, and door frames use clean materials (`cleanSlate`, clean upper band, `officeCeiling`, `steelBrushed`, `steelDark`) with no rust or peeling-paint material

#### Scenario: Armory lighter walls
- **WHEN** the armory (`R07a`) is built
- **THEN** the level data overrides its walls with lighter clean wall panels (`cleanWall`) so it reads brighter than `R07`

#### Scenario: Medical bay and surgery surfaces
- **WHEN** the medbay area (`R08`, `R08b`) is built
- **THEN** its lower walls use clean white wall tiles, its upper band uses clean clinical teal (`cleanTeal`), its ceiling uses `officeCeiling`, its floor uses `labTile`, and no surface uses a rust or peeling-paint material

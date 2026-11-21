# room-visibility Specification

## Purpose

Defines which rooms the level draws for the room the camera is in, so that every surface the player can see through shows what is really behind it.

## Requirements

### Requirement: Glass partitions are see-through from both sides
When the camera is in either room joined by a glass partition, the level SHALL draw the room on the other side and the glass partition itself, whichever room owns the glass. Standing on either side, the player SHALL see the other room and the glass between them, never an empty gap.

#### Scenario: Looking out of Lab B at the gallery
- **WHEN** the player stands in Lab B and looks north through the glass
- **THEN** the Observation Gallery is drawn, with its walls, furniture and lights, and the glass panes are drawn between the two rooms

#### Scenario: Looking into Lab B from the gallery
- **WHEN** the player stands in the Observation Gallery and looks south through the glass
- **THEN** Lab B is drawn as before

#### Scenario: No void behind the glass
- **WHEN** the camera is in any room that shares a glass partition with another room
- **THEN** no part of the view through that partition shows the empty background where the other room's walls, floor or ceiling should be

#### Scenario: Cracks and blood seen from behind
- **WHEN** the Lab B glass is cracked or bloodied after Voss's death and the player looks at it from inside Lab B
- **THEN** the cracks and the blood show on the glass, as they do from the gallery

### Requirement: Glass partitions show only the room behind them
Seeing through a glass partition SHALL draw the room directly behind it, and SHALL NOT by itself draw rooms that are only reachable from that room.

#### Scenario: Gallery seen from Lab B does not pull in the commons
- **WHEN** the player stands in Lab B and the Observation Gallery is drawn through the glass
- **THEN** the commons is not drawn because of the glass

### Requirement: Level data declares glass visibility both ways
Every level's data SHALL mark each pair of rooms joined by a glass partition as visible from each other. The level tests SHALL check every glass partition in every level and fail on a one-way pair, naming both rooms and the partition's cell edge.

#### Scenario: One-way glass in level data
- **WHEN** a level has a glass partition between two rooms and only one of them is visible from the other
- **THEN** the level tests fail and name both rooms and the cell edge of the partition

#### Scenario: Glass declared both ways
- **WHEN** every glass partition in a level joins rooms that are each visible from the other
- **THEN** the glass visibility check passes

# Spec Delta

## ADDED Requirements

### Requirement: Sunken room floors
A room SHALL be able to set a floor height below its deck level. Its floor, walls and wall finishes SHALL reach down to
that height with no gaps, and doors SHALL stay at deck level. Stairs SHALL be able to join the sunken floor to a landing
at deck level.

#### Scenario: Walls reach the sunken floor
- **WHEN** a room's floor is set 1.2 m below deck level
- **THEN** its walls continue down to the floor without a gap or a visible seam at deck level

#### Scenario: Everything stands on the sunken floor
- **WHEN** a spawn, anchor, pickup or prop is placed on a sunken floor
- **THEN** it stands on that floor, not at deck level

### Requirement: Pressure door with a porthole
The pressure door SHALL be able to have a round glass porthole that can be seen through from both sides, including when
the door is closed and the far side is flooded.

#### Scenario: Looking through a sealed porthole
- **WHEN** the R09–R10 door is sealed with R09 flooded
- **THEN** looking through the porthole from R10 shows murky water pressing against the glass

### Requirement: A sliding door can be forced partly open
A sequence SHALL be able to force a sliding door's leaves to a part-open position over a given time without changing the
door's state, so a sealed door stays sealed while something pries it. The door's next state change SHALL close or open it
from that position.

#### Scenario: Prying a sealed door
- **WHEN** a sequence forces the sealed R09–R10 door 30% open over a second, then seals it
- **THEN** the leaves part from the middle over that second while the door's screen stays red, then slam shut from the part-open position

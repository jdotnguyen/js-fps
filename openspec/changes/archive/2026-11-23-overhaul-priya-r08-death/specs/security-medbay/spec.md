# Spec Delta

## ADDED Requirements

### Requirement: The medical bay is the lit room on backup power
Under backup power the medical bay SHALL stay lit as on main power, while the security office SHALL stay on its backup
lights and standby beacon, and the surgery SHALL stay dim with its dying light. From the security office the medical bay
SHALL be clearly the brightest thing in view, and the player SHALL still be visible from the medical bay side.

#### Scenario: Lit room seen from the dark
- **WHEN** the player stands in the viewing strip under backup power and looks through the centre pane
- **THEN** the medical bay's average scene brightness is at least twice the security office's

#### Scenario: The surgery stays dark
- **WHEN** the surgery door is open under backup power
- **THEN** the surgery is lit only by its dim, unreliable light, and is much darker than the medical bay

#### Scenario: Jay can be seen
- **WHEN** the player stands in the viewing strip under backup power
- **THEN** a view from the medical bay side at head height toward the strip shows the player lit by the security office's standby beacon and backup lights

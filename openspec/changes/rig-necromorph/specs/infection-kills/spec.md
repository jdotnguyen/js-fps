# Spec Delta

## MODIFIED Requirements

### Requirement: The creature stays behind the glass until it breaks out
After a `grownInside` kill behind a glass partition, the creature SHALL hammer on the glass beside the victim's body, in
flurries of blows that are heard on the glass, until the level makes it escape. The escape SHALL happen in the dark: the
room's lights die, the creature is gone when they come back, and the room's ceiling vent is left open. The enemy the
player later fights SHALL be that creature (the same body), not a different infected.

#### Scenario: Pounding on the glass
- **WHEN** the Lab B kill has ended and the player watches from the gallery
- **THEN** the creature stands at the glass beside Voss's body and hits it again and again, each blow sounding on the glass

#### Scenario: Blades meet the pane
- **WHEN** a blow of the pounding lands
- **THEN** a blade strikes the pane within 10 cm of its surface, with no part of either blade more than 5 cm through it

#### Scenario: Gone when the lights come back
- **WHEN** the Lab B escape plays and Lab B's lights come back on
- **THEN** no creature is in Lab B, Voss's body is still beside the glass, and Lab B's ceiling vent grate hangs open

#### Scenario: The fight is the creature
- **WHEN** the creature drops into R06 during the cover-me fight
- **THEN** it has the creature's body
- **AND** no other body is left in Lab B

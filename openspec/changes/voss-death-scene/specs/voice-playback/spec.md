# Spec Delta

## MODIFIED Requirements

### Requirement: Voices carry through the station
A local voice SHALL travel from its speaker to the player through rooms and doorways. In the same room, or through an open doorway, it SHALL fade with distance as before. Each room boundary on the way SHALL make it duller and quieter, and a closed door much more so. Three or more boundaries away, or more than about 30 m along the way, it SHALL be silent. Glass between adjacent rooms SHALL dull it only slightly, except sealed observation glass, which SHALL muffle it at least as much as a closed door.

#### Scenario: Next room, door open
- **WHEN** Giles talks in the next room with the door between them open
- **THEN** the player hears him slightly muffled and quieter than in the same room, still clearly from Giles's side

#### Scenario: Behind a closed door
- **WHEN** a speaker talks in the next room with the door closed
- **THEN** the voice is strongly muffled and quiet, and becomes clear when the door opens

#### Scenario: Across the station
- **WHEN** Hale speaks in his office while the player is in the dive bay
- **THEN** nothing of his voice is heard

#### Scenario: Walking away mid-line
- **WHEN** the player walks out of a room while a line is playing in it
- **THEN** the voice dulls and fades as boundaries are crossed, during the line, not only at its next line

#### Scenario: Voss behind the sealed glass
- **WHEN** Voss speaks or screams in Lab B while the player stands in the gallery with the Lab B intercom live
- **THEN** her voice comes mainly from the intercom speaker, her direct voice through the glass is faint and dull, and her subtitle shows

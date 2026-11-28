# Spec Delta

## ADDED Requirements

### Requirement: World sound occlusion
A one-shot sound effect that comes from a position in the world SHALL be low-passed, quieter and slightly more reverberant when a wall or closed door stands between it and the player, as footsteps are. Low obstacles such as counters and crates SHALL NOT muffle it. Whether it is muffled SHALL be decided when it starts. Looping sounds, ambience, the radio, music, dialogue, the player's own sounds and sounds from scripted sequences and kills SHALL NOT be muffled this way.

#### Scenario: Groan behind a closed door
- **WHEN** an infected groans on the other side of a closed door
- **THEN** the groan is muffled and quieter than the same groan with nothing in between

#### Scenario: Door opened between groans
- **WHEN** the door between the player and a groaning infected opens, and the infected groans again
- **THEN** the new groan is clear

#### Scenario: Low obstacle
- **WHEN** an infected groans behind a waist-high counter in the same room as the player
- **THEN** the groan is not muffled

#### Scenario: A door's own sound
- **WHEN** a door opens or closes, and nothing but that door is between it and the player
- **THEN** its sound is clear from either side of the door

#### Scenario: A door beyond a wall
- **WHEN** a door in another room opens, with a wall between it and the player
- **THEN** its sound is muffled and quieter

#### Scenario: Scripted kill seen through glass
- **WHEN** a scripted kill plays its sounds in a room the player watches through glass
- **THEN** those sounds play as authored, not muffled

#### Scenario: Close source
- **WHEN** a sound plays within 0.6 m of the player
- **THEN** it is never muffled

### Requirement: Glass muffles lightly
A sound heard through a glass partition, with no wall or closed door also in the way, SHALL be only slightly quieter and duller: clearly audible, and much louder and brighter than the same sound behind a wall. This SHALL apply to footsteps and to the world sounds above. A wall or closed door anywhere between the sound and the player SHALL still muffle it fully.

#### Scenario: Monster at the window
- **WHEN** an infected groans or slams 1 m behind a glass partition the player stands 1.5 m in front of
- **THEN** the sound is slightly quieter and duller than with nothing in between, and clearly louder and brighter than through a wall

#### Scenario: Glass with a wall beyond it
- **WHEN** an infected groans in a room beyond a glass partition and a wall
- **THEN** the groan is fully muffled, as through a wall

#### Scenario: Steps behind the glass
- **WHEN** someone walks on the other side of a glass partition
- **THEN** their steps are only slightly quieter and duller

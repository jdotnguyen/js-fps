# Spec Delta

## MODIFIED Requirements

### Requirement: World sound occlusion
A one-shot sound effect that comes from a position in the world SHALL be low-passed, quieter and slightly more reverberant when a wall or closed door stands between it and the player, as footsteps are. Low obstacles such as counters and crates SHALL NOT muffle it. Whether it is muffled SHALL be decided when it starts. Looping sounds, ambience, the radio, music, the player's own sounds and sounds from scripted sequences and kills SHALL NOT be muffled this way. Local dialogue SHALL NOT use this rule either: it is muffled continuously by the voice propagation in voice-playback. Sealed observation glass SHALL muffle sounds from scripted sequences and kills too, as its own requirement says.

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
- **WHEN** a scripted kill plays its sounds in a room the player watches through glass that is not sealed
- **THEN** those sounds play as authored, not muffled

#### Scenario: Scripted kill behind sealed glass
- **WHEN** a scripted kill plays its sounds in a room the player watches through sealed observation glass
- **THEN** those sounds are muffled as sealed glass muffles, except those made on the pane itself

#### Scenario: Close source
- **WHEN** a sound plays within 0.6 m of the player
- **THEN** it is never muffled

#### Scenario: Dialogue behind a wall
- **WHEN** a squadmate speaks on the other side of a closed door
- **THEN** the line is muffled by voice propagation, and opening the door mid-line clears it during the line

### Requirement: Glass muffles lightly
A sound heard through a glass partition, with no wall or closed door also in the way, SHALL be only slightly quieter and duller: clearly audible, and much louder and brighter than the same sound behind a wall. This SHALL apply to footsteps and to the world sounds above. A wall or closed door anywhere between the sound and the player SHALL still muffle it fully. Sealed observation glass is the exception: it muffles hard, as its own requirement says.

#### Scenario: Monster at the window
- **WHEN** an infected groans or slams 1 m behind a glass partition the player stands 1.5 m in front of
- **THEN** the sound is slightly quieter and duller than with nothing in between, and clearly louder and brighter than through a wall

#### Scenario: Glass with a wall beyond it
- **WHEN** an infected groans in a room beyond a glass partition and a wall
- **THEN** the groan is fully muffled, as through a wall

#### Scenario: Steps behind the glass
- **WHEN** someone walks on the other side of a glass partition
- **THEN** their steps are only slightly quieter and duller

#### Scenario: The medical bay window
- **WHEN** a sound plays in the medical bay and the player hears it through the security office window
- **THEN** it is only slightly quieter and duller, as before this change

## ADDED Requirements

### Requirement: Sealed observation glass muffles hard
A pane marked sealed SHALL muffle every sound from its far side at least as much as a closed door: world sounds, footsteps
and the sounds of scripted sequences and kills. Lab B's observation glass SHALL be sealed and no other pane. A sound made
on the pane itself, within 0.3 m of it, SHALL be heard as through glass that is not sealed.

#### Scenario: Lab B through the intercom
- **WHEN** the Lab B intercom is live and a sound plays in the middle of Lab B while the player stands in the gallery
- **THEN** its copy from the intercom speaker is clearly louder than its direct sound through the glass

#### Scenario: Intercom off
- **WHEN** the Lab B intercom is off and a sound plays in the middle of Lab B
- **THEN** the player in the gallery hears it faint and dull, as through a closed door

#### Scenario: Hands on the pane
- **WHEN** Voss's palms hit the glass, blood hits it, or the creature pounds on it
- **THEN** the hit is heard from the pane as clearly as through glass that is not sealed

#### Scenario: Other glass unchanged
- **WHEN** a sound plays behind any other glass partition in the station
- **THEN** it is muffled only lightly

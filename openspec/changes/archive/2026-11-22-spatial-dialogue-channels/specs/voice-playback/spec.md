# Spec Delta

## MODIFIED Requirements

### Requirement: Local channel
Lines on the `local` channel SHALL be positioned at the speaker's head and follow the room reverb, and SHALL follow the speaker's head while it moves. They SHALL be heard through the station as the voice propagation requirement describes. A local line SHALL play centred only when its speaker is deliberately disembodied; every other local speaker SHALL have a body in the level.

#### Scenario: Squadmate behind the player
- **WHEN** Okafor speaks on the local channel while standing behind the player
- **THEN** his voice comes from behind, at his head height, with the room's reverb

#### Scenario: Director in his office
- **WHEN** Hale says his office lines while the player stands in the doorway
- **THEN** his voice comes from Hale's head in the office, not from the centre of the player's head

## ADDED Requirements

### Requirement: Every local speaker has a body
Each speaker with a local-channel line SHALL map to an NPC that stands in the level where the line is said, unless the speaker is listed as disembodied. The level tests SHALL fail for a local line whose speaker has no body and is not listed, naming the line and the speaker.

#### Scenario: Unmapped speaker
- **WHEN** a local line is added for a speaker that maps to no NPC in slice01 and is not listed as disembodied
- **THEN** the level tests fail and name the line and its speaker

#### Scenario: Maintenance tech in the dive bay
- **WHEN** the maintenance tech says "Lights are out down the back corridor again"
- **THEN** the voice comes from the tech standing in the dive bay

### Requirement: Voices carry through the station
A local voice SHALL travel from its speaker to the player through rooms and doorways. In the same room, or through an open doorway, it SHALL fade with distance as before. Each room boundary on the way SHALL make it duller and quieter, and a closed door much more so. Three or more boundaries away, or more than about 30 m along the way, it SHALL be silent. Glass between adjacent rooms SHALL dull it only slightly.

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

### Requirement: Subtitles follow the player's earshot
A local line's subtitle SHALL show only while its speaker is within 20 m of the player and its voice is audible. This SHALL be re-checked during the line: walking into range shows the subtitle for the rest of the line, and walking out hides it. Radio and PA subtitles SHALL show wherever the player is.

#### Scenario: A conversation far behind
- **WHEN** a scene plays 25 m from the player in a room they can still faintly hear
- **THEN** no subtitle for it is shown

#### Scenario: Walking into a conversation
- **WHEN** the player walks within 20 m of a speaker mid-line and can hear them
- **THEN** the subtitle appears for the rest of that line

#### Scenario: Close but sealed off
- **WHEN** a speaker is 12 m away behind several walls and their voice is silent
- **THEN** no subtitle is shown

#### Scenario: Briefing over the intercom
- **WHEN** Hale's morning briefing plays on the radio channel
- **THEN** its subtitles show wherever the player is

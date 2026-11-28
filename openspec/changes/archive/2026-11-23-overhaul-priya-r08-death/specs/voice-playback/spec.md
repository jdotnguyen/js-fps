# Spec Delta

## ADDED Requirements

### Requirement: Voices on a live intercom
A local line spoken in a room covered by a live intercom SHALL also play from the intercom's speaker, with the intercom's
comms tone. It SHALL still play at the speaker's head through voice propagation as before. Its subtitle SHALL show while
the player is in the speaker's room or a room opening onto it, as well as within the line's usual earshot.

#### Scenario: Priya over the intercom
- **WHEN** Priya speaks in the medical bay while its intercom is live and the player stands in the security office
- **THEN** her line is heard clearly from the intercom speaker with comms tone and crackle, and its subtitle shows

#### Scenario: From the armory doorway
- **WHEN** she speaks while the player stands in the armory next to the security office with its door open
- **THEN** her line is heard from the intercom speaker and its subtitle shows

### Requirement: A scene can project a voice
A sequence SHALL be able to project one speaker's voice for its length: while projected, that speaker's local lines SHALL be
no quieter than at a set distance, keeping their direction and room reverb, and SHALL never be louder than at the real
distance when the player is nearer. The projection SHALL end when the sequence ends.

#### Scenario: Across the room
- **WHEN** a sequence projects Okafor's voice at 3.5 m and he speaks 7 m from the player in the same room
- **THEN** his line is as loud as at 3.5 m and comes from his direction, with the room's reverb

#### Scenario: Nearer than the set distance
- **WHEN** the player stands 1 m from Okafor while his voice is projected
- **THEN** his line plays as an ordinary line from 1 m

#### Scenario: After the scene
- **WHEN** the sequence that projected Okafor's voice has ended
- **THEN** his lines fade with distance as ordinary local lines do

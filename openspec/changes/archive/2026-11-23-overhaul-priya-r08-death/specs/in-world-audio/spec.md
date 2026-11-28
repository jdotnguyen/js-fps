# Spec Delta

## ADDED Requirements

### Requirement: A live intercom relays a room
A room intercom SHALL link a source room to a speaker in another room. While it is live, every positioned world sound and
voice that starts in the source room, or in a room opening only onto it, SHALL also play from the speaker with a comms tone
and crackle. The direct sound SHALL be unchanged. An intercom that is off SHALL relay nothing.

#### Scenario: A sound in the source room
- **WHEN** an intercom from the medical bay is live and an instrument tray falls in the surgery beyond it
- **THEN** the fall is also heard from the speaker in the security office, band-limited and with crackle

#### Scenario: Heard anywhere in the room
- **WHEN** a sound is relayed while the player stands in the corner of the speaker's room farthest from the speaker
- **THEN** the relayed sound is clear and easy to hear

#### Scenario: Off
- **WHEN** the intercom is off and a sound plays in the medical bay
- **THEN** nothing is heard from the speaker, and the sound reaches the player only directly

### Requirement: The intercom clicks and hisses
Switching an intercom on SHALL play a click and a short burst of static from its speaker, and switching it off SHALL play a
click. While it is live, a low crackle bed SHALL play from the speaker even when the source room is quiet.

#### Scenario: Switched on
- **WHEN** a sequence switches the medical bay intercom on
- **THEN** a click and a burst of static play from the speaker, and a low crackle continues after it

#### Scenario: Switched off
- **WHEN** a sequence switches the intercom off
- **THEN** a click plays from the speaker and the crackle stops

### Requirement: The intercom overloads on loud sounds
When a relayed sound is loud, such as a scream or a heavy impact, the speaker's output SHALL distort more and crackle
harder for as long as the sound stays loud, then recover. Overload SHALL never silence the relayed sound or push the
master output into clipping.

#### Scenario: A scream
- **WHEN** a full scream is relayed
- **THEN** the speaker's output is audibly more distorted and crackly during the scream than during quiet speech, and the scream stays audible

#### Scenario: Back to normal
- **WHEN** a loud relayed sound ends
- **THEN** within about 0.5 s the speaker's distortion and crackle return to their quiet level

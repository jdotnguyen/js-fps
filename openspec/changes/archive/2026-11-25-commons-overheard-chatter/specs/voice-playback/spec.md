# Spec Delta

## MODIFIED Requirements

### Requirement: Subtitles follow the player's earshot
A local line's subtitle SHALL show only while its speaker is within 20 m of the player and its voice is audible. For a `background` line the distance SHALL be 6 m instead of 20 m. This SHALL be re-checked during the line: walking into range shows the subtitle for the rest of the line, and walking out hides it. Radio and PA subtitles SHALL show wherever the player is.

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

#### Scenario: Overhearing from a distance
- **WHEN** a background line plays 8 m from the player in the same room
- **THEN** it is heard faintly with no subtitle

#### Scenario: Leaning in on a background line
- **WHEN** the player walks within 6 m of the speaker mid-line
- **THEN** its subtitle appears for the rest of that line

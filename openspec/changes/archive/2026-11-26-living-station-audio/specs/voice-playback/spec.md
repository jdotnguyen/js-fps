# Spec Delta

## MODIFIED Requirements

### Requirement: Subtitles follow the player's earshot
A local line's subtitle SHALL show only while its speaker is within 20 m of the player and its voice is audible. For a local `background` line the distance SHALL be 6 m instead of 20 m. For a `background` PA line, the subtitle SHALL show only while the player is within 12 m of the playing PA wall grille and the grille is audible through room propagation. All proximity checks SHALL be re-checked during the line: walking into range shows the subtitle for the rest of the line, and walking out hides it. Radio subtitles and non-background (`story`) PA subtitles SHALL show wherever the player is.

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

#### Scenario: Story PA anywhere on station
- **WHEN** the scripted quarantine or lockdown `story` PA line plays while the player is 20 m from the active grille
- **THEN** its subtitle still shows

#### Scenario: Ambient PA near the grille
- **WHEN** a `background` PA announcement plays from a wall grille 6 m away in the player's room
- **THEN** its subtitle shows while the player stays within 12 m and in earshot

#### Scenario: Walking away from an ambient PA grille
- **WHEN** the player walks more than 12 m away from the playing wall grille or closes a heavy door behind them mid-announcement
- **THEN** the `background` PA subtitle hides for the rest of that line

#### Scenario: Overhearing from a distance
- **WHEN** a local background line plays 8 m from the player in the same room
- **THEN** it is heard faintly with no subtitle

#### Scenario: Leaning in on a background line
- **WHEN** the player walks within 6 m of the speaker mid-line
- **THEN** its subtitle appears for the rest of that line

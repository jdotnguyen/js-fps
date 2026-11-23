# dialogue-channels Specification

## Purpose
Defines how lines share the voice: separate conversations play at the same time on their own channels, a conversation keeps its own lines in order, a speaker never talks over themself, and barks and hints give way to story the player can hear.

## Requirements

### Requirement: One channel per conversation
Each running scripted sequence SHALL speak on its own channel. A line SHALL wait only for lines on its own channel, never for lines in another conversation. When a conversation's next line is due and nothing on its channel or by the same speaker is playing, the line SHALL start at once with its subtitle, whatever else is speaking on the station.

#### Scenario: Walking into the dive bay mid-Hale
- **GIVEN** Hale's office scene is still playing after the player has left the office
- **WHEN** the player enters the dive bay and Sung's scene starts
- **THEN** Sung's first line starts on cue, about 1.2 s after entry, without waiting for any of Hale's lines

#### Scenario: Two conversations in earshot
- **WHEN** two separate scenes speak at once within earshot of the player
- **THEN** both are heard from their speakers and both subtitles show

### Requirement: A conversation keeps its own order
Lines on one channel SHALL play one after another in the order the sequence says them, with the natural pause between consecutive lines that voice-playback defines. A line written to play over its own conversation, such as a PA notice the squad talks over, SHALL still play beside it.

#### Scenario: Back-and-forth in one scene
- **WHEN** a scene says Sung, Jay, then Sung
- **THEN** the three lines play in that order with a brief pause between them and never overlap

#### Scenario: PA over the banter
- **WHEN** the quarantine PA plays during the walk with Giles and Okafor
- **THEN** it starts at once over their lines, as before

### Requirement: A speaker never talks over themself
A speaker SHALL say at most one line at a time. A line from a speaker who is already talking on another channel SHALL wait for that line to end and then start, unless it is dropped under the rule for Jay.

#### Scenario: Sung in two scenes
- **WHEN** the player stows the case while Sung is mid-line in his dive-bay conversation
- **THEN** "Locker's signed" starts right after his current line ends, and the rest of his conversation continues after it

### Requirement: Jay answers the conversation he can hear
When Jay's line is due on a channel whose other speakers are all out of earshot, it SHALL be dropped, and that conversation SHALL continue without it. A Jay line due while he is already speaking SHALL wait for his current line, as for any speaker. A scene tied to a room ends instead when the player leaves it, as scene-presence defines.

#### Scenario: Leaving a conversation that is not tied to a room
- **WHEN** a scene that names no room reaches Jay's line after the player has walked out of earshot of the other speaker
- **THEN** Jay does not say it, and the other speaker's next line follows on cue

#### Scenario: Leaving Hale's office mid-scene
- **WHEN** the player leaves Hale's office before Jay's "Everything all right, Director?"
- **THEN** the scene ends for everyone, as scene-presence defines

### Requirement: Barks and hints give way to audible story
Barks, combat callouts and hints SHALL NOT start while a story line the player can hear is playing. A story line that starts within earshot SHALL cut off a bark or hint the player can hear. Story lines out of earshot SHALL NOT hold barks or hints back. Combat and idle barks that cannot start within 2 s SHALL be dropped, as today.

#### Scenario: Hint during a far-off scene
- **WHEN** a hint is due while the only story line playing is Hale's in his office, out of earshot
- **THEN** the hint plays at once

#### Scenario: Bark during a nearby scene
- **WHEN** a squadmate's idle bark is due while Sung is speaking to the player 3 m away
- **THEN** the bark waits, and is dropped if Sung is still speaking 2 s later

### Requirement: Earshot
A line SHALL count as within earshot when its voice is audible to the player under the local-channel propagation in voice-playback. Radio and PA lines SHALL always count as within earshot.

#### Scenario: Through two rooms
- **WHEN** a speaker talks three room boundaries away from the player
- **THEN** their line counts as out of earshot

#### Scenario: Director over the intercom
- **WHEN** Hale speaks on the radio channel
- **THEN** his line counts as within earshot wherever the player is

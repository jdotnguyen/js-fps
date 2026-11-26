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
A line SHALL count as within earshot when its voice is audible to the player under the local-channel propagation in voice-playback. Radio lines and non-background PA lines SHALL always count as within earshot. A `background` PA line SHALL count as within earshot only while the player is within proximity range of the playing PA grille and its voice is audible.

#### Scenario: Through two rooms
- **WHEN** a speaker talks three room boundaries away from the player
- **THEN** their line counts as out of earshot

#### Scenario: Director over the intercom
- **WHEN** Hale speaks on the radio channel
- **THEN** his line counts as within earshot wherever the player is

#### Scenario: Story PA notice
- **WHEN** a scripted `story` PA line plays while the player is moving between sections
- **THEN** it counts as within earshot wherever the player is

#### Scenario: Distant ambient PA
- **WHEN** a `background` PA announcement plays from a wall grille 18 m away behind a closed door
- **THEN** it counts as out of earshot

### Requirement: Background lines give way to every other line
A `background` line SHALL rank below `idle`. It SHALL NOT start while any higher-priority line the player can hear is playing, and a higher-priority line starting within earshot SHALL cut off every background line at once. A background line that cannot start within 2 s SHALL be dropped. Higher-priority lines the player cannot hear SHALL NOT affect it.

#### Scenario: A story line starts
- **WHEN** Giles calls "Jay, come on" within earshot while a crew member is mid-line in a background exchange
- **THEN** the background line stops at once with its subtitle, and Giles's line plays

#### Scenario: A squad bark or hint starts
- **WHEN** an idle bark or a hint starts within earshot during a background line
- **THEN** the background line is cut off and the bark or hint plays

#### Scenario: Waiting behind speech
- **WHEN** a background line is due while an audible story line has more than 2 s left
- **THEN** the background line is dropped and never plays late

#### Scenario: A far-off scene
- **WHEN** a story line is playing out of earshot
- **THEN** a background line starts as usual

### Requirement: Background lines do not hold back barks or hints
Barks, hints and their quiet timers SHALL behave as though no one were speaking while only background lines play.

#### Scenario: Idle bark timer
- **WHEN** the player stands in the Commons for 75 s of otherwise quiet play while background exchanges are heard
- **THEN** the squad's idle bark comes due as it would in silence

### Requirement: Background lines leave the mix and bystanders alone
A background line SHALL NOT duck music or ambience, and SHALL NOT make any character outside its conversation turn to look at the speaker or turn the player's view. The speaker's mouth and gestures SHALL still act the line.

#### Scenario: Music under background talk
- **WHEN** a background line plays beside the player
- **THEN** music and ambience levels do not change

#### Scenario: Bystanders stay as they are
- **WHEN** a background line plays 2 m from another seated group
- **THEN** nobody in that group turns to look at the speaker
- **AND** the speaker's mouth moves with the line

### Requirement: Ambient PA uses background priority
Ambient Station PA announcements SHALL play on the `pa` channel with `background` priority. They SHALL yield to every higher-priority line (`story`, `hint`, `combat`, `idle`) within earshot, SHALL be cut off immediately if a higher-priority line starts within earshot, SHALL NOT duck music or room ambience, and SHALL NOT reset or hold back bark, hint, or idle timers.

#### Scenario: Story scene starts over ambient PA
- **WHEN** the player triggers a scripted scene while an ambient PA announcement is mid-sentence
- **THEN** the ambient PA cuts off immediately with its subtitle and the scripted line plays cleanly

#### Scenario: Ambient PA does not duck ambience
- **WHEN** an ambient PA notice plays from a wall grille during quiet exploration
- **THEN** music and room ambience levels do not duck

### Requirement: Phase-gated idle barks
Idle barks SHALL respect the station phase. Cheerful morning idle barks (`bark_idle_01`–`04`) SHALL play only before `drop_started`; once `drop_started` is true, idle barks SHALL draw exclusively from hushed, tense post-drop idle lines.

#### Scenario: No cheerful idle bark after the drop
- **WHEN** `drop_started` is true and the player stands quietly in the Flooded Tunnel for 90 s
- **THEN** only a post-drop idle bark may play, and never a morning joke such as "That's your third coffee today"

#### Scenario: Morning idle bark before the drop
- **WHEN** `drop_started` is false and the player spends a quiet stretch with Giles and Okafor
- **THEN** a morning idle bark may play as before

### Requirement: Contextual room commentary
Entering or lingering in morning rounds wings (`R01`, `R12`, `R13`, `R14`) and quiet post-drop side rooms (`R06`, `R07a`, `R08b`, `R16c`) SHALL trigger contextual one-time remarks from Giles, Okafor, or Jay (`player`) at `idle` priority. Each remark SHALL play at most once per playthrough (persisted in save flags) and SHALL yield to any active story line, combat, or scripted room scene.

#### Scenario: Entering the Armory post-drop
- **WHEN** the player enters `R07a Armory` under blackout with no scripted scene or combat active
- **THEN** a contextual one-time remark plays from Giles, Okafor, or Jay, and does not repeat on re-entry or after reloading a later checkpoint

#### Scenario: Room remark yields to scripted scene
- **WHEN** the player enters `R12b Grow Hall` while `hydro_moment` is running
- **THEN** no room-commentary bark interrupts `hydro_moment`

### Requirement: Panel barks only for Giles's own work
Giles's panel-work barks SHALL play only while Giles himself is working a panel job. A job Okafor is working SHALL NOT
prompt one.

#### Scenario: Okafor works the med-lab lock
- **WHEN** Okafor is working the biometric lock on `D_R07_R09`
- **THEN** Giles says no panel-work bark

#### Scenario: Giles works a bypass
- **WHEN** Giles is working a door bypass and a panel-work bark is due
- **THEN** he may say one

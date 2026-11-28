# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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

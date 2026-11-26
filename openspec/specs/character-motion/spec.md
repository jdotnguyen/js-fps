# character-motion Specification

## Purpose

Makes each character move like themselves: named characters with their own captured motion for everything they do, and generic crew with gendered, varied defaults, all on the shared skeleton.

## Requirements

### Requirement: Every named character has its own motion profile
Every character with a name (today Giles, Okafor, Priya, Voss, Bram, Ruiz, Heins, Hale and Sung) SHALL have a motion profile of its own. The profile names that character's clip for each activity it performs and its style values. No two named characters SHALL share their idle, talk or walk clip.

#### Scenario: Two named characters walk side by side
- **WHEN** Giles and Okafor walk the same route at the same speed
- **THEN** each plays the walk clip named in his own profile
- **AND** the two walk clips are different captures

#### Scenario: A named character added later
- **WHEN** a new named character is added to the cast without a motion profile
- **THEN** the cast check fails and names the character

### Requirement: Profiles cover every activity the character performs
A named character's profile SHALL name a clip or a pose treatment for every activity the levels, sequences and squad behaviour ask of that character: standing idle, talking, walking, jogging, turning, sitting, leaning, kneeling, crouching, aiming, drinking and each gesture or work action it is given.

#### Scenario: Activity coverage check
- **WHEN** the cast check lists every activity each named character is asked to perform in the slice (level data, sequences, squad tasks)
- **THEN** each one resolves to a clip or a pose treatment in that character's profile
- **AND** none falls through to another character's or the generic default

### Requirement: Scenes can give a character extra motion
A named character's profile SHALL be able to hold scene variants: clips that replace or add to its everyday clips only while a named sequence, squad task or story flag is active. When that scene, task or flag ends, the character SHALL return to its everyday clips with a blend of at least 0.3 s, and the variant's clips SHALL NOT play outside it.

#### Scenario: Bram serves coffee in the intro
- **WHEN** the intro kitchen scene has Bram offer a mug
- **THEN** he plays his own serve clip from his intro variant
- **AND** after the intro ends he never plays that clip again unless another scene asks for it

#### Scenario: Every scripted beat has motion
- **WHEN** the cast check lists every pose and action each named character is given by the slice's sequences and squad tasks
- **THEN** each one resolves to the character's everyday profile or one of its scene variants

### Requirement: Giles carries his shoulders naturally during everyday dialogue
During ordinary standing dialogue, Giles SHALL maintain his relaxed shoulder carriage through speech onset, pauses and return to idle. His talk capture SHALL supply his arm gestures, with the hands resting for most of a calm line and an occasional one-handed accent settling back toward rest. His jaw and subtle head accents SHALL continue to follow the line.

#### Scenario: A calm line followed by silence
- **WHEN** Giles stands at stage 0 with injury exposure 0, speaks a calm line and falls silent
- **THEN** both shoulders transition smoothly from idle through the first word and back to idle after the last word
- **AND** his elbows stay near his sides at rest and a captured gesture can settle while his jaw continues to articulate the line

### Requirement: Generic crew use a gendered default profile
Characters without a name SHALL use the masculine or feminine default profile according to their body's recorded gender. Each crew member SHALL vary its default by a seeded tempo and posture offset, so two crew members on the same profile do not move in step.

#### Scenario: A mixed room of crew
- **WHEN** a room holds crew on male and female bodies
- **THEN** the female bodies play the feminine default and the male bodies the masculine default

#### Scenario: Two crew on the same profile
- **WHEN** two crew members on the same default profile idle side by side from the same start time
- **THEN** their idle cycles are out of phase and their tempos differ
- **AND** each one's variation is the same every run (seeded by its id)

### Requirement: Authored poses are held in character
When a script, sequence or task holds a character in an authored pose (for example `lean_back`, `sit_chair_talk`, `kneel_revive`), the character SHALL keep moving the way its profile describes. It SHALL layer its own idle life for that posture where its profile has one, and otherwise its style values, while the pose's contact points (hands on a counter, seat, mug) stay where the pose puts them.

#### Scenario: Two characters lean on the same counter
- **WHEN** Bram and Ruiz both hold `lean_counter`
- **THEN** their breathing, weight shifts and head movement differ
- **AND** each one's hands stay on the counter

#### Scenario: Pose without a captured idle
- **WHEN** a character holds a pose for which its profile names no idle clip
- **THEN** the pose is still animated by that character's style values (tempo, fidget rate, posture), not frozen

### Requirement: Captured motion is not buried under generated motion
A character playing a clip from its own profile SHALL keep the clip's arm, hand and head motion readable. The procedural arm, fidget and breathing layers SHALL be reduced on that body so they add to the capture and do not replace it. Talk clips are the exception (spec `speech-acting`): they move only the trunk, never the arms, and a calm line's forearm gesture plays at full strength. Giles keeps his captured arms.

#### Scenario: Talking with captured gestures
- **WHEN** Giles speaks a calm line while playing his own talk clip
- **THEN** the clip's arm gestures are visible
- **AND** generated speech gestures move the arms no more than the reduced layer strength allows

#### Scenario: Talking with a talk capture
- **WHEN** a named character other than Giles speaks any line while playing its own talk clip
- **THEN** the clip moves its trunk and not its arms
- **AND** a heightened line's generated gestures stay within the reduced layer strength

### Requirement: Missing motion falls back without breaking
If a profile names a clip that is not in the library, the character SHALL play the matching activity from its gendered default profile and the game SHALL log one warning per missing clip. A character SHALL never stop animating, snap to the rest pose or throw because of a missing clip.

#### Scenario: Clip removed from the library
- **WHEN** Priya's profile names a walk clip the library does not have
- **THEN** she walks with the feminine default walk
- **AND** one warning names the missing clip

### Requirement: Infected and scripted kills keep their own motion
Characters that have turned, are infected, are dying in a kill or are a corpse SHALL use the infected gaits, kill poses and corpse handling instead of their living profile. A character's profile SHALL apply again only if it gets up alive.

#### Scenario: Named character turns
- **WHEN** a named crew member turns into an infected shambler
- **THEN** it moves with the infected gait, not its living walk

### Requirement: Cast motion sandbox
A sandbox SHALL show a grid with one row per named character and one column per activity, each cell holding a copy of that character performing that activity, plus rows for the two gendered crew defaults. It SHALL let the viewer pause, scrub and play the grid at slow speed, and highlight cells that use a fallback.

#### Scenario: Opening the sandbox
- **WHEN** the cast motion sandbox is opened
- **THEN** every named character appears in its own row with one copy per activity in its profile
- **AND** the masculine and feminine crew defaults appear in their own rows

#### Scenario: A fallback in the grid
- **WHEN** a cell's character has no clip of its own for that activity
- **THEN** the cell is marked as a fallback

### Requirement: Door-unlock tasks use standing wall-device choreography
Giles SHALL perform door bypass jobs (`bypass`, `bypass_short`, `bypass_long`, `unlock_locker`) in a standing wall-panel pose (`panel_work`) layered with his `giles_panel` hold while preserving left-forearm injury guarding. Okafor SHALL perform biometric door unlocks (`biometric`) in a standing biometric-scan pose (`biometric_scan`) layered with his `okafor_console` hold, pressing his right palm flat against the vertical wall scanner with his left arm at rest.

#### Scenario: Giles works a wall panel while injured
- **WHEN** Giles performs `panel_work` during a door bypass at infection stage 2 or higher
- **THEN** he remains standing at wall-device height with his `giles_panel` hold active
- **AND** his left hand moves less and more slowly than his right hand while staying on the panel

#### Scenario: Okafor scans a vertical biometric reader
- **WHEN** Okafor performs `biometric_scan` with a vertical wall surface normal supplied to hand IK
- **THEN** his right palm orients flush against the vertical wall surface rather than tilting downward as onto a horizontal desk
- **AND** his left arm stays relaxed at his side

#### Scenario: Ambient crouched work stays intact
- **WHEN** a level placement or sequence explicitly asks for `crouchWork`
- **THEN** the `crouchWork` pose remains available and unchanged

### Requirement: Squad pistol carry keeps natural wrist and support-hand alignment
Okafor and Giles SHALL each use a character-calibrated pistol-aiming clip (`okafor_pistol` and `giles_pistol`) so that in `aim_pistol`, both point the pistol level or slightly downward rather than pitched up, Okafor's right wrist sits straight, and both characters' left support hands cup directly beneath their right hand and pistol grip.

#### Scenario: Okafor holds the pistol with a level right wrist and cupped left hand
- **WHEN** Okafor settles into `aim_pistol` with no active `aimTarget`
- **THEN** his pistol barrel pitch is level or slightly downward (-5° to +3°) and his left hand cups beneath his right hand and pistol grip

#### Scenario: Giles aims level and supports the pistol directly beneath his right hand
- **WHEN** Giles settles into `aim_pistol` with no active `aimTarget`
- **THEN** his pistol barrel pitch is level or slightly downward (-5° to +3°) and his left hand cups directly beneath his right hand and pistol grip without protruding past the right hand

### Requirement: Squadmates lower their pistols at idle out of combat
When a squadmate has no active combat target, the squadmate SHALL return to `idle` (lowering the pistol) rather than holding `aim_pistol` while standing idle.

#### Scenario: Combat ends and mates return to idle
- **WHEN** combat ends after `gunDrawn` is true and no enemy target remains
- **THEN** Giles and Okafor transition back to `idle` and hide their pistols until they engage in combat again

### Requirement: Armed locomotion preserves pistol aim and finger grip
When a humanoid walks while `idlePose` is `aim_pistol`, locomotion SHALL keep `aim_pistol` active with the upper-body pistol-aim overlay and pistol finger grip rather than reverting to an unarmed casual walk.

#### Scenario: Advancing with sidearm drawn
- **WHEN** Giles or Okafor walks forward (`speed > 0.35 m/s`) while holding `aim_pistol`
- **THEN** their legs play the walk cycle while their upper body, arms, and fingers keep the pistol drawn forward toward the aim target

### Requirement: Crossed arms stay crossed through idle gestures
A character resting with its arms crossed SHALL keep them crossed through its idle gestures. It SHALL be able to turn or lower its head, and no gesture SHALL drop or move its arms.

#### Scenario: Heins at the briefing
- **WHEN** Heins stands idle at her R03 post for two minutes
- **THEN** her forearms stay crossed the whole time
- **AND** she still glances to the side and looks down from time to time

#### Scenario: A gesture starting and ending
- **WHEN** a character resting with crossed arms starts or ends an idle gesture
- **THEN** each wrist stays on the other arm, never more than 3 cm from where it would be against that arm had no gesture
  played

#### Scenario: A scripted glance
- **WHEN** a script asks a character resting with crossed arms to glance
- **THEN** it turns its head and its arms stay crossed

### Requirement: Hands on hips stay there through idle gestures
A character resting with its hands on its hips SHALL keep them there through its idle gestures. It SHALL be able to turn or raise its head, and no gesture SHALL drop or move its arms.

#### Scenario: Hale at his desk
- **WHEN** Hale stands idle with his hands on his hips for two minutes
- **THEN** both hands stay on his hips the whole time
- **AND** he still glances to the side and looks up from time to time

#### Scenario: A gesture starting and ending
- **WHEN** a character resting with hands on hips starts or ends an idle gesture
- **THEN** each wrist stays on its hip, never more than 3 cm from where it would be against that hip had no gesture
  played

### Requirement: Crossing the arms is not a brief idle fidget
Idle behaviour SHALL NOT cross a character's arms on its own, whether the character stands or sits. Arms SHALL be crossed only while a level, script or task puts the character in a crossed-arm pose.

#### Scenario: Standing crew and squadmates
- **WHEN** standing NPCs and squadmates in an ordinary idle are left for five minutes
- **THEN** none of them crosses its arms

#### Scenario: Seated crew
- **WHEN** a character seated on a chair or sofa is left idle for five minutes
- **THEN** it does not fold its arms

#### Scenario: A placed crossed-arm pose
- **WHEN** a level places a character with its arms crossed
- **THEN** the character holds them crossed until something else gives it another pose

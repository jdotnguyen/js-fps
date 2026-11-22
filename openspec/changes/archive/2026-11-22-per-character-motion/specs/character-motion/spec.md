# Spec Delta

## Purpose

Makes each character move like themselves: named characters with their own captured motion for everything they do, and generic crew with gendered, varied defaults, all on the shared skeleton.

## ADDED Requirements

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

### Requirement: Giles's injury shows only when he cannot hide it
Giles SHALL have an injured-arm variant (his left forearm, the one he cut), weighted by state. Observed by the player or a squadmate, or talking, he hides it and SHALL move with his everyday clips, its weight at most the stage's concealed value. Unobserved, during a task that loads that arm, or after a ladder tell, it rises to the stage's unhidden value. The weight SHALL rise with infection stage and reach full only at the reveal.

#### Scenario: Watched in the intro
- **WHEN** the player looks at Giles from within 6 m during the intro at infection stage 0
- **THEN** his left arm swings and carries like the right, with no favouring

#### Scenario: Unwatched
- **WHEN** neither the player nor Okafor has Giles in view for 4 s
- **THEN** he holds his left arm in and favours it
- **AND** when the player looks at him again it eases back toward normal within 1 s

#### Scenario: Working the panel
- **WHEN** Giles does the R06 bypass at infection stage 2 or higher
- **THEN** he works mostly with his right hand and his left hand moves less and more slowly

#### Scenario: Stages
- **WHEN** Giles's infection stage rises
- **THEN** both the concealed and the unhidden injury weights rise with it
- **AND** at the reveal his injured arm motion plays at full weight whoever is watching

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

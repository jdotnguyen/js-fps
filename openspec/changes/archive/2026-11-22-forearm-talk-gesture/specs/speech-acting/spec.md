# Spec Delta

## Purpose

Defines what a body does while it speaks a line: which arm gestures and how much, how the line's emote sets the size of the gesture, and how speech gestures combine with talk captures, locomotion and held props.

## ADDED Requirements

### Requirement: Calm lines gesture from the elbow down
While a standing character speaks a calm line (emote `neutral`, `question`, `relieved`, `whisper` or `laugh`), its speech gesture SHALL move the right forearm and right hand only. The elbow SHALL hold a raised forearm and flex further on the line's stresses. The wrist SHALL bend on those stresses. The right upper arm SHALL stay within 6° of where the character's idle puts it.

#### Scenario: Tomas explains something in the intro
- **WHEN** Okafor stands still and speaks a `neutral` line of at least three seconds in `intro_shift_change`
- **THEN** his right elbow flex varies by at least 8° over the line, timed to its stresses
- **AND** his right wrist bends on those stresses
- **AND** his right upper arm stays within 6° of his idle pose throughout the line

#### Scenario: A question turns the palm up
- **WHEN** a standing character speaks a `question` line
- **THEN** its right forearm rises and its right palm turns up
- **AND** its right upper arm stays within 6° of its idle pose

### Requirement: Calm lines always gesture with the right hand
A calm line SHALL gesture with the right hand for every character and every line, unless the right hand holds something (see the next requirement). The arm that does not gesture SHALL play only what the character's idle puts on it and SHALL gain no speech gesture.

#### Scenario: Many calm lines in a row
- **WHEN** any character with empty hands speaks twenty different calm lines
- **THEN** every line gestures with the right forearm
- **AND** the left upper arm, forearm and hand match the character's idle pose on every frame of every line

### Requirement: Talk captures never move the arms
When a character with a talk clip of its own speaks any line while standing, the clip SHALL drive the pelvis, spine, chest and clavicles only, never the arms. Giles is the exception: his talk capture SHALL keep supplying his arm motion as `character-motion` describes.

#### Scenario: Priya talks in the intro
- **WHEN** Priya stands still and speaks a calm line in `intro_shift_change`
- **THEN** her trunk and clavicles follow `priya_talk`
- **AND** neither upper arm moves more than 6° from her idle pose

#### Scenario: Priya laughs in the kitchen
- **WHEN** Priya stands still and speaks `intro_priya_03` (a `laugh` line)
- **THEN** `priya_talk` adds nothing to either arm
- **AND** only her right forearm and hand gesture

#### Scenario: Giles keeps his accent
- **WHEN** Giles stands still and speaks a calm line
- **THEN** his arm motion comes from `giles_talk` as before this change

### Requirement: Speech adds no arm motion while moving
While a character walks or jogs, its speech gesture SHALL add no arm motion. The arm SHALL return to its full speech gesture only once the character stands still. The jaw and head SHALL keep following the line.

#### Scenario: Priya talks while walking
- **WHEN** Priya speaks a line while walking at full walk weight
- **THEN** her arms match her walk clip with no speech gesture added
- **AND** her jaw follows the line

### Requirement: A hand that holds something does not gesture
When the right hand holds a prop, a calm line SHALL gesture with the free left forearm and wrist instead, under the same from-the-elbow rules. The holding hand SHALL gain no speech gesture, and the prop SHALL stay where its pose puts it.

#### Scenario: Talking with a mug
- **WHEN** a character in `lean_back_mug` with the mug in its right hand speaks a calm line
- **THEN** its left forearm gestures and its left upper arm stays within 6° of its idle pose
- **AND** its right arm gains no speech gesture and the mug stays within 10° of vertical

### Requirement: Heightened lines keep their full gestures
Lines with emote `urgent`, `alarmed`, `pained`, `dread` or `scream` SHALL keep their generated whole-arm gestures. They are unaffected by the calm-line rules, but like every line they get no arm motion from a talk capture.

#### Scenario: An urgent order
- **WHEN** Okafor stands still and speaks an `urgent` line
- **THEN** his gesturing upper arm swings forward on the beats as it did before this change

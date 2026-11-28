# Spec Delta

## Purpose

Covers the small items characters hold in a hand (a coffee mug, the dock guard's scanning wand): which poses show them, how they sit in the hand, how they stay steady while the body moves, and how the fingers grip them.

## ADDED Requirements

### Requirement: A held mug stands upright
While a character holds a mug in a hold or hand-off pose (`idle_mug`, `offer_mug`, `lean_back_mug` and its glance, look-down and talk variants), the mug's axis SHALL stay within 10° of vertical, open end up. This SHALL hold for every body, rigged or not, and SHALL keep holding while hold clips, wrist springs and speech gestures move the arm.

#### Scenario: Leaning back with a mug
- **WHEN** a character holds `lean_back_mug` for 3 s with its hold clip playing
- **THEN** on every frame the mug's axis is within 10° of vertical and its open end faces up

#### Scenario: Talking while holding a mug
- **WHEN** a character in `lean_back_mug_talk` speaks a line with gestures
- **THEN** the mug stays within 10° of vertical throughout the line

#### Scenario: Body without finger bones
- **WHEN** Bram, or an unnamed crew member, holds `idle_mug` or `offer_mug`
- **THEN** the mug is within 10° of vertical and sits in the right hand

#### Scenario: Holding out the mug
- **WHEN** Priya holds `offer_mug` in the intro's hand-off shot
- **THEN** the mug is within 10° of vertical, open end up

### Requirement: A drinking pose tips the mug toward the mouth
In a drink pose (`drink`, `lean_back_mug_drink`, `lean_counter_drink`, and the seated `sit_*_drink` poses), the mug SHALL tip toward the character's face by 30° to 70° from vertical, with its rim near the mouth. Moving between a hold pose and a drink pose SHALL change the tilt smoothly over the pose's blend, never in one frame.

#### Scenario: Taking a sip
- **WHEN** a character settles in `drink`
- **THEN** the mug's open end tips toward the face, 30° to 70° from vertical
- **AND** the rim is within 6 cm of the mouth

#### Scenario: Lowering the mug
- **WHEN** a character goes from `lean_back_mug_drink` back to `lean_back_mug`
- **THEN** the mug's tilt changes by no more than 15° between two consecutive frames at 60 fps, and ends within 10° of vertical

### Requirement: Fingers wrap a held mug without entering it
For a character whose body has finger bones, holding a mug in any mug or drink pose, no finger or thumb SHALL pass into the mug. Each phalanx SHALL stay outside the mug's wall, allowing at most 3 mm of skin overlap, and no part of a finger SHALL pass through the mug's handle.

#### Scenario: Grip check per character
- **WHEN** each of Giles, Okafor, Priya and Hale holds each mug and drink pose for 3 s
- **THEN** on every frame, every point along every finger and thumb phalanx lies no more than 3 mm inside the mug's surface
- **AND** no finger point lies inside the handle

#### Scenario: Fidgeting hands
- **WHEN** a character with a high finger fidget (Hale) or Giles at infection stage 3 holds a mug
- **THEN** the fingers still move, and none enters the mug while they do

### Requirement: Fingers and thumb touch a held mug
For a character whose body has finger bones, the grip on a held mug SHALL close onto it: the last phalanx of the index, middle and ring fingers, and of the thumb, SHALL each be within 1 cm of the mug's surface. Changing into or out of a mug pose SHALL ease the grip over at least 0.1 s.

#### Scenario: Closed grip per character
- **WHEN** each of Giles, Okafor, Priya and Hale has held `lean_back_mug` for 1 s
- **THEN** the index, middle, ring and thumb tips are each within 1 cm of the mug's surface

#### Scenario: Picking up and putting down
- **WHEN** a character goes from `lean_back` to `lean_back_mug`, or back
- **THEN** the fingers close or open over at least 0.1 s, not in one frame

### Requirement: The thumb opposes the fingers on a held mug
For a character whose body has finger bones, the thumb SHALL come round a held mug from the opposite side to the fingers. Where the rig's thumb cannot reach that side without entering the mug, it SHALL rest along the mug beside the index finger, its tip at the rim.

#### Scenario: Thumb opposed
- **WHEN** Giles, Okafor or Hale has held `lean_back_mug` for 1 s
- **THEN** seen down the mug's axis, the thumb tip and the middle fingertip lie on opposite sides of the line from the axis to the palm

#### Scenario: Thumb on the rim
- **WHEN** Priya, whose thumb root sits beside her index finger, has held `lean_back_mug` for 1 s
- **THEN** her thumb tip lies within 1.5 cm of the rim's height and within 1 cm of the mug's surface

### Requirement: The mug sits in each character's own hand
For a character whose body has finger bones, the held mug SHALL sit against that body's palm, between its thumb and fingers, wherever that rig's knuckles and palm are. The same grip SHALL fit hands of different sizes and different rigs without per-character tuning.

#### Scenario: Different hand sizes
- **WHEN** Giles and Okafor, whose knuckles sit 8.6 cm and 12.6 cm from the wrist, each hold a mug
- **THEN** each mug sits against that character's own palm and both grip checks pass

### Requirement: The mug's handle points away from the grip
A held mug's handle SHALL point out of the hand through the opening between the thumb and the fingertips, or for a body without finger bones away from the palm, and SHALL never point into the palm.

#### Scenario: Handle placement
- **WHEN** a character holds a mug in any mug pose
- **THEN** the handle is on the side of the mug away from the palm and is not covered by the fingers

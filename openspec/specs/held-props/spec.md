# held-props Specification

## Purpose

Covers the small items characters hold in a hand (a coffee mug, the dock guard's scanning wand): which poses show them, how they sit in the hand, how they stay steady while the body moves, and how the fingers grip them.

## Requirements

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

### Requirement: A squad mate's pistol shows only while aiming
Giles and Okafor SHALL each hold a pistol in the right hand while in the aim pose (`aim_pistol`), and SHALL show no pistol in any other pose. The pistol SHALL appear once the blend into the aim pose is at least half done, and disappear once the blend out of it is at least half done. It SHALL never show at the same time as a mug or the scanning wand.

#### Scenario: Raising the gun
- **WHEN** Giles goes from idle into the aim pose because an infected appears
- **THEN** the pistol is in his right hand by the time the aim pose is reached

#### Scenario: Back to work
- **WHEN** combat ends and Okafor blends from the aim pose back to idle
- **THEN** the pistol is gone from his hand by the end of the blend

#### Scenario: Coffee in hand
- **WHEN** Giles is in a mug pose
- **THEN** he holds the mug and no pistol

### Requirement: The pistol sits in each mate's own grip
The held pistol's grip SHALL sit in the palm of the body holding it, with the fingers wrapped round the grip, wherever that rig's palm and knuckles are. It SHALL fit both bodies without per-character tuning. No finger SHALL pass more than 3 mm into the grip. The trigger guard SHALL stay clear of the palm.

#### Scenario: Two different hands
- **WHEN** Giles and Okafor, whose knuckles sit 8.6 cm and 12.6 cm from the wrist, each aim the pistol
- **THEN** each pistol sits in that character's own palm and both grip checks pass

### Requirement: The pistol points along the aim
While a mate aims at a target, the pistol's barrel SHALL point within 5 degrees of the line from the muzzle to the target's aim point. The pistol SHALL stay steady in the hand while the body breathes and shifts.

#### Scenario: Aiming at an infected
- **WHEN** Okafor aims at an infected 6 m away
- **THEN** the line from the pistol's muzzle along its barrel passes within 5 degrees of that infected's aim point

### Requirement: The slide kicks back on each shot
Each squad shot SHALL kick the pistol's slide back and return it within 0.15 s. The slide SHALL rest closed at all other times.

#### Scenario: One shot
- **WHEN** Giles fires once
- **THEN** his pistol's slide moves back and is closed again within 0.15 s

### Requirement: The pistol flashes and lights its surroundings on each shot
Each squad shot SHALL show a muzzle flash at the shooting mate's pistol muzzle and SHALL light the surroundings near the muzzle, as the player's own muzzle flash does. The flash and its light SHALL be gone within 0.06 s of the shot. The light SHALL NOT cast shadows, and firing SHALL NOT change the number of lights in the scene.

#### Scenario: Covering fire in a dark corridor
- **WHEN** Okafor fires in a dark corridor
- **THEN** a flash shows at his pistol's muzzle and the walls and bodies near it light up for an instant

#### Scenario: Back to dark
- **WHEN** 0.06 s have passed since Giles's last shot
- **THEN** his pistol shows no flash and the squad muzzle light is dark

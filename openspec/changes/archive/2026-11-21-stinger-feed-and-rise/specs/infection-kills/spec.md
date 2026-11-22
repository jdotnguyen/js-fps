# Spec Delta

## ADDED Requirements

### Requirement: A kill beat can play a captured clip
A kill beat SHALL be able to play a captured motion clip on the victim once, from its first frame to its last, at an authored speed that may change during the beat, then hold the last frame. The beat SHALL be able to end when the clip ends, and SHALL still end at its time limit.

#### Scenario: The beat ends with its clip
- **WHEN** a beat plays a 3 s clip at speed 0.75 and ends when the clip ends
- **THEN** the beat lasts 4 s and the victim holds the clip's last frame

#### Scenario: A missing clip never stops the kill
- **WHEN** a beat names a clip the victim's body does not have
- **THEN** a warning is logged once, the beat plays its authored poses instead, and the kill continues

### Requirement: A clip moves the body off the floor in place
While a beat plays a clip, the victim SHALL stay where the kill placed her and keep her facing at the start of the beat. Her body SHALL rise and fall with the clip, with no part of her body sinking into the floor and no pop at the start or end of the clip.

#### Scenario: Getting up from the floor
- **WHEN** a get-up clip plays on a victim lying on the floor
- **THEN** her hips rise from floor height to standing height and her feet end on the floor where she lay

### Requirement: Convulsion layers over captured motion
During a clip beat, the beat's convulsion and its `kick` events SHALL add to the clip's motion and SHALL NOT replace it. The convulsion SHALL read as spasms and tremor, not flicker, when seen through a 30 fps camera feed.

#### Scenario: Twitches during the rise
- **WHEN** a kick event fires on the victim's shoulder during a clip beat
- **THEN** her shoulder jerks and her body carries on with the clip

### Requirement: Priya rises with captured motion
In the slice's ending stinger, Priya's converted body SHALL get up from the floor with a captured get-up, slowed and uneven, with light convulsion and a few sharp twitches, then face the camera. Her rise SHALL NOT step through held poses.

#### Scenario: The stinger rise
- **WHEN** the ending stinger reaches Priya's rise
- **THEN** she gets up in one continuous captured motion over at least 3 s and then turns to face CAM 04

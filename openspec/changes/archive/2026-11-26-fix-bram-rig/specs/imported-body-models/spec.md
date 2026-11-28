# Spec Delta

## MODIFIED Requirements

### Requirement: Every named character's body has finger and twist bones
The body of every named character SHALL carry weighted finger bones (three per finger, two for the thumb, or one bone per finger where the scan's fingers are fused) and a twist bone in each forearm. Scan bodies prepared on the 24-bone rig SHALL gain these bones when they are prepared. Unnamed crew bodies MAY keep the thinner rig, and so MAY a named character whose scan fuses each hand into a fist or a glove that finger bones would tear (Ruiz, Sung).

#### Scenario: Rig check
- **WHEN** the prepared body of each named character with a hand rig is checked
- **THEN** each hand has finger bones carrying skin weight and each forearm has a twist bone carrying skin weight

#### Scenario: Fused scan fingers
- **WHEN** a scan body's fingers are fused into one surface
- **THEN** each finger's strip of the surface is weighted to its own finger bone, and curling a finger does not tear the surface (no edge of 3 mm or longer stretches to more than 2.5 times its rest length)

#### Scenario: Thumb and fingers on their own sides
- **WHEN** the prepared body of each named character with finger bones on both hands is checked in its rest pose
- **THEN** on each hand the thumb grows from the index side, and the index-to-pinky direction across the knuckles matches the other hand's, mirrored left to right (within 60°)
- **AND** curling the fingers of either hand closes them toward that hand's palm, never toward the back of the hand

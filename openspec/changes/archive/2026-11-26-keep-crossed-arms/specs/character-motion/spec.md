# Spec Delta

## ADDED Requirements

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

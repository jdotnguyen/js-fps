# Spec Delta

## MODIFIED Requirements

### Requirement: Coffee hand-off
The intro's last beat SHALL be a framed shot of Priya holding out a mug, with a "Take coffee" interact prompt. Taking the mug, or waiting 6 s, SHALL end the hand-off with the mug in Jay's hand. Priya then leaves for the medical bay after a closing exchange. She SHALL walk away from Jay toward the Observation Gallery door, and SHALL be taken off-stage the moment she is out of the player's view, without stopping anywhere first.

#### Scenario: Taking the coffee
- **WHEN** the player presses interact on the prompt
- **THEN** the mug moves to Jay's hand and the closing lines play

#### Scenario: Ignoring the prompt
- **WHEN** the player does nothing for 6 s
- **THEN** the hand-off ends by itself with the mug in Jay's hand

#### Scenario: She walks out
- **WHEN** the closing exchange starts
- **THEN** Priya walks away from Jay toward `D_R02_R03`

#### Scenario: Gone once out of view
- **WHEN** Priya leaves the player's view while walking away, past the edge of the screen or behind a wall or a closing door
- **THEN** she is taken off-stage at once, mid-walk, and is no longer in the Commons, the Observation Gallery or any doorway

### Requirement: Skip ends in the watched end state
Skipping at any point SHALL leave the same state as watching to the end: positions, flags, checkpoint, lines marked as played, and the mug in Jay's hand. Skipping the intro SHALL NOT skip the briefing.

#### Scenario: Skip during a scan
- **WHEN** the intro is skipped while the guard is scanning someone
- **THEN** the end state matches a full watch, with the guard back at his post

#### Scenario: Skip mid-walk
- **WHEN** the intro is skipped during the walk to the kitchen
- **THEN** the end state matches a full watch

#### Scenario: Skip during the hand-off
- **WHEN** the intro is skipped while Priya is holding out the mug
- **THEN** the mug ends in Jay's hand, Priya is gone from the Commons as if she had walked out, and the view is released facing where the shot was aimed

#### Scenario: Briefing after a skip
- **WHEN** the intro is skipped
- **THEN** the briefing still plays when it would normally start, and can be skipped on its own

## ADDED Requirements

### Requirement: The Commons after the intro
After the intro, no NPC in the Commons SHALL stand or rest within 1.2 m in front of any of its doors. When the Commons changes during the rounds, Bram SHALL be back at his station behind the counter. Loading a save SHALL place Priya and Bram where the story has left them, never at a doorway.

#### Scenario: No one in a doorway
- **WHEN** the level loads
- **THEN** no anchor that an NPC rests at in the Commons lies within 1.2 m in front of `D_R01_R02`, `D_R02_R03`, `D_R02_R12a`, `D_R02_R13a` or `D_R02_R14a`

#### Scenario: Bram at his station
- **WHEN** the rounds change the Commons (the TV comes on)
- **THEN** Bram stands at his station behind the counter, facing into the room
- **AND** nothing blocks the door to the Wet Vestibule

#### Scenario: The squad waits in the gallery
- **WHEN** the intro ends and Okafor has said the briefing is in the gallery
- **THEN** Giles and Okafor head straight to their briefing spots in the Observation Gallery and wait there for Jay
- **AND** if Giles comes back to call Jay, he stands beside the gallery door, not in it

#### Scenario: Load after the intro
- **WHEN** a save taken after the intro is loaded
- **THEN** Priya is not in the Commons, the Wet Vestibule or any doorway
- **AND** Bram is at his station

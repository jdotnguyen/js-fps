# Spec Delta

## ADDED Requirements

### Requirement: A far scream opens the charge
After the beacon has turned the view to the open R09 door, the creature's scream SHALL be the first sound of the charge, very loud and heard from where it stands far down the R09 hall with the tunnel's echo, before any squad line starts. The creature SHALL already be in place there, beside the ammo crate.

#### Scenario: Scream before speech
- **WHEN** the view has turned to the open door
- **THEN** the scream plays, sounding distant down the hall, and no squad line has started yet

### Requirement: Jay runs to the doors on the scream
The scream SHALL send Jay on a short scripted run from the wheel toward the R09 and R11 doors, with his view on the open door and the straight stretch of R09 beyond it and his weapon still holstered. The run SHALL end well short of the ambush trigger area, so control never returns with Jay inside it.

#### Scenario: Running on the scream
- **WHEN** the scream plays
- **THEN** Jay runs toward the doors without player input and stops outside the ambush trigger area

#### Scenario: Not already in the trigger
- **WHEN** the cutscene returns control to Jay
- **THEN** he is standing outside the ambush trigger area, so the ambush does not start until he walks into it

### Requirement: The charge is lit and framed
While the creature waits and screams, Jay's view SHALL be held on it and his flashlight SHALL be switched on when he reaches the end of his run, whatever the controls allow, and the hall light over the creature SHALL burn steady from the scream, so the creature can be seen from the pump room.

#### Scenario: Seeing it from the stop
- **WHEN** Jay's run ends
- **THEN** his flashlight is on, his view is on the creature at the far end of the hall, and it is visible through the open door

### Requirement: The view is freed at the slam
The cutscene SHALL give Jay back control and release his view as the door seals. The pounds, the creature walking back down and Giles's "Is it gone?" SHALL play with Jay free to look and move.

#### Scenario: Free for the pounds
- **WHEN** the leaves meet
- **THEN** Jay can already look and move while the creature pounds on the door and walks away

### Requirement: The ambush cuts off any talking and starts at once
When Jay walks into the ambush trigger area, any line being spoken or queued SHALL be silenced and the pry SHALL start immediately, even if the valve cutscene's pounds or Giles's "Is it gone?" are still playing. The valve cutscene's state (the valve done, the objective moved on, the Valve Room checkpoint) SHALL already be in place by then.

#### Scenario: Walking in during the aftermath
- **WHEN** Jay walks into the trigger area while the creature is still pounding or Giles is speaking
- **THEN** the speech stops, the pounding stops, and the pry starts on that frame

#### Scenario: Nothing lost by cutting in
- **WHEN** the ambush cuts the aftermath short
- **THEN** the objective, the checkpoint and the music have still reached the same end state as a full watch

## MODIFIED Requirements

### Requirement: The door seals in the creature's face
In the cutscene the R09–R10 door SHALL stand open when the view turns, so the stairs are seen through it. R09's water SHALL
NOT rise. The creature SHALL be the elite (the hero-tier body with blade arms). Once Jay's run has ended, it SHALL run from
where it screamed, at the far end of the straight part of R09 that can be seen through the door, the length of it, toward and up the
stairs. The door SHALL slam shut just before it arrives and stay sealed. It SHALL pound on the door, then walk back down out
of sight, so the danger seems past. After the cutscene, R09 SHALL be unreachable for the rest of the playthrough.

#### Scenario: The door seals
- **WHEN** the elite reaches the top of the stairs
- **THEN** the door has just slammed shut in front of it, it pounds on it, and the tunnel's water stays at its authored level

#### Scenario: Seen running down the hall
- **WHEN** Jay's run has ended and the elite starts to charge
- **THEN** Jay can see it run toward the door along the R09 hall through the open door

#### Scenario: Enemies left in the tunnel
- **WHEN** Jay turns the valve with two tunnel shamblers still alive
- **THEN** neither is left in play after the cutscene, and the group's fight counts as over

### Requirement: The cutscene's lines and music follow the slam
The squad's panic lines SHALL be spoken after the scream and before the door seals, and the call to seal it SHALL end as the leaves meet. No
line about the door or the charge SHALL start after the door has sealed. A music stinger SHALL land a single hit on the
slam. The score SHALL keep playing from the alarm through the pounds and the last line, then fade out.

#### Scenario: The call to seal it
- **WHEN** Okafor shouts to seal the door
- **THEN** the door starts closing during the line and the leaves meet as it ends

#### Scenario: Nothing is said too late
- **WHEN** the door has sealed
- **THEN** the only line still to come is Giles's quiet "Is it gone?" after the pounding, spoken with the view free

#### Scenario: The hit lands on the slam
- **WHEN** the leaves meet
- **THEN** the stinger's single hit and the slam sound land together, and the music carries on under the pounding

### Requirement: The elite pries its way back through at the R11 door
After the valve, when Jay first walks into the ambush trigger area in R10 beside the R09–R10 and R10–R11 doors, a
jump-scare sting SHALL play and the view SHALL whip round to the R09–R10 door. The elite's blade arms SHALL stab into the
seam between the door's leaves, clamp together, and wrench the leaves apart from the middle. The door SHALL then slam shut on its arms,
shearing both forearms off into the pump room. The arms SHALL reach through the doorway well into the pump room before the
door slams. The ambush SHALL happen once per save, in a fully lit R10.

#### Scenario: The ambush
- **WHEN** Jay walks into the trigger area beside the two doors after the valve cutscene
- **THEN** blades force the door open from the middle and reach in past it, the door slams back on them, and the severed forearms drop onto the pump-room floor

#### Scenario: Triggers soon after control returns
- **WHEN** Jay walks from where the cutscene left him toward the R11 bulkhead
- **THEN** the ambush starts as he enters the area beside the two doors, before he reaches the bulkhead

#### Scenario: The door never opens fully
- **WHEN** the elite wrenches the leaves apart
- **THEN** the gap is wider than before but stays too narrow to pass, and the door stays sealed throughout

#### Scenario: Only once
- **WHEN** Jay walks away from the trigger area and back again, or reloads after the ambush
- **THEN** the ambush does not play again

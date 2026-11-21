# dock-checkpoint Specification

## Purpose

Makes the Docking Ring (R01) a working security checkpoint. Everyone coming off the supply sub passes Jay's booth and a walk-through metal detector before entering the station.

## Requirements

### Requirement: Checkpoint divides the Docking Ring
R01 SHALL be split into a dock side (the airlock door `D_dock`) and a station side (the way to R01w). The split SHALL run along the booth's corner counter, then the detector line, to the dock window. With the gate closed, the walk-through arch SHALL be the only walkable way between the two sides.

#### Scenario: Route from the airlock goes through the arch
- **WHEN** a path is planned from the dock door to the R01w corridor
- **THEN** the route passes through the walk-through arch

#### Scenario: No gap around the line
- **WHEN** the navmesh is built for slice01
- **THEN** no walkable gap of 0.8 m or more exists between the counter, the detector line and the window, other than the arch

### Requirement: Security booth
Jay's post SHALL be a booth enclosed by the front counter, facing the dock window, and a second counter run from its west end to the south wall. The booth SHALL be open on its east side, toward the station side. Jay leans back against the security desk at the rear of the booth.

#### Scenario: Jay leans on the desk and sees the whole checkpoint
- **WHEN** Jay stands at `post_front`, back against the desk, facing its yaw
- **THEN** the counter is ahead of him, and the dock door, the queue and counter stop, the arch and the guard are all within view without turning

#### Scenario: Jay leaves by the open side
- **WHEN** Jay walks from `post_front` to the R01w corridor
- **THEN** his route exits the booth's east side without crossing the detector line

### Requirement: Security desk and CCTV wall
The booth SHALL contain a desk with keyboards and a wall-mounted bank of six camera feeds behind it on the south wall. One of the six feeds SHALL be the dock airlock camera that the existing `camera:feed` events drive.

#### Scenario: Airlock feed follows camera events
- **WHEN** a `camera:feed` event names the dock post feed with a new state
- **THEN** that screen in the bank switches to the new state

#### Scenario: Room stays inside its draw-call budget
- **WHEN** R01 is built
- **THEN** the six-screen bank costs at most two screen draw calls, and R01 stays within the 60-per-room budget

### Requirement: Detector line
A walk-through arch SHALL stand at the front counter's east end, with at least 1.0 m of clear opening. Waist-high rails and a closed staff gate SHALL run from the arch to the dock window. A tray table SHALL stand on the dock side of the arch. Nothing on the line except the arch SHALL rise above 1.2 m.

#### Scenario: The arch fits a body
- **WHEN** an NPC walks through the arch
- **THEN** it passes without its route stalling or its body touching the frame

#### Scenario: The dock window stays clear
- **WHEN** the intro frames `dock_window` from `post_front`
- **THEN** the rails and gate do not block the view of the docking sub

### Requirement: Arch scan feedback
Each pass through the arch SHALL resolve to a pass or an alarm. A pass SHALL light the arch green with a short chime. An alarm SHALL light it red with an alarm tone for about 1.5 s.

#### Scenario: Clean pass
- **WHEN** the script reports a pass at the arch
- **THEN** the arch's light bar shows green and the pass chime plays at the arch

#### Scenario: Alarm
- **WHEN** the script reports an alarm at the arch
- **THEN** the light bar shows red and the alarm tone plays at the arch, then the arch returns to idle

#### Scenario: Missing sound files
- **WHEN** a detector or wand sound has no recorded file
- **THEN** the scan still plays with its light and the game does not error

### Requirement: Dock guard
During arrivals the guard SHALL work on the station side facing the arch, use the unique `guard1` body, and carry the wand. His scripted duty SHALL continue at the booth desk after the queue clears. Ambient life SHALL never move him.

#### Scenario: Guard holds his post
- **WHEN** ambient life chooses NPCs to wander
- **THEN** the dock guard is never chosen

#### Scenario: No body twin
- **WHEN** slice01 loads
- **THEN** exactly one NPC uses the `guard1` body

#### Scenario: Waiting for the next arrival
- **WHEN** Jay watches the guard between arrivals
- **THEN** the wand rests low by his thigh, his elbow relaxes, and his weight settles over one planted foot
- **WHEN** the next person approaches
- **THEN** the guard turns his head toward them before shifting his weight to attend to them

### Requirement: Wand scan
When the guard scans someone, the person SHALL stop past the arch with arms out. The guard SHALL track the pass with his gaze and sweep the wand in one fluid movement with a beep. The person SHALL then lower their arms and walk on.

#### Scenario: Full scan
- **WHEN** the intro gives Ruiz a full scan
- **THEN** she stands arms out while the guard raises the wand, follows the sweep down with his body, and the wand beeps during the scan
- **AND** he lowers the wand as he clears her and she walks on

#### Scenario: Skipped mid-scan
- **WHEN** the intro is skipped during a scan
- **THEN** the person ends at their destination with arms down, the guard is seated at his desk, the chair is pulled up and the wand rests on the desk

### Requirement: Arch reacts in free play
During post-intro free play before the drop, the arch SHALL alarm when Jay walks through carrying a weapon. The seated guard SHALL acknowledge the alarm from the desk with a glance and a line at most once per pass, with at least 20 seconds between spoken reactions.

#### Scenario: Jay walks through armed
- **WHEN** Jay walks through the arch with a weapon in free play and the reaction is available
- **THEN** the arch alarms and the guard looks up and says one of his reaction lines from his seat

#### Scenario: Jay walks through unarmed
- **WHEN** Jay walks through the arch without a weapon
- **THEN** the arch shows a pass and the guard says nothing

#### Scenario: Back and forth
- **WHEN** Jay walks through armed twice within 20 seconds
- **THEN** the arch alarms both times but the guard speaks only the first time

### Requirement: Guard returns to the security desk
After dismissing Giles, the guard SHALL walk into the booth, set the wand on the desk, pull the existing chair into working position and sit at the keyboard facing the CCTV wall.

#### Scenario: The last arrival clears the arch
- **WHEN** Giles clears the arch after the guard's coffee line and Jay starts leaving the booth
- **THEN** the guard takes the open route to the desk without obstructing Jay or delaying the conversation

#### Scenario: Taking the chair
- **WHEN** the guard reaches the desk
- **THEN** the wand passes from hand to desktop, his hand reaches the chair back before the chair moves, and hand and chair travel together during the pull
- **AND** he turns into position, lowers onto the seat with his feet on the floor, and settles facing the screens

#### Scenario: Skipping the walk, pull or sit
- **WHEN** the intro is skipped during any part of the return to the desk
- **THEN** the guard, chair and wand reach the same final positions and poses as after a full watch

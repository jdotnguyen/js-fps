# scene-gathering Specification

## Purpose
Defines how a scripted scene waits for Jay and the squad to be inside a room before it closes or seals a door on them, so no one is shut on the wrong side of a scene.

## Requirements

### Requirement: Scene waits for everyone before sealing
A scene that seals or locks the door Jay came in by SHALL first make sure Jay and both squadmates are inside the room. A scene that leaves Jay free SHALL wait for them (`gatherIn`). The Observation Gallery drop walks Jay on rails and brings the squad in during the walk (see `gallery-drop`), so it seals `D_R02_R03` once all three are inside and does not wait on a timeout.

#### Scenario: Jay runs ahead into the gallery
- **WHEN** Jay enters a scene room several metres ahead of Giles and Okafor and the scene waits with `gatherIn`
- **THEN** the door stays open until both have walked in, then seals

#### Scenario: Jay steps back out
- **WHEN** Jay walks back out of the room before a waiting scene seals the door
- **THEN** the door does not seal and the scene does not go on until he is back inside

#### Scenario: The gallery drop seals after the walk
- **WHEN** the Observation Gallery drop starts with Giles and Okafor still outside
- **THEN** they are brought inside during Jay's walk, and `D_R02_R03` seals only after all three are in

### Requirement: Stragglers are brought in after a timeout
When the squad has not walked into the room within the step's timeout (8 s by default), each squadmate still outside SHALL be placed inside the room near Jay, out of his view where possible, and the scene SHALL go on.

#### Scenario: A squadmate is stuck behind a crowd
- **WHEN** Okafor has not reached the Control Room (R11) 8 s after the climax gather began
- **THEN** Okafor is placed inside R11 near Jay and the doors seal

### Requirement: Skipping a gathering scene
Skipping a scene SHALL complete any gather step at once: squadmates outside the room are placed inside it.

#### Scenario: Skip during the gather
- **WHEN** the player skips while a gather step is waiting
- **THEN** both squadmates end inside the room and the scene's end state applies

### Requirement: R11 wing stays physically isolated from the dive bay
Because `R13d` is physically separated from the Launch Hall (`R13b`) by a solid wall with no `D_R13b_R13d` door, opening `D_R13d_R11` during `R11` sequences SHALL NOT allow Jay or squadmates to reach the Dive Bay, and neither `action_climax` nor `action_restore` SHALL issue `doorState` commands for a removed `D_R13b_R13d` door.

#### Scenario: Stepping into R13d from R11
- **WHEN** `D_R13d_R11` is open and Jay walks north into `R13d`
- **THEN** the west end of `R13d` is a solid wall and the Dive Bay (`R13b`) cannot be entered from `R13d`

#### Scenario: Restoring a save taken in R11
- **WHEN** `action_restore` runs for a save taken after entering `R11`
- **THEN** it completes without referencing a non-existent `D_R13b_R13d` door

### Requirement: Climax gathers in R11 before it seals
When the climax is won, the scene SHALL wait until Jay and both squadmates are inside R11 (`gatherIn R11`) before Giles's "Doors sealing" line plays and `D_R10_R11` and `D_R13d_R11` seal. The reveal SHALL only start with Jay inside R11.

#### Scenario: The last enemy dies in the corridor
- **WHEN** Jay kills the last climax enemy while standing in R13d
- **THEN** the doors stay open, and the line, the seal and the reveal follow once he walks back into R11

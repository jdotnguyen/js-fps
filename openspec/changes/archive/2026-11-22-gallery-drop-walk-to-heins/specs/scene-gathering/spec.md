# Spec Delta

## MODIFIED Requirements

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

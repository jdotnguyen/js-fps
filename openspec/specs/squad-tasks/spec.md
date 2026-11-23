# squad-tasks Specification

## Purpose

Defines how a squadmate carries out a scripted panel job (Giles's bypasses and power work, Okafor's biometric lock): getting to the panel, working, pausing under threat, and finishing, so a door behind a job always opens.

## Requirements

### Requirement: A panel job starts close to its panel
A squadmate given a panel job SHALL walk to the job's spot and, when unobstructed, reach within 0.30 m of the spot and turn smoothly toward the job's heading before starting work. Soft personal-space repulsion from Jay and other squadmates SHALL NOT push a squadmate away while approaching or working a panel job. When Jay physically occupies the job's spot, the squadmate SHALL still start the job within 1.5 m of the spot without Jay having to move.

#### Scenario: Normal arrival
- **GIVEN** nothing stands at the panel spot
- **WHEN** the squadmate reaches it
- **THEN** he walks to within 0.30 m of the anchor, turns smoothly toward the job's heading without snapping in a single frame, takes the job's pose, and progress starts

#### Scenario: Jay stands on the panel spot
- **GIVEN** Giles has a bypass job at `anchor:r06_panel` and Jay is standing directly on that anchor
- **WHEN** Giles walks to the panel
- **THEN** he walks as close as capsule clearance permits and starts the bypass within 1.5 m of the anchor, facing the panel, without Jay having to move

#### Scenario: Jay watches beside an active worker
- **GIVEN** Giles or Okafor is actively working a door panel
- **WHEN** Jay walks within 1.1 m of the worker to watch
- **THEN** soft separation pushes SHALL NOT slide the worker backward off the panel or break his working pose

### Requirement: A panel job never waits forever to start
A squadmate who makes no progress toward his job's spot for 3 s SHALL start the job where he stands, facing the spot.

#### Scenario: Blocked on the way
- **GIVEN** Okafor has a biometric job and the way to `anchor:okafor_biometric` is blocked
- **WHEN** he has made no progress toward it for 3 s
- **THEN** he starts the job where he stands, and the door opens when the job finishes

### Requirement: Only enemies on the worker's level pause a job
A job SHALL pause while a living enemy is within 3 m of the worker horizontally and within 1.2 m of his floor height. Enemies further above or below SHALL NOT pause it. Progress made SHALL be kept across pauses.

#### Scenario: Enemy above the ceiling
- **GIVEN** Giles is working a bypass and a living enemy stands on the ceiling slab directly above him
- **WHEN** the job updates
- **THEN** the job keeps progressing

#### Scenario: Enemy beside the worker
- **GIVEN** Giles is working a bypass at 40 % progress
- **WHEN** an enemy on his floor comes within 3 m
- **THEN** the job pauses at 40 % and resumes from 40 % once no enemy on his level is within 3 m

### Requirement: Squad job beats regroup first
A scripted beat that sends a squadmate to a job SHALL first bring any squadmate who is more than 12 m from Jay and out of his view to a walkable spot near him, behind him and out of his view where possible. A squadmate Jay can see, or one within 12 m, SHALL NOT be moved. The cover-me job in R06, Okafor's biometric job at the med-lab door and Giles's power job in R11 SHALL start this way.

#### Scenario: Giles fell behind before the climax
- **WHEN** Jay enters R11 and the climax starts while Giles is 30 m away in the tunnel, out of Jay's view
- **THEN** Giles is moved near Jay before he walks to the console, and his job starts within a few seconds

#### Scenario: A visible squadmate is not teleported
- **WHEN** the climax starts while Okafor is 15 m away but in Jay's view
- **THEN** Okafor is not moved and walks to his spot

#### Scenario: A nearby squadmate is not moved
- **WHEN** a job beat starts while both squadmates are within 12 m of Jay
- **THEN** neither is moved

### Requirement: Door-unlock jobs align with and physically contact their wall device
Each scripted door-unlock job in slice01 SHALL place its anchor 0.45 m to 0.55 m directly in front of its physical wall device and clear of sliding door leaves. While actively working within arm reach of the device, the squadmate SHALL keep his feet planted, look at the device, and contact its vertical surface with hand IK aligned to the wall normal, releasing contact cleanly on pause or completion and re-establishing it on resume.

#### Scenario: Giles bypasses the R06 pressure door
- **GIVEN** `cover_me` sends Giles to `anchor:r06_panel`
- **WHEN** Giles arrives and begins the bypass
- **THEN** he stands centered in front of the `power_box` within 0.55 m of its front face, looks at the box, and works across its front surface with his hands

#### Scenario: Giles bypasses the R07 armory door
- **GIVEN** `armory_auto` sends Giles to `anchor:r07_armory_panel`
- **WHEN** Giles arrives and begins the short bypass
- **THEN** he stands centered in front of `D_R07_R07a`'s jamb status screen within 0.55 m of it, looks at the screen, and works on its surface

#### Scenario: Okafor unlocks the R07 med-lab biometric door
- **GIVEN** `medlab_door` sends Okafor to `anchor:okafor_biometric`
- **WHEN** Okafor arrives and begins the biometric unlock
- **THEN** he stands centered in front of `D_R07_R09`'s jamb status screen within 0.55 m of it, clear of the door leaves, looks at the screen, and presses his right palm onto the vertical screen surface

#### Scenario: Threat pauses and resumes a door job
- **GIVEN** Giles is working a door bypass with hand IK active on the device
- **WHEN** a living enemy on his floor enters 3 m, and later leaves or dies
- **THEN** his hand IK and device gaze release immediately while he defends with his pistol
- **AND** once clear, he turns smoothly back to the device and re-engages hand contact as progress resumes

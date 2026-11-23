# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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

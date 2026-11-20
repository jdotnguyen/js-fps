# squad-tasks Specification

## Purpose

Defines how a squadmate carries out a scripted panel job (Giles's bypasses and power work, Okafor's biometric lock): getting to the panel, working, pausing under threat, and finishing, so a door behind a job always opens.

## Requirements

### Requirement: A panel job starts close to its panel
A squadmate given a panel job SHALL walk to the job's spot and start working once he is within 1.5 m of it. The distance he keeps from Jay SHALL NOT stop him from starting.

#### Scenario: Jay stands on the panel spot
- **GIVEN** Giles has a bypass job at `anchor:r06_panel` and Jay is standing on that anchor
- **WHEN** Giles walks to the panel
- **THEN** he starts the bypass within 1.5 m of the anchor, without Jay having to move

#### Scenario: Normal arrival
- **GIVEN** nothing stands at the panel spot
- **WHEN** the squadmate reaches it
- **THEN** he takes the job's pose, faces the job's heading when it has one, and progress starts

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

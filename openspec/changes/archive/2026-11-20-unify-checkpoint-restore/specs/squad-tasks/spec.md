# Spec Delta

## ADDED Requirements

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

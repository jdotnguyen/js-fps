# Spec Delta

## ADDED Requirements

### Requirement: R11 wing stays physically isolated from the dive bay
Because `R13d` is physically separated from the Launch Hall (`R13b`) by a solid wall with no `D_R13b_R13d` door, opening `D_R13d_R11` during `R11` sequences SHALL NOT allow Jay or squadmates to reach the Dive Bay, and neither `action_climax` nor `action_restore` SHALL issue `doorState` commands for a removed `D_R13b_R13d` door.

#### Scenario: Stepping into R13d from R11
- **WHEN** `D_R13d_R11` is open and Jay walks north into `R13d`
- **THEN** the west end of `R13d` is a solid wall and the Dive Bay (`R13b`) cannot be entered from `R13d`

#### Scenario: Restoring a save taken in R11
- **WHEN** `action_restore` runs for a save taken after entering `R11`
- **THEN** it completes without referencing a non-existent `D_R13b_R13d` door

## REMOVED Requirements

### Requirement: Climax keeps the fight in the Control Room wing
**Reason**: `R11` is replaced by a no-combat Power Bay and `D_R13b_R13d` is removed in favor of a solid wall separating `R13d` from `R13b`.
**Migration**: Replaced by `R11 wing stays physically isolated from the dive bay`.

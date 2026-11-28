# Spec Delta

## ADDED Requirements

### Requirement: The maintenance corridor is closed from the dive bay
The door from the Launch Hall to the Maintenance Corridor (`D_R13b_R13d`) SHALL be sealed for the whole game and show "Out of service" when used. R13d SHALL be reachable only from the Control Room (R11), when the climax opens `D_R13d_R11`. Restoring any save SHALL leave `D_R13b_R13d` sealed.

#### Scenario: Trying the door during the rounds
- **WHEN** Jay uses the R13b–R13d door during the morning rounds
- **THEN** the door stays shut and shows "Out of service"

#### Scenario: Climax still reaches the corridor
- **WHEN** the climax opens `D_R13d_R11`
- **THEN** Jay can step from R11 into R13d, and `D_R13b_R13d` stays sealed

#### Scenario: Restore before the climax
- **WHEN** the player loads `cp_round_dive` or any checkpoint before the climax
- **THEN** `D_R13b_R13d` is sealed

## MODIFIED Requirements

### Requirement: Clean finish with decay only in the corridor
R13a, R13b, R13c and R13e SHALL use clean painted steel walls, clean treadplate or grating floors and clean hazard paint, with no rust textures. R13d SHALL keep rusty walls and floors and its dark lighting. Wear in the clean rooms SHALL come from placed decals (wet sheen, puddles, drip and salt stains), within the dressing standard's decal budget.

#### Scenario: Walking in from the Commons
- **WHEN** Jay walks from the Commons through R13a into R13b
- **THEN** no wall, floor or ceiling surface in those rooms uses a rust texture

#### Scenario: The corridor stays decayed
- **WHEN** Jay enters R13d from R11 during the climax
- **THEN** its walls and floor show rust and its single dying light still runs
- **AND** no flashlight prompt shows there: the station blackout teaches the flashlight instead

#### Scenario: Wet floor where water is
- **WHEN** Jay looks at the deck around the trunk and under the ROV
- **THEN** the floor there reads wet, with puddles, while floors away from them read dry

### Requirement: Script hooks are preserved
The rebuilt bay SHALL keep the anchors `dive_entry`, `priya_start`, `moon_pool`, `cp_round_dive`, `diver_1_spot`, `dive_case_pickup`, `dive_case_locker` and `dark_corridor` where they still serve their scenes. It SHALL keep the triggers `trigger:dive_enter`, `area:dark`, `round:dive_case` and `trigger:dive_lockers_enter`, the NPCs `priya`, `diver_1`, `maint_1` and `diver_2`, the `dive_map` station, every door id, and `D_R13d_R11` sealed for lockdown. The bay SHALL have no radio and no `dive_radio` anchor.

#### Scenario: Whole critical path still walks
- **WHEN** the headless critical-path walk runs
- **THEN** it reaches `cp_round_dive` and `dive_case_locker` through the real colliders and doors, as before

#### Scenario: No radio in the Sample Store
- **WHEN** slice01 is built
- **THEN** the dive bay has no `dive_radio` anchor and no sequence plays radio music there

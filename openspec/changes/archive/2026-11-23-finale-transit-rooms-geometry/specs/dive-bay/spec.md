# Spec Delta

## ADDED Requirements

### Requirement: Clean finish across the dive bay
R13a, R13b, R13c and R13e SHALL use clean painted steel walls, clean treadplate or grating floors and clean hazard paint, with no rust textures. Wear in these rooms SHALL come from placed decals (wet sheen, puddles, drip and salt stains), within the dressing standard's decal budget.

#### Scenario: Walking in from the Commons
- **WHEN** Jay walks from the Commons through R13a into R13b
- **THEN** no wall, floor or ceiling surface in those rooms uses a rust texture

#### Scenario: Wet floor where water is
- **WHEN** Jay looks at the deck around the trunk and under the ROV
- **THEN** the floor there reads wet, with puddles, while floors away from them read dry

### Requirement: Launch Hall east wall is solid
There SHALL be no doorway between the Launch Hall (`R13b`) and the Maintenance Corridor (`R13d`). The east edge of cell `(7, 8)` in `R13b` SHALL be a solid bulkhead wall on both sides so `R13d` is physically unreachable from the Dive Bay for the entire game.

#### Scenario: Looking at the east wall of the Launch Hall
- **WHEN** Jay stands in `R13b` looking toward the north-east wall at cell `(7, 8)`
- **THEN** he sees a continuous solid wall with no door, no "Out of service" prompt, and no sightline or collision gap into `R13d`

#### Scenario: Level data has no R13b–R13d door
- **WHEN** `slice01.json` is generated
- **THEN** no door with id `D_R13b_R13d` exists in the level's doors list

## MODIFIED Requirements

### Requirement: Room roles
The dive bay SHALL consist of four rooms with these names and roles: R13a "Wet Vestibule" (the transition from the dry station), R13b "Launch Hall" (launch-and-recovery hall around the launch trunk), R13c "ROV Workshop" (vehicle maintenance) and R13e "Sample Store" (cold storage and chain of custody for recovered samples). The station map SHALL show these names when the dive bay map station is used. R13d is detached from the dive bay and belongs to the `transit` area (see `transit-wing`).

#### Scenario: Map shows the new names
- **WHEN** Jay uses the dive bay map station
- **THEN** the map reveals all four dive bay rooms, labelled Wet Vestibule, Launch Hall, ROV Workshop and Sample Store

#### Scenario: No dive suits for open-water diving
- **WHEN** slice01 is built
- **THEN** no dive-suit rack stands in R13a, R13b or R13c

### Requirement: Lighting and atmosphere
R13a, R13b, R13c and R13e SHALL be lit by neutral white work lights, with fog density at or below 0.02. In R13b the strongest blue light SHALL come from the trunk: an upward shaft and moving caustics on the ceiling and gantry above it, and a thin mist over the shaft water.

#### Scenario: Trunk as the focal point
- **WHEN** Jay enters R13b from R13a
- **THEN** the trunk area is the only strongly blue-lit part of the room, with caustics moving on the ceiling above it

#### Scenario: Visibility in the hall
- **WHEN** Jay stands at the R13a door
- **THEN** the far wall of R13b is clearly visible through the fog

### Requirement: Station signage in the dive bay
Each room in R13a, R13b, R13c and R13e SHALL have a room plate by its entry door and a life-support panel showing oxygen, CO₂, cabin pressure and humidity. Pipes in R13b SHALL carry labels with flow arrows.

#### Scenario: Entering the hall
- **WHEN** Jay walks through the R13a–R13b door
- **THEN** a plate reading "R13B · LAUNCH TRUNK 1" is beside the door

### Requirement: Script hooks are preserved
The rebuilt bay SHALL keep the anchors `dive_entry`, `priya_start`, `moon_pool`, `cp_round_dive`, `diver_1_spot`, `dive_case_pickup` and `dive_case_locker` where they still serve their scenes. It SHALL keep the triggers `trigger:dive_enter`, `round:dive_case` and `trigger:dive_lockers_enter`, the NPCs `priya`, `diver_1`, `maint_1` and `diver_2`, the `dive_map` station, and the dive bay doors (`D_R02_R13a`, `D_R13a_R13b`, `D_R13b_R13c`, `D_R13b_R13e`). The bay SHALL have no radio and no `dive_radio` anchor.

#### Scenario: Whole critical path still walks
- **WHEN** the headless critical-path walk runs
- **THEN** it reaches `cp_round_dive` and `dive_case_locker` through the real colliders and doors, as before

#### Scenario: No radio in the Sample Store
- **WHEN** slice01 is built
- **THEN** the dive bay has no `dive_radio` anchor and no sequence plays radio music there

## REMOVED Requirements

### Requirement: Clean finish with decay only in the corridor
**Reason**: `R13d` is detached from the Dive Bay into the `transit` area (`transit-wing`), so the Dive Bay no longer owns a decayed corridor.
**Migration**: Replaced by `Clean finish across the dive bay` in this spec and the `R13d` requirements in `transit-wing`.

### Requirement: The maintenance corridor is closed from the dive bay
**Reason**: Door `D_R13b_R13d` is removed completely and replaced by a solid wall separating `R13b` Launch Hall from `R13d`.
**Migration**: Replaced by `Launch Hall east wall is solid` in this spec and `Maintenance Corridor links the Power Bay to the Departure Boarding Bay` in `transit-wing`.

# dive-bay Specification

## Purpose

Defines the dive bay suite behind the Commons (R13a–e) as a believable deep-sea launch-and-recovery facility: what each room is for, how its launch trunk works at 3,000 m, how it looks, and what it must keep for the quiet-half script.

## Requirements

### Requirement: Room roles
The dive bay SHALL consist of four rooms with these names and roles: R13a "Wet Vestibule" (the transition from the dry station), R13b "Launch Hall" (launch-and-recovery hall around the launch trunk), R13c "ROV Workshop" (vehicle maintenance) and R13e "Sample Store" (cold storage and chain of custody for recovered samples). The station map SHALL show these names when the dive bay map station is used. R13d is detached from the dive bay and belongs to the `transit` area (see `transit-wing`).

#### Scenario: Map shows the new names
- **WHEN** Jay uses the dive bay map station
- **THEN** the map reveals all four dive bay rooms, labelled Wet Vestibule, Launch Hall, ROV Workshop and Sample Store

#### Scenario: No dive suits for open-water diving
- **WHEN** slice01 is built
- **THEN** no dive-suit rack stands in R13a, R13b or R13c

### Requirement: Launch trunk
The launch trunk SHALL be a closed vertical lock, not an open moon pool at deck level, and nothing the player sees or hears (room names, signs, map labels, dialogue, objectives) SHALL call it a moon pool. It SHALL have an inner hatch at deck level, a drained shaft with depth marks and standing water at its foot, and a closed outer hatch with a lit viewport at the bottom. A rail with a closed gate SHALL surround it. No player or NPC SHALL be able to enter the shaft.

#### Scenario: Looking into the trunk
- **WHEN** Jay stands at the rail while the inner hatch is open
- **THEN** he sees down a drained steel shaft to standing water and a blue-lit viewport in the outer hatch, and no water surface at deck level

#### Scenario: Shaft is not enterable
- **WHEN** Jay walks or jumps toward the trunk from any side
- **THEN** the rail and gate stop him before the shaft opening

#### Scenario: Hull from outside
- **WHEN** the station's exterior hull is built
- **THEN** the trunk shows as a closed skirt and hatch under the hull, with no open hole

### Requirement: Trunk secure event
The trunk SHALL start the quiet half with its inner hatch open. After Sung's dive-bay lines first finish, the trunk SHALL be secured: an amber beacon turns, a two-tone chirp and a vent hiss play from the trunk, the inner hatch closes, and the status screen reads "TRUNK SECURED". The event SHALL NOT overlap a dialogue line spoken in the dive bay. Lines elsewhere on the station SHALL NOT delay it. The closed hatch SHALL keep a viewport showing the blue glow below.

#### Scenario: First visit
- **WHEN** Jay enters the dive bay after the briefing and Sung's lines play
- **THEN** the secure event starts only after the last of those lines ends, and the hatch is closed and the screen reads "TRUNK SECURED" when it finishes

#### Scenario: Before the briefing
- **WHEN** Jay enters the dive bay before the briefing has been seen
- **THEN** the trunk stays open and the secure event does not run

#### Scenario: A scene still playing elsewhere
- **WHEN** Hale's office scene is still playing while Sung's dive-bay lines finish
- **THEN** the secure event starts right after Sung's lines, without waiting for Hale's

### Requirement: Secured trunk persists
Once secured, the trunk SHALL stay secured after a save load or a death restart, and the secure event SHALL NOT replay.

#### Scenario: Load after securing
- **WHEN** a save taken after the secure event is loaded
- **THEN** the hatch is already closed, the screen reads "TRUNK SECURED", and no beacon, chirp or hiss plays

### Requirement: Working equipment
R13b SHALL contain a gantry crane on rails over the trunk area, a recovered ROV on a deck cradle with a basket of sediment cores, a tether winch, a pilot console facing the trunk with status screens, a dive-log whiteboard, a wet bench, an eyewash station and a tool shadow-board. The status screens SHALL show the outside pressure as 302 bar, the trunk state, tether length and a sonar display.

#### Scenario: Reading the console
- **WHEN** Jay looks at the pilot console
- **THEN** he can read the outside pressure (302 BAR), the trunk state and the tether length

#### Scenario: Recovered vehicle
- **WHEN** Jay enters R13b
- **THEN** the ROV sits on its cradle with water dripping from it, and the gantry hook hangs above it

### Requirement: Sample errand route
The sample case SHALL be picked up in R13b at `dive_case_pickup` and stowed in R13e at a chain-of-custody cold store at `dive_case_locker`, with the existing "Stow sample case" prompt and the existing lines. The store SHALL be marked for Lab B and SHALL include a pressure sample cabinet labelled "HOLD AT 302 BAR". Stowing SHALL take effect on use: the round completes at once, whatever dialogue is playing, and Sung's acknowledgement follows without holding the round back.

#### Scenario: Stowing the case
- **WHEN** Jay uses the stow point in R13e while carrying the sample case
- **THEN** the round completes, and the stow point is a cold-store unit marked for Lab B

#### Scenario: Stowing during Sung's conversation
- **WHEN** Jay uses the stow point while Sung's dive-bay lines are still playing
- **THEN** the click plays and the objective completes at once, and "Locker's signed" plays once Sung finishes his current line

### Requirement: Clean finish across the dive bay
R13a, R13b, R13c and R13e SHALL use clean painted steel walls, clean treadplate or grating floors and clean hazard paint, with no rust textures. Wear in these rooms SHALL come from placed decals (such as wet sheen, puddles and salt stains), within the dressing standard's decal budget.

#### Scenario: Walking in from the Commons
- **WHEN** Jay walks from the Commons through R13a into R13b
- **THEN** no wall, floor or ceiling surface in those rooms uses a rust texture

#### Scenario: Wet floor where water is
- **WHEN** Jay looks at the deck around the trunk and under the ROV
- **THEN** the floor there reads wet, with puddles, while floors away from them read dry

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

### Requirement: Nothing outside the dive bay changes
Generating slice01 SHALL change nothing outside R13a–e.

#### Scenario: Nothing else moves
- **WHEN** slice01 is regenerated with this change
- **THEN** every room, door, anchor, NPC and trigger outside R13a–e is identical to the previous level file, including `D_R02_R13a`

### Requirement: Budgets and clearance
The slice01 level tests SHALL report the draw calls of each room in R13a–e and of the heaviest visible view, following the render-quality spec's reported-counts rule; a count SHALL NOT fail the tests. A clear path of at least 1.2 m SHALL run between every pair of doors in R13b and around the stow point, the case pickup and the map station.

#### Scenario: Draw calls after dressing
- **WHEN** the slice01 budget test runs
- **THEN** it logs each R13 room's draw-call count and passes whatever the counts are

#### Scenario: Squad-width paths
- **WHEN** two 0.35 m capsules walk side by side from the R13a door to the R13e door
- **THEN** they pass the trunk rail, the bench and the console without stalling

### Requirement: Launch Hall east wall is solid
There SHALL be no doorway between the Launch Hall (`R13b`) and the Maintenance Corridor (`R13d`). The east edge of cell `(7, 8)` in `R13b` SHALL be a solid bulkhead wall on both sides so `R13d` is physically unreachable from the Dive Bay for the entire game.

#### Scenario: Looking at the east wall of the Launch Hall
- **WHEN** Jay stands in `R13b` looking toward the north-east wall at cell `(7, 8)`
- **THEN** he sees a continuous solid wall with no door, no "Out of service" prompt, and no sightline or collision gap into `R13d`

#### Scenario: Level data has no R13b–R13d door
- **WHEN** `slice01.json` is generated
- **THEN** no door with id `D_R13b_R13d` exists in the level's doors list

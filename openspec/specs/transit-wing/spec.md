# transit-wing Specification

## Purpose

Defines the structural layout, spatial progression, greybox train shells, grand arrival terminal geometry, walkability, and debug jump access of the station's lower transit wing (`R11` Power Bay, `R13d` Maintenance Corridor, `R15a` Departure Boarding Bay, `R16a` Arrival Track Dock, `R16b` Arrival Concourse, and `R16c` Arrival Dispatch Room).

## Requirements

### Requirement: Power Bay shell replaces the Control Room
`R11` SHALL be named "Power Bay" and occupy a `12 m x 12 m` (`3x3` cells) footprint with a `5.0 m` ceiling height. Its legacy control-room console banks and climax combat spawns (`r11_climax`) SHALL be removed, leaving a walkable Power Bay with `D_R10_R11` south, `D_R13d_R11` north, and a west-wall transit power-up terminal anchor (`final_console` / `r11_giles_task`).

#### Scenario: Entering R11 from the Pump Room
- **WHEN** Jay walks north through `D_R10_R11` into `R11`
- **THEN** he enters a `5.0 m`-tall industrial bay named "Power Bay" with no legacy control-room console banks and no active or queued enemy spawns

#### Scenario: Walking straight across R11 to R13d
- **WHEN** `D_R13d_R11` is open and a body walks from `D_R10_R11` to `D_R13d_R11`
- **THEN** it crosses `R11` along an unobstructed aisle (`>= 1.2 m` clear width) without colliding with machinery, legacy consoles, or combat obstructions

### Requirement: Maintenance Corridor links the Power Bay to the Departure Boarding Bay
`R13d` SHALL belong to the `transit` area (detached from the Dive Bay), keep its `12 m x 4 m` (`3x1` cells) east-west corridor footprint, close its west end with a solid wall where `D_R13b_R13d` formerly stood, and omit the floor-level pipe run, pipe labels, and steam leak in front of `D_R13d_R11`. Its east end SHALL connect to `R15a` through bulkhead door `D_R13d_R15a`.

#### Scenario: Clear doorway from Power Bay into Maintenance Corridor
- **WHEN** Jay steps north through `D_R13d_R11` into `R13d`
- **THEN** no pipe crosses in front of the doorway, the west end of the corridor is a solid wall with no door to the Dive Bay, and looking east shows the bulkhead door `D_R13d_R15a`

#### Scenario: Walking from R11 through R13d into the Departure Boarding Bay
- **WHEN** `D_R13d_R11` and `D_R13d_R15a` are open
- **THEN** a body walks smoothly from `R11` through `R13d` into `R15a`

### Requirement: North-South Departure Boarding Bay with walkable train shell
`R15a` ("Departure Boarding Bay") SHALL sit east of `R13d` as a `12 m x 16 m` (`3x4` cells) North-South hall with a `5.0 m` ceiling height. It SHALL provide a west boarding platform receiving `D_R13d_R15a`, a center North-South track channel holding a walkable greybox Train Car shell with side windows and a west boarding doorway, and east ocean windows looking into the exterior abyss.

#### Scenario: Stepping onto the Departure Boarding Bay platform
- **WHEN** Jay walks east through `D_R13d_R15a` into `R15a`
- **THEN** he stands on the `4 m`-wide west boarding platform with the North-South train car shell directly east of him and real ocean windows beyond the track

#### Scenario: Boarding the departure train shell
- **WHEN** Jay walks from the `R15a` west platform through the train car's west doorway
- **THEN** he stands inside the enclosed, windowed greybox train car without falling through the floor or clipping outside the car walls

### Requirement: Isolated Arrival Track Dock with left-turn stair choreography
`R16a` ("Arrival Track Dock") SHALL sit at isolated grid coordinates culled from the main station. It SHALL be a `12 m x 12 m` (`3x3` cells) North-South dock (`5.0 m` ceiling, sunken `floorY: -0.6`) with a center track holding a matching walkable greybox Train Car shell stopping before the stairs, a west exit platform, and wide south stairs climbing `+0.6 m` onto `R16b`.

#### Scenario: Exiting the arrival train and turning left
- **WHEN** Jay steps west out of the `R16a` train car's west doorway onto the platform
- **THEN** he faces a solid west wall roughly `3.5 m` to `4.0 m` ahead
- **AND** turning left (south) faces wide stairs climbing `+0.6 m` directly onto the `R16b` Arrival Concourse

#### Scenario: Arrival Terminal is culled from the departure wing
- **WHEN** the camera stands anywhere in `R11`, `R13d`, or `R15a`
- **THEN** `R16a`, `R16b`, and `R16c` are not drawn

### Requirement: Grand Arrival Concourse and Dispatch Room shell
`R16b` ("Arrival Concourse") SHALL join the south edge of `R16a` via open seams at deck level (`y = 0`) and span `20 m x 24 m` (`5x6` cells) with an `8.0 m` ceiling height. It SHALL frame an unobstructed central path with symmetrical pillar rows (at least three pairs) on the way to flanking check-in booth bays on both sides, leading to a doorway into `R16c` ("Arrival Dispatch") at the south end.

#### Scenario: Cresting the stairs into the Arrival Concourse
- **WHEN** Jay climbs the stairs from `R16a` into `R16b`
- **THEN** he stands at deck level (`y = 0`) under an `8.0 m` ceiling looking south down a clear central aisle framed by symmetrical full-height pillar rows (wide enough to conceal a large figure behind a pillar), flanking check-in booth bays along the east and west sides, and the `R16c` dispatch entrance

#### Scenario: Walking the entire arrival terminal
- **WHEN** a body walks from inside the `R16a` train car, out onto the west platform, up the south stairs into `R16b`, down the central path past the pillars and check-in booths, and into `R16c`
- **THEN** it completes the walk on real colliders without stalling or falling through seams

### Requirement: Modular grid compliance and debug jump access
All new and modified rooms in the transit wing SHALL conform to the `4.0 m` modular grid standard with no coplanar z-fighting, no floor/wall seam gaps, and valid sunken-floor anchor placement. The debug launcher SHALL support `?debug&jump=r11`, `?debug&jump=r15a`, and `?debug&jump=r16` so each stage of the transit wing can be inspected directly in the browser.

#### Scenario: Jumping directly to the Departure Bay and Arrival Terminal
- **WHEN** the game launches with `?debug&jump=r15a` or `?debug&jump=r16`
- **THEN** Jay spawns standing on walkable floor inside `R15a` (facing the docked train) or `R16a` (at the train exit facing west/left toward the stairs) with clear sightlines and no black screen

### Requirement: Power Bay turbine-generators and switchgear dressing
`R11` SHALL be dressed as a deep-sea power plant with at least two parallel turbine-generator units along the east bay, a high-voltage switchgear cabinet bank, industrial auxiliary props, overhead `5.0 m` service runs, hazard markings, stencils, and rule-placed grime decals obeying the surface-dressing standard. Placed props SHALL preserve `>= 1.2 m` clear paths between `D_R10_R11`, `r11_giles_task`, `r11_hold`, and `D_R13d_R11`.

#### Scenario: Viewing the Power Bay from the south entry
- **WHEN** Jay stands inside `D_R10_R11` looking north into `R11`
- **THEN** he sees Giles's transit power-up terminal anchored on the west wall, twin heavy turbine-generator units and high-voltage switchgear framing the east bay, overhead service runs in the upper `5.0 m` volume, and a clear central aisle leading toward `D_R13d_R11`

#### Scenario: Walking to all Power Bay work anchors
- **WHEN** a player or squad capsule walks from `D_R10_R11` to `r11_giles_task`, `r11_hold`, and `D_R13d_R11`
- **THEN** every leg completes on real colliders with at least `1.2 m` path clearance and no prop snagging

### Requirement: Giles's transit power-up terminal
`R11`'s west-wall terminal at `final_console` SHALL be a dedicated transit power-up control station with a live telemetry display showing the lower transit sub-grid state (`standby`, `starting`, and `online`), physical breaker controls, and floor conduit feeds linking it toward the power machinery.

#### Scenario: Terminal telemetry reflects sub-grid power state
- **WHEN** `R11` enters under station backup power before energization
- **THEN** the west-wall terminal display shows the transit sub-grid in `standby` / offline status with amber warnings
- **AND** once `R11` energizes, the display transitions through `starting` / spin-up telemetry to steady `online` / rail-bus-ready status

### Requirement: Power Bay cascading lights-on and machinery spin-up sequence
Under station `backup` power prior to energization, `R11`'s overhead bay light banks SHALL stay off while its emergency beacons keep the bay readable. When triggered, `R11`'s power-up cascade SHALL play breaker and turbine audio, spin up generator rotors, energize overhead light banks sequentially from west to east (respecting `reducedFlashing`), shift machinery indicators to online, and extinguish standby beacons. The energized state SHALL persist across checkpoints and reset on level reset.

#### Scenario: Dormant arrival under backup power
- **WHEN** the station is on `backup` power and `R11` has not yet been energized
- **THEN** `R11`'s main overhead bay light banks cast no light, its emergency beacons provide standby visibility, the turbine rotors are stationary, and the terminal and switchgear show standby indicators

#### Scenario: Staged cascading power-up
- **WHEN** the `R11` power-up cascade triggers while the station is on `backup` power
- **THEN** `R11`'s overhead light banks energize sequentially across three spatial stages rather than all on one frame
- **AND** generator rotors spin up, status indicators and terminal telemetry shift to `online`, breaker/hum audio plays, and the standby emergency beacons turn off once the final bank stabilizes
- **AND** other rooms on the station remain on `backup` power

#### Scenario: Reduced flashing during cascade
- **WHEN** `reducedFlashing` is enabled and the `R11` power-up cascade runs
- **THEN** each light bank transitions cleanly without rapid high-contrast ballast strobing

#### Scenario: Checkpoint restore and debug preview
- **WHEN** the game loads a state where `R11` has already been energized (`r11_powered`)
- **THEN** `R11`'s overhead light banks, turbine rotors, switchgear indicators, and terminal telemetry restore directly to their `online` state
- **AND** launching with `?debug&jump=r11` allows inspecting both the dormant standby bay and triggering the cascading power-up sequence directly


# Spec Delta

## MODIFIED Requirements

### Requirement: Power Bay shell replaces the Control Room
`R11` SHALL be named "Power Bay" and occupy a `12 m x 12 m` (`3x3` cells) footprint with a `5.0 m` ceiling height. Its legacy control-room console banks and climax combat spawns (`r11_climax`) SHALL be removed, leaving a walkable Power Bay with `D_R10_R11` south, `D_R13d_R11` north, and a west-wall transit power-up terminal anchor (`final_console` / `r11_giles_task`).

#### Scenario: Entering R11 from the Pump Room
- **WHEN** Jay walks north through `D_R10_R11` into `R11`
- **THEN** he enters a `5.0 m`-tall industrial bay named "Power Bay" with no legacy control-room console banks and no active or queued enemy spawns

#### Scenario: Walking straight across R11 to R13d
- **WHEN** `D_R13d_R11` is open and a body walks from `D_R10_R11` to `D_R13d_R11`
- **THEN** it crosses `R11` along an unobstructed aisle (`>= 1.2 m` clear width) without colliding with machinery, legacy consoles, or combat obstructions

## ADDED Requirements

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

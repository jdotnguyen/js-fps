# Spec Delta

## ADDED Requirements

### Requirement: Maintenance Corridor clean transit finish and wayfinding
`R13d` SHALL use the clean `transit` area palette rather than legacy rusty Dive Bay surface overrides, replace any obstructing debris with wall-mounted conduit/pipe runs and clean industrial lighting, and display directional transit signage leading east toward `R15a` while preserving `>= 1.2 m` clear aisle width.

#### Scenario: Stepping from Power Bay into Maintenance Corridor
- **WHEN** Jay steps north through `D_R13d_R11` into `R13d`
- **THEN** he sees clean industrial transit walls, floor, and ceiling consistent with `R11` and `R15a`, overhead/wall conduit runs, and directional signage pointing east toward `R15a` Departure Boarding Bay

#### Scenario: Walking the Maintenance Corridor end-to-end
- **WHEN** a player or squad capsule walks from `D_R13d_R11` east to `D_R13d_R15a`
- **THEN** the corridor has at least `1.2 m` clear walkable width with no obstructing debris piles

### Requirement: Departure Boarding Bay industrial finish and rail signage
`R15a` SHALL be dressed with clean industrial transit architecture across its `5.0 m` volume, including overhead gantry ribs, a yellow tactile hazard edge and safety railings along the west platform (with a `>= 2.2 m` boarding gap aligned to the train doorway), an illuminated rail departure board, platform seating/kiosk props, and track-side rail signals.

#### Scenario: Viewing the Departure Boarding Bay from the platform entry
- **WHEN** Jay steps east through `D_R13d_R15a` into `R15a`
- **THEN** he sees a clean industrial rail concourse with overhead gantry framing, a lit departure schedule board (`TRANSIT LINE 01 // ARRIVAL TERMINAL`), yellow platform-edge safety markings, and the docked train car beside the boarding gap

#### Scenario: Boarding clearance along the west platform
- **WHEN** a player or squad capsule walks from `D_R13d_R15a` along the `R15a` west platform and boards the train car through its west doorway
- **THEN** the platform safety railing frames the platform edge without blocking the `>= 2.2 m` boarding gap or colliding with `r15a_platform` and `r15a_train_inside`

### Requirement: Blast-gate tunnel portals at R15a south and R16a north
`R15a`'s south track end and `R16a`'s north track end SHALL each feature a recessed sea-tunnel portal housing with heavy armored blast-gate shutter leaves, hazard chevrons, and rail aspect signals. Each gate SHALL default to sealed and support opening/closing via scripted transit events, resetting to sealed on level reset.

#### Scenario: Sealed tunnel portals on arrival in R15a and R16a
- **WHEN** `R15a` or `R16a` loads under default level state
- **THEN** the `R15a` south track wall and `R16a` north track wall each display a sealed armored blast-gate tunnel portal with red/amber rail aspect signals instead of a plain flat wall panel

#### Scenario: Opening a blast-gate tunnel portal for train transit
- **WHEN** a scripted transit event opens the `R15a` south blast gate (or `R16a` north blast gate)
- **THEN** the armored shutter leaves retract to reveal the dark sea-tunnel bore and the rail aspect signals shift to green/clear, returning to sealed on level reset

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
`R15a`'s south track end and `R16a`'s north track end SHALL each feature a recessed sea-tunnel portal housing with heavy armored blast-gate shutter leaves, hazard chevrons, and rail aspect signals. Each gate SHALL default to sealed, support opening/closing via scripted transit events (disabling its shutter collider while open so a train car can pass cleanly through the bore and re-enabling it when sealed), and reset to sealed on level reset.

#### Scenario: Sealed tunnel portals on arrival in R15a and R16a
- **WHEN** `R15a` or `R16a` loads under default level state
- **THEN** the `R15a` south track wall and `R16a` north track wall each display a sealed armored blast-gate tunnel portal with red/amber rail aspect signals instead of a plain flat wall panel
- **AND** the sealed shutter collider blocks passage through the bore

#### Scenario: Opening a blast-gate tunnel portal for train transit
- **WHEN** a scripted transit event opens the `R15a` south blast gate (or `R16a` north blast gate)
- **THEN** the armored shutter leaves retract to reveal the dark sea-tunnel bore, the shutter collider is disabled for unobstructed train passage, and the rail aspect signals shift to green/clear, returning to sealed on level reset

### Requirement: Finished clean transit train interior and animated boarding door
Train Car A (`R15a`) and Train Car B (`R16a`) SHALL feature a finished clean transit cabin interior using the `transit` palette with no rusty or dirty textures, including bench seating, overhead grab rails, interior cabin lighting, status strips, wide end windshields, and an animated west boarding door.

#### Scenario: Inspecting the boarded train cabin interior
- **WHEN** Jay boards Train Car A in `R15a` or stands inside Train Car B in `R16a`
- **THEN** he sees clean slate/steel cabin walls, non-slip metal flooring, commuter bench seating, overhead grab rails, lit cabin status strips, and clear side and end windows with no rusty or dirty textures

#### Scenario: Boarding door seals for departure and opens on arrival
- **WHEN** the departure ride begins or Train Car B docks in `R16a`
- **THEN** the west boarding door leaf slides closed and engages its doorway collider for departure, and slides open with the doorway collider cleared once Train Car B comes to rest at the `R16a` exit platform

#### Scenario: Open door leaf stays inside its pocket
- **WHEN** the boarding door is fully open
- **THEN** the leaf is entirely contained in a solid window-less wall pocket beside the doorway and does not overlap any window glass, mullion, trim post or bench
- **AND** the closed leaf fills the doorway flush with the wall plane

### Requirement: Car rides on visible bogies above a lit, non-intersecting track
Each train car SHALL ride on visible bogies with its body lifted above the track, so no rail, sleeper or track-bed piece intersects the car floor, skirts or cabin, and the track is visible and lit below and ahead of the car.

#### Scenario: Track is visible and clear of the car
- **WHEN** Jay looks at the parked car from the platform, or out through the windshield during any ride stage
- **THEN** two bogies with wheelsets are visible under the car, rails run beneath it with a clear gap below the floor underside, and no rail geometry passes through the car floor or interior
- **AND** the rails show metallic highlights from the headlights and the car's underside guide-strip glow

#### Scenario: Boarding still works with the lifted car
- **WHEN** Jay walks from the `R15a` platform into Train Car A, or from Train Car B onto the `R16a` platform
- **THEN** a boarding step or ramp bridges the lifted threshold and Jay walks on and off without jumping or snagging

### Requirement: Stage 1 departure pull-out through R15a south blast gate
When the 3-stage hybrid abyssal ride starts, `r15a_south` SHALL open via `transit:blast_gate`, Train Car A SHALL seal its boarding door and pull out `14 m` south (`+Z`) through the open south portal into the lit hallway, carrying Jay smoothly inside the cabin.

#### Scenario: Train Car A pulls out of R15a through the open south blast gate
- **WHEN** the 3-stage transit ride triggers while Jay is inside Train Car A in `R15a`
- **THEN** `r15a_south` opens via `transit:blast_gate`, the cabin boarding door closes, and Train Car A accelerates smoothly `14 m` south through the portal while Jay moves with the cabin floor without clipping or falling through

#### Scenario: Nothing intersects the car while it leaves the station
- **WHEN** Train Car A passes through the `R15a` south portal and into the hallway shroud
- **THEN** no portal, jamb, rail, wall or shroud geometry is visible through or inside the car body, and Jay never sees the room walls or hull pass through the cabin

### Requirement: Stage 2 infinite scrolling lit hallway, slowing early into a closed gate
After Stage 1 pull-out, the ride SHALL hand off seamlessly into an isolated, infinite-scrolling lit hallway that matches the shrouds, fades to black at its open ends, and slows smoothly near its end while a closed blast gate arrives where R16a's closed gate will be.

#### Scenario: Riding through the hallway
- **WHEN** Stage 2 of the transit ride is active
- **THEN** Jay remains inside the clean train cabin while lit rib bars, guide strips and wall-panel seams scroll past outside the cabin windows, and the hallway ahead fades to black with no visible hard edge

#### Scenario: One continuous hallway
- **WHEN** Jay rides from the R15a pull-out through Stage 2 and into the R16a glide-in
- **THEN** the same lit hallway is visible throughout, with no open water, ocean floor or windows to the outside

#### Scenario: Slowing early into a visible gate
- **WHEN** Stage 2 nears its end
- **THEN** the hallway scroll slows smoothly (never speeding up again) to the Stage 3 start speed, and a bright closed blast gate with lit signals emerges from the fog and stops 10.125 m ahead of the car

#### Scenario: Nothing crosses the car or the bore
- **WHEN** a car passes through an open blast gate or stands in its cabin
- **THEN** no static gate geometry, room wall or ceiling light shaft is inside the car body or its path

### Requirement: Stage 3 seamless handoff to Train Car B gliding into R16a
At the end of Stage 2, the ride SHALL hand off seamlessly to Train Car B, which glides ~`15 m` south at a start speed of `5 m/s` through the `r16a_north` blast gate (which lifts after the hand-off) into `R16a`, decelerating to rest at the `R16a` exit platform, opening its west boarding door, and sealing `r16a_north` behind it.

#### Scenario: Train Car B glides into R16a and opens for disembarkation
- **WHEN** Stage 3 of the transit ride runs
- **THEN** `r16a_north` lifts via `transit:blast_gate`, Train Car B glides ~`15 m` south through the north portal into `R16a` carrying Jay smoothly to the `R16a` west platform, opens its west boarding door, and seals `r16a_north` once clear
- **AND** Jay can immediately walk west out of Train Car B onto the `R16a` platform and south up the stairs into `R16b`

### Requirement: The cabin is visible end to end, lit by the car's own lights
Each train car SHALL carry its own cabin lighting (claimed light slots that move with the car, lit by a cold teal-white wash) so that the whole cabin can be seen from either end in every ride stage, including inside the tunnel where there are no room lights.

#### Scenario: Looking down the cabin from either end
- **WHEN** Jay stands at one end of the cabin and looks toward the other end, in `R15a`, Stage 1, Stage 2, Stage 3 and `R16a`
- **THEN** the far bulkhead, benches and floor are readable and not pitch black, and the cabin still reads as dim and cold, not fully lit

#### Scenario: Cabin lights ride with the car
- **WHEN** a car is moved by `Level.setPropTransform`
- **THEN** its cabin glow, light shaft and pooled light move with it, and no fixture or dead fixture is left behind where the car stood

### Requirement: The Stage 2 hallway is at the car for the whole ride
Stage 2 SHALL place its hallway segments around the car (in world coordinates, relative to the rig), so the lit hallway is visible ahead, behind and beside the car for the whole stage.

#### Scenario: Hallway ahead throughout Stage 2
- **WHEN** Jay looks out of the windshield at any time during Stage 2
- **THEN** he sees lit hallway segments receding ahead of the car and fading into black, never open water or a seabed

### Requirement: The R16a gate lifts after the cut, clear of the car
At the Stage 2 to Stage 3 hand-off, R16a's blast gate SHALL be closed exactly where the rig's gate stopped, and SHALL lift (animated, fast) once R16a is rendered, fully open before the car's nose or a player standing at the front of the cabin reaches it, without touching the car roof or pushing the player back.

#### Scenario: Gate lifts as the glide begins
- **WHEN** the hand-off to R16a has happened
- **THEN** the closed gate is where the rig's gate was, begins to lift within 0.1 s, is fully open within about 1 s, and the car passes through without clipping the shutter or the player being pushed back

### Requirement: Moving blast-gate parts keep their place in sunken rooms
The blast-gate shutter and its lamps SHALL be positioned relative to the gate, so a sealed shutter meets the floor in `R16a` (floor -0.6) as it does in `R15a`, and an open one clears the bore.

#### Scenario: Sealed shutter in R16a
- **WHEN** `r16a_north` is sealed
- **THEN** the shutter reaches the `R16a` floor with no gap beneath it

### Requirement: Train headlights read as real lamps and never cut the world
Each train car SHALL show twin headlights as recessed lenses with a soft glow, a short gradient beam that fades with length and toward its edges, and a light pool on the track ahead, without adding or removing scene lights and without the beam passing through walls, the blast-gate shutter or the hallway structure.

#### Scenario: Headlights while the car moves
- **WHEN** the car is moving through a blast gate, the shroud or the hallway
- **THEN** the headlights show a soft fading beam and a lit pool on the rails and ties ahead, and the rails glint under them
- **AND** the beam does not visibly intersect any wall, gate shutter or rib

#### Scenario: Headlights at rest
- **WHEN** a car is parked or docked
- **THEN** it shows lens glow only (parking lamps) with no beam, and the beam ramps in only after the gate has opened and the car moves

#### Scenario: Light count stays fixed
- **WHEN** any ride room becomes visible or hidden
- **THEN** the number of scene lights is unchanged, so no shader recompile is triggered by the train

### Requirement: Debug preview access for the 3-stage abyssal train ride
The debug launcher SHALL support jumping directly to the departure train and triggering the 3-stage hybrid abyssal ride in the browser without playing earlier station rooms.

#### Scenario: Launching the 3-stage ride from debug mode
- **WHEN** the game launches with `?debug&jump=r15a` (or `?debug&jump=transit_ride`) and the transit ride preview is triggered
- **THEN** Jay is placed inside Train Car A in `R15a` and the full 3-stage ride (pull-out -> scrolling lit hallway -> `R16a` glide-in) plays cleanly from start to finish

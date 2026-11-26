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

### Requirement: Isolated Arrival Track Dock opening across a platform from the train's right side
`R16a` ("Arrival Track Dock") SHALL sit at isolated grid coordinates culled from the main station. It SHALL be a `12 m x 12 m` (`3x3` cells) dock (`5.0 m` ceiling, sunken `floorY: -0.6`) whose track runs north to south along its east edge, with a matching walkable greybox Train Car shell stopping beside a `4 m` platform on the track's west side. Its whole west edge SHALL be open (`12 m`) onto full-width stairs climbing `+0.6 m` west onto `R16b`, so a person at the car's right-side windows or doorway looks across the platform into the concourse. Its north wall holds the entry blast gate and its south wall an open tunnel bore over the track.

#### Scenario: Exiting the arrival train and turning left
- **WHEN** the car's right-side door has been opened by script and Jay steps west out of the doorway onto the platform
- **THEN** he stands on real floor beside the car, with wide stairs climbing `+0.6 m` west onto the `R16b` Arrival Concourse straight ahead and no wall within `4 m` of the car's right side

#### Scenario: Looking at the arrival train from the concourse
- **WHEN** Jay stands in `R16b` between the first pillar pair, on the dock's centre line, looking east
- **THEN** he sees the whole right side of the train across the platform, the entry gate in the dock's north wall on his left and the dark tunnel bore in its south wall on his right

#### Scenario: Arrival Terminal is culled from the departure wing
- **WHEN** the camera stands anywhere in `R11`, `R13d`, or `R15a`
- **THEN** `R16a`, `R16b`, and `R16c` are not drawn

### Requirement: Grand Arrival Concourse and Dispatch Room shell
`R16b` ("Arrival Concourse") SHALL join the west edge of `R16a` via an open `12 m` seam at deck level (`y = 0`) and span `24 m x 20 m` (`6x5` cells, long axis east to west) with an `8.0 m` ceiling height. It SHALL frame an unobstructed central path along the dock's centre line with symmetrical pillar rows (at least three pairs, the nearest pair either side of that line) on the way to flanking check-in booth bays on both sides, with a doorway on its south side into `R16c` ("Arrival Dispatch"), which hangs off that side.

#### Scenario: Cresting the stairs into the Arrival Concourse
- **WHEN** Jay climbs the stairs from `R16a` into `R16b`
- **THEN** he stands at deck level (`y = 0`) under an `8.0 m` ceiling looking west down a clear central aisle framed by symmetrical full-height pillar rows (wide enough to conceal a large figure behind a pillar), with check-in booth bays along the north and south sides and the `R16c` dispatch entrance in the south wall

#### Scenario: Walking the entire arrival terminal
- **WHEN** a body walks from inside the `R16a` train car, out onto the platform, up the west stairs into `R16b`, along the central path past the pillars and check-in booths, and through the south doorway into `R16c`
- **THEN** it completes the walk on real colliders without stalling or falling through seams

### Requirement: Modular grid compliance and debug jump access
All new and modified rooms in the transit wing SHALL conform to the `4.0 m` modular grid standard with no coplanar z-fighting, no floor/wall seam gaps, valid sunken-floor anchor placement, and no cell that is the floor of two rooms. The debug launcher SHALL support `?debug&jump=r11`, `?debug&jump=r15a`, `?debug&jump=r16` and `?debug&jump=r16b` so each stage of the transit wing can be inspected directly in the browser.

#### Scenario: Jumping directly to the Departure Bay and Arrival Terminal
- **WHEN** the game launches with `?debug&jump=r15a` or `?debug&jump=r16`
- **THEN** Jay spawns standing on walkable floor inside `R15a` (facing the docked train) or on the `R16a` platform beside the parked car (facing west toward the stairs and the concourse) with clear sightlines and no black screen

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
Train Car A (`R15a`) and Train Car B (`R16a`) SHALL feature a finished clean transit cabin interior using the `transit` palette with no rusty or dirty textures, including bench seating, overhead grab rails, interior cabin lighting, status strips, wide end windshields, an animated right-side boarding door, a comms/radio terminal centred on the solid rear bulkhead (for incoming radio communication to Heins), and an interior transit infographic / info sign mounted on the solid windowless door-pocket wall at the north-west end of Train Car B.

#### Scenario: Inspecting the boarded train cabin interior
- **WHEN** Jay boards Train Car A in `R15a` or stands inside Train Car B in `R16a`
- **THEN** he sees clean slate/steel cabin walls, non-slip metal flooring, commuter bench seating, overhead grab rails, lit cabin status strips, and clear side and end windows with no rusty or dirty textures, a comms/radio terminal centred on the solid rear bulkhead, and a transit infographic / info sign on the windowless door-pocket wall that does not overlap the doorway, door-leaf travel, or any window glass

#### Scenario: Boarding door seals for departure and opens on arrival
- **WHEN** the departure ride begins, and later Train Car B comes to rest at the `R16a` platform
- **THEN** the boarding door leaf of Train Car A slides closed and engages its doorway collider for departure
- **AND** Train Car B's door stays closed, with its doorway collider engaged, until a scripted `transit:train_door` open event is emitted for it, and then slides open with the collider cleared

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

### Requirement: Uniform train car dimensions across all ride stages
Train Car A (`r15a_train`), the Stage 2 tunnel car (`r15b_train`), and Train Car B (`r16a_train`) SHALL all share identical interior and exterior shell dimensions (`length: 9`, `width: 3`, `height: 2.9`) so the cabin walls, windshield, benches, roof ribs, hanging straps, and cabin lights never shift relative to the player during Stage 1 -> Stage 2 or Stage 2 -> Stage 3 handoffs.

#### Scenario: Standing in the cabin across both stage handoffs
- **WHEN** Jay stands anywhere inside the cabin (such as the center aisle) through the Stage 1 -> Stage 2 handoff and the Stage 2 -> Stage 3 handoff
- **THEN** his distance to the front windshield, rear bulkhead, roof ribs, and hanging straps remains unchanged across each handoff, with no visible cabin jump or repositioning

### Requirement: Stage 2 infinite scrolling lit hallway, slowing early into a closed gate
After Stage 1 pull-out, the ride SHALL hand off seamlessly into an isolated, infinite-scrolling lit hallway that matches the shrouds, fades to black at its open ends, starts scrolling at Stage 1's pull-out exit speed, accelerates smoothly to cruise speed, and then slows smoothly near its end while a closed blast gate arrives where R16a's closed gate will be.

#### Scenario: Riding through the hallway
- **WHEN** Stage 2 of the transit ride is active
- **THEN** Jay remains inside the clean train cabin while lit rib bars, guide strips and wall-panel seams scroll past outside the cabin windows, and the hallway ahead fades to black with no visible hard edge

#### Scenario: Smooth acceleration from Stage 1 pull-out into tunnel cruise
- **WHEN** Stage 1 pull-out hands off to Stage 2
- **THEN** the hallway scroll begins at Stage 1's exit speed (`2 * 14 / 3.8 ≈ 7.37 m/s`) rather than jumping instantaneously to cruise speed, and ramps smoothly up to cruise speed (`20 m/s`) over the opening acceleration window

#### Scenario: One continuous hallway
- **WHEN** Jay rides from the R15a pull-out through Stage 2 and into the R16a glide-in
- **THEN** the same lit hallway is visible throughout, with no open water, ocean floor or windows to the outside

#### Scenario: Slowing early into a visible gate
- **WHEN** Stage 2 nears its end
- **THEN** after cruise, the hallway scroll slows smoothly (never speeding up again) to the Stage 3 start speed (`5.0 m/s`), and a bright closed blast gate with lit signals emerges from the fog and arrives deterministically at `10.125 m` ahead of the car at the exact moment of the Stage 2 -> Stage 3 handoff

#### Scenario: Nothing crosses the car or the bore
- **WHEN** a car passes through an open blast gate or stands in its cabin
- **THEN** no static gate geometry, room wall or ceiling light shaft is inside the car body or its path

### Requirement: Stage 3 seamless handoff to Train Car B gliding into R16a
At the end of Stage 2, the ride SHALL hand off seamlessly to Train Car B, which glides ~`15 m` south at a start speed of `5 m/s` through the `r16a_north` blast gate (which lifts after the hand-off) into `R16a`, decelerating to rest at the `R16a` platform with its right side toward the concourse, keeping its boarding door closed, and sealing `r16a_north` behind it. The ride's axis, speeds and timings SHALL NOT change from the previous layout.

#### Scenario: Train Car B glides into R16a and opens for disembarkation
- **WHEN** Stage 3 of the transit ride runs
- **THEN** `r16a_north` lifts via `transit:blast_gate`, Train Car B glides ~`15 m` south through the north portal along the east edge of `R16a`, carrying Jay smoothly, and stops beside the platform with the concourse on its right
- **AND** `r16a_north` seals once the car is clear, and the boarding door stays closed until a scripted open event lets Jay walk out onto the platform

#### Scenario: Ride timings are unchanged
- **WHEN** the 3-stage ride runs in the new layout
- **THEN** the pull-out distance, the Stage 2 slow-down, the `5 m/s` glide start speed, the gate arrival distance and the glide duration match the previous layout, and the car never turns

### Requirement: The cabin is visible end to end, lit by the car's own lights
Each train car SHALL carry its own cabin lighting (claimed shadow-casting light slots that move with the car, lit by a dim warm tungsten wash) so that the whole cabin can be seen from either end in every ride stage, including inside the tunnel where there are no room lights, while casting dynamic shadows across the benches, grab rails, floor, and occupants.

#### Scenario: Looking down the cabin from either end
- **WHEN** Jay stands at one end of the cabin and looks toward the other end, in `R15a`, Stage 1, Stage 2, Stage 3 and `R16a`
- **THEN** the far bulkhead, benches and floor are readable and not pitch black, and the cabin reads as dark, warm, and dynamically shadowed rather than flatly lit

#### Scenario: Cabin lights ride with the car
- **WHEN** a car is moved by `Level.setPropTransform`
- **THEN** its cabin glow, light shaft and pooled light move with it, and no fixture or dead fixture is left behind where the car stood

### Requirement: The Stage 2 hallway is at the car for the whole ride
Stage 2 SHALL place its hallway segments around the car (in world coordinates, relative to the rig), so the lit hallway is visible ahead, behind and beside the car for the whole stage.

#### Scenario: Hallway ahead throughout Stage 2
- **WHEN** Jay looks out of the windshield at any time during Stage 2
- **THEN** he sees lit hallway segments receding ahead of the car and fading into black, never open water or a seabed

### Requirement: The R16a gate lifts after the cut, clear of the car
At the Stage 2 to Stage 3 hand-off, R16a's blast gate SHALL be closed at the exact distance (`10.125 m` ahead of the car center) where the rig's gate arrived with zero frame-timing drift, and SHALL lift (animated, fast) once R16a is rendered, fully open before the car's nose or a player standing at the front of the cabin reaches it, without touching the car roof or pushing the player back.

#### Scenario: Gate lifts as the glide begins
- **WHEN** the hand-off to R16a has happened
- **THEN** the closed gate sits at the exact position where the rig's gate arrived (no shutter snap), begins to lift within 0.1 s, is fully open within about 1 s, and the car passes through without clipping the shutter or the player being pushed back

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

### Requirement: Platform-edge guard and a through-track into a dark bore
`R16a` SHALL fence the track side of its platform with a continuous guard rail broken only by a boarding gap aligned to the car's doorway, reaching both the north and south walls, so the player cannot walk onto the track at the car's tail or nose. The track SHALL run through the dock and out of its south wall into an open tunnel bore that is unlit and fades to black within a few metres.

#### Scenario: Guard keeps the player off the track
- **WHEN** a player walks along the `R16a` platform or the stairs past the car's nose or tail
- **THEN** the guard rail blocks every route onto the track bed and into the bore, while the boarding gap in front of the car's doorway remains at least `2.2 m` wide

#### Scenario: Dark bore beyond the car
- **WHEN** Jay looks south along the track past the parked car, for example through its windshield
- **THEN** the rails run on into an open, unlit tunnel bore with no lit strips or guide bars, which fades to solid black within a few metres, and nothing in it can be walked into from the dock

### Requirement: Arrival Concourse clean grand terminal finish and architectural dressing
`R16b` ("Arrival Concourse") SHALL use a clean `cleanSlate` architectural wall and pillar finish matching `R15a` (with no raw weathered concrete on walls, `concourse_pillar` shafts, or `concourse_truss` webs). It SHALL be dressed as a grand deep-sea transit terminal hall with overhead `concourse_truss` ceiling beams spanning the `8.0 m` volume, a focal west-wall `concourse_monument_sign` (`THALASSA TRANSIT TERMINAL // ARRIVAL CONCOURSE`) directly down the central sightline from `R16a`, labeled `checkin_booth` enclosures with interior teller workstations, wayfinding `transit_sign` plaques, perimeter `concourse_bench` seating, `stanchion_barrier` check-in queue runs, and uncollided `luggage_cluster` storytelling props. Placed props SHALL keep the central east-west aisle (`z = 36`) and the south path to `D_R16b_R16c` unobstructed. `R16c` ("Arrival Dispatch") SHALL remain an undressed shell behind its visible doorway because the slice ends at `R16a` looking into `R16b`.

#### Scenario: Viewing the Arrival Concourse from R16a
- **WHEN** Jay looks west from Train Car B or the `R16a` platform across the stairs into `R16b`
- **THEN** he sees clean `cleanSlate` walls and full-height fluted pillars framed by overhead structural ceiling trusses, the focal `THALASSA TRANSIT TERMINAL` monument sign on the far west wall, illuminated check-in booths with queue stanchions, waiting benches, and abandoned passenger luggage along the margins

#### Scenario: Walking the Arrival Concourse central aisle
- **WHEN** a player capsule walks west from the east stair landing (`x = 76, z = 36`) down the central aisle toward the west focal wall
- **THEN** it completes the walk smoothly past the pillar colonnade and check-in bays without colliding with benches, stanchions, or luggage

### Requirement: Arrival Concourse massacre blood dressing and flickering overhead lighting
`R16b` SHALL layer dense, glossy photographic blood decals (`blood_decal`, including multi-quad clusters sharing cached materials from `public/assets/textures/blood/` across all five families: `pool`, `spatter`, `smear`, `leak`, and `drop`) heavily over its clean floor, all four faces of all six `concourse_pillar`s from floor to ceiling, the west focal wall, north and south perimeter walls, east corner walls, stair seam header, and check-in booth fronts, with zero blocking colliders and staggered depth offsets to prevent z-fighting. `R16b` SHALL omit rotating red emergency beacons and instead light the hall with flickering and failing overhead main lights (`flicker` / `failing`, with up to two hero `shadow: true` casters) while preserving named-light blackout support (`tintRoomLights('R16b', 'black')`).

#### Scenario: Dense blood coverage across the clean concourse
- **WHEN** `R16b` is loaded in `slice01`
- **THEN** all five photographic blood texture families (`pool_*`, `spatter_*`, `smear_*`, `leak_*`, `drop_*`) are heavily plastered across the floor, walls, pillars, and booth fronts with no blocking colliders and merged by shared material

#### Scenario: Flickering overhead lighting without rotating red beacons
- **WHEN** `R16b` loads under default lighting
- **THEN** its six overhead main lights run `flicker` and `failing` patterns (with hero shadow casters casting pillar shadows across the blood-soaked floor), and no `transit_rotating_beacon` props or red beacon lights are present in `R16b`

### Requirement: Arrival Track Dock clean industrial finish, signage, and platform dressing
`R16a` ("Arrival Track Dock") SHALL preserve the clean `transit` area palette on its base walls, floor, and ceiling while adding overhead gantry framing and hung service pipe runs, an illuminated arrival status board, `R16A` room signage, directional concourse wayfinding (`ARRIVAL CONCOURSE`), track-side conduit/rail signals, and purposeful platform prop clusters (seating, luggage/cargo, utility cabinets) tucked along the north and south platform margins. Placed architecture and props SHALL preserve the full `12 m` open west stair seam and keep an unobstructed central exit path (`>= 1.2 m` clear width) from the train boarding gap (`z = 35`) across the platform and up the west stairs into `R16b`.

#### Scenario: Viewing the dressed Arrival Track Dock from the train doorway
- **WHEN** Jay steps west out of Train Car B onto the `R16a` platform under full lighting
- **THEN** he sees clean industrial transit walls and flooring, overhead gantry ribs and service pipes across the `5.0 m` volume, an illuminated arrival status board, `R16A` and concourse wayfinding signage, and platform prop clusters flanking the north and south margins with a clear path straight ahead to the west stairs

#### Scenario: Walking from the train doorway to the concourse stairs
- **WHEN** a player or squad capsule walks from inside Train Car B out through the boarding gap and up the west stairs into `R16b`
- **THEN** it completes the walk on real colliders with at least `1.2 m` clear width and no snagging on gantry legs, signage, or platform props

### Requirement: Ocean window and exterior floodlights behind the arrival train
`R16a`'s east wall behind the track (`x = 22`, facing west into the dock) SHALL feature real `wall_window` ocean glazing with exterior floodlights pointing out into the dark abyss (matching `R01` and `R15a`), so a player standing on the platform or inside the concourse looking east sees the docked train silhouetted against the lit abyssal exterior.

#### Scenario: Looking east behind Train Car B into the dark ocean
- **WHEN** Jay stands on the `R16a` platform or in `R16b` looking east past Train Car B
- **THEN** real ocean windows span the east wall behind the track with exterior floodlight beams illuminating the dark abyss outside, without introducing any seam gap or exposing other station rooms

### Requirement: Blood-drenched horror surface dressing and rigged fallen crew bodies
While keeping base wall and floor textures clean, `R16a` (platform floor, west stairs, north/south walls, and track-edge area) and the adjacent `R16b` concourse threshold SHALL be heavily splattered with glossy dark-crimson photographic blood decals (floor pools, spatter, smears, and vertical wall/pillar leaks). Varied high-fidelity fallen crew bodies (using the shared 21-joint `Humanoid` rig and cached `BodyModelLibrary` crew models across multiple dead poses in `poses.json`, with dark-crimson blood textures composited onto their body materials) SHALL lie grounded flush on the floor without floating, clipping, or blocking movement. A hero fallen body (`r16_pillar_body`) SHALL lie beside one of the nearest `R16b` concourse pillars in clear view from Train Car B and SHALL be script-movable so a subsequent arrival beat can pull it behind the pillar.

#### Scenario: Viewing the blood scene and rigged fallen bodies from the dock
- **WHEN** `R16a` and `R16b` are illuminated (under full lighting or a scripted flash)
- **THEN** dense dark-crimson blood pools, spatter, smears, and wall/pillar leaks are visible across `R16a` and `R16b`, and varied bloodied crew corpses lie naturally grounded on the floor in distinct dead poses with `r16_pillar_body` visible beside a facing `R16b` pillar

#### Scenario: Pulling the pillar body behind the pillar via script
- **WHEN** a scripted sequence drags or repositions `r16_pillar_body` behind the nearest `R16b` pillar
- **THEN** `r16_pillar_body` moves smoothly behind the pillar in its dead pose with no floating, no AI/idle-life movement, and without blocking the central concourse aisle

### Requirement: Arrival Track Dock full lighting, blackout/flash readiness, and rotating red dock beacons
`R16a` SHALL provide full clean overhead illumination (with named light IDs, at least one shadow-casting hero light over the platform/boarding area, and warm/cool contrast against the unlit south dark bore) while supporting instant pitch-black blackout (`tintRoomLights('R16a', 'black')` / `setRoomLights('R16a', 'off')`) and per-light flash switching (`setLight`). Rotating red emergency beacons (`transit_rotating_beacon`) SHALL be mounted on the flanking `R16a` dock walls (while `R16b` uses flickering/failing overhead main lights with no rotating red beacons), emitting rotating red volumetric beams and pulsing emergency light when enabled via `transit:r16_beacons` (falling back to a steady red lens when `reducedFlashing` is enabled) and resetting to off on level reset. Debug preview (`?debug&jump=r16`) SHALL support inspecting normal full lighting as well as blackout and rotating red beacon modes.

#### Scenario: Full clean lighting on default inspection
- **WHEN** `R16a` is inspected under default lighting (`?debug&jump=r16`)
- **THEN** its named overhead lights illuminate the dock cleanly with shadow depth over the platform, while the south tunnel bore remains unlit and fades to black

#### Scenario: Pitch-black arrival, selective light flash, and rotating red dock beacons
- **WHEN** a script or debug preview blacks out `R16a`/`R16b`, flashes a subset of named lights, and emits `transit:r16_beacons` `{ on: true }`
- **THEN** the dock and concourse drop to pitch black on blackout, individual named lights flash cleanly on demand, and the red beacons on the flanking `R16a` dock walls spin their volumetric beams (or hold a steady red lens when `reducedFlashing` is active), resetting to off on level reset

### Requirement: R11 Power Bay cautious entry and Giles's casual diagnosis
When the squad enters `R11` after completing the `R10` valve sequence, `R11` SHALL play a non-combat narrative beat instead of the legacy wave-defense climax or Giles infection cliffhanger. Jay and Okafor SHALL whisper cautiously on entry, unsure what the dark bay is; Giles SHALL calmly walk past them to the west-wall terminal (`r11_giles_task`), casually noting it is just the power bay, diagnose the tripped transit sub-grid, and voice his realization before starting the generators.

#### Scenario: Entering the dark Power Bay from R10
- **WHEN** Jay walks north through `D_R10_R11` into `R11` with `valve_done` set
- **THEN** Okafor and Jay whisper cautiously about the unfamiliar dark room while no enemies spawn
- **AND** Giles calmly walks past them to `r11_giles_task`, casually telling them it is just the power room, inspects the terminal, and calls out his diagnosis before beginning the power-up phases

#### Scenario: No Giles infection escalation or cliffhanger in R11
- **WHEN** the `R11` Power Bay sequence runs or restores from checkpoint
- **THEN** `giles.infectionStage` remains `0`, `giles.bandaged` remains `false`, `reveal:trail` is never emitted, and Giles does not confess an injury or transform

### Requirement: Phased generator startup rumble and progression to R13d
During the `R11` power-up cascade, each of the three spatial startup phases SHALL play a distinct, generated low-rumbling generator phase-startup SFX synchronized with its overhead light bank energization (`r11_bank_1a`/`1b`, `r11_bank_2a`/`2b`, `r11_bank_3a`/`3b`). Once the final phase stabilizes and `r11_powered` is set, `D_R13d_R11` SHALL open, a checkpoint SHALL save, and the active objective SHALL guide the player east through `R13d` toward the `R15a` Departure Boarding Bay.

#### Scenario: Three-phase generator rumble synchronized with light banks
- **WHEN** Giles triggers the `R11` power-up cascade from the west-wall terminal
- **THEN** phases 1, 2, and 3 each play their dedicated low-rumbling generator startup SFX alongside the west-to-east overhead light banks energizing and turbine rotors spinning up

#### Scenario: Proceeding from energized Power Bay into Maintenance Corridor
- **WHEN** the final `R11` power-up phase completes
- **THEN** `r11_powered` is set, `D_R13d_R11` is open (never sealed behind the squad), a checkpoint saves, and the objective directs Jay through `R13d` to `R15a` Departure Boarding Bay

### Requirement: R11-to-R15a walk-and-talk banter with free player roam
Once `R11` finishes energizing and `D_R13d_R11` opens, Giles and Okafor SHALL walk ahead out of `R11`, east through `R13d` Maintenance Corridor, and through `D_R13d_R15a` into `R15a` while Jay retains full free-roam control. Along the walk they SHALL exchange banter with Jay about the plan after boarding (heading to `R16` for the deep-lift/evacuation shuttles, tunnel safety, and checking weapons before arrival).

#### Scenario: Squad leads from R11 through R13d to R15a while Jay roams freely
- **WHEN** `r11_power_bay` completes and opens `D_R13d_R11`
- **THEN** Giles and Okafor walk north through `D_R13d_R11`, east through `R13d`, and through `D_R13d_R15a` into `R15a`, delivering their walk-and-talk plan banter while Jay can freely follow, explore, or run ahead without movement locks

### Requirement: R15a Departure Boarding Bay narrative entry and squad boarding
When Jay enters `R15a` after restoring power in `R11`, the boarding sequence SHALL trigger while keeping player movement free. Giles and Okafor SHALL comment on the powered departure car and walk across the `R15a` platform through the boarding gap into Train Car A, taking cabin positions while waiting for Jay to step aboard.

#### Scenario: Entering R15a from the Maintenance Corridor
- **WHEN** Jay steps east through `D_R13d_R15a` into `R15a` with `r11_powered` set
- **THEN** `trigger:r15a_enter` fires, Giles and Okafor speak their boarding lines and walk into Train Car A across the boarding gap, and player movement remains unlocked

#### Scenario: Boarding Train Car A launches the 3-stage transit ride
- **WHEN** Jay walks inside Train Car A (`trigger:r15a_boarded`) with `r11_powered` set
- **THEN** `obj_transit_board` completes, `D_R13d_R15a` locks behind the squad, Train Car A seals its boarding door, `r15a_south` opens, and the 3-stage abyssal transit ride starts with Stage 2 cruise extended to fit the radio exchange

### Requirement: Rear-bulkhead comms terminal state feedback during the ride
The `train_comms_terminal` on the rear bulkhead of the transit train cars SHALL respond to `transit:comms_state` events (`idle`, `ringing`, `active`, `lost`) by updating its status indicator emissive state so the player has a clear visual cue when an incoming radio hail arrives, connects, and drops out, resetting to `idle` on `level:reset`.

#### Scenario: Comms terminal signals an incoming hail and later drops out
- **WHEN** `transit:comms_state` is emitted with `ringing`, then `active`, and finally `lost`
- **THEN** the rear-bulkhead terminal indicator shifts from pulsing amber (`ringing`) to steady green/teal (`active`) and then dim red (`lost`), returning to `idle` on `level:reset`

### Requirement: Stage 2 Heins radio exchange and synchronized transit ride audio
During Stage 2 (`sea_tunnel`) of the 3-stage transit ride, Security Chief Katie Heins (`chief`) SHALL hail Train Car A/B over the `radio` channel through the rear-bulkhead comms terminal, exchanging dialogue with Jay, Giles, and Okafor before breaking up into static as the train decelerates toward `R16a`. Distinct generated SFX SHALL accompany the boarding door sealing, blast gates opening and closing, train pull-out, tunnel cruise, comms hail, and arrival braking.

#### Scenario: Heins radio exchange plays during Stage 2 cruise
- **WHEN** the 3-stage transit ride enters Stage 2 (`sea_tunnel`)
- **THEN** the rear-bulkhead comms terminal chimes and activates, Heins speaks over the filtered `radio` channel warning that `R16` went dark after evacuation teams headed down, Jay/Giles/Okafor respond locally inside the cabin, and her transmission breaks into static as the car begins decelerating toward the closed `R16a` gate

#### Scenario: Transit ride audio plays across all three stages
- **WHEN** the 3-stage transit ride runs from departure pull-out through tunnel cruise to `R16a` stop
- **THEN** generated SFX play for the boarding door close, `r15a_south` and `r16a_north` blast gates, train pull-out, Stage 2 tunnel cruise bed, comms ring/static, and Stage 3 braking stop

### Requirement: R16a arrival handoff and checkpoint
When Train Car B comes to rest at the `R16a` platform at the end of Stage 3, `r16a_north` SHALL seal behind the car, Train Car B's boarding door SHALL remain closed, `transit_ride_done` SHALL be set, a checkpoint (`cp_r16_arrived`) SHALL save, and `transit:arrived_r16` SHALL be emitted for the arrival finale sequence to take over.

#### Scenario: Train Car B stops at R16a and hands off to the arrival finale
- **WHEN** `TransitRideController` transitions to `arrived` at the end of Stage 3
- **THEN** `r16a_north` seals, Train Car B's boarding door stays closed, `transit_ride_done` is set to `true`, checkpoint `cp_r16_arrived` saves, and `transit:arrived_r16` is emitted

### Requirement: Squadmates hold their cabin positions during the ride
From the moment the transit ride starts until Train Car B comes to rest at `R16a`, each squadmate (Giles, Okafor) SHALL stay where the ride placed them inside the cabin. They SHALL NOT follow Jay, dodge his aim cone, give way, path, or be relocated by `squadRegroup`, `squadCatchUpIn`, `gatherIn` timeouts, load placement, or far-and-unseen catch-up, and a sequence ending SHALL NOT hand them back to the follow AI mid-ride. Only contact with Jay's body MAY move them (a soft shove out of his capsule through level collision); they SHALL NOT walk back to their spot afterwards. The ride lock is separate from the cutscene `scripted` hold, so releasing a cutscene never clears it, and it is cleared when the ride ends or resets.

#### Scenario: Standing in the cabin through every stage
- **WHEN** Jay stands or walks anywhere in the cabin from pull-out through the tunnel cruise to the `R16a` stop, without touching either squadmate
- **THEN** Giles and Okafor do not move, step aside, or leave the car, and no scene step, cutscene release or catch-up places them elsewhere

#### Scenario: Walking into a squadmate
- **WHEN** Jay walks into Giles or Okafor during the ride
- **THEN** that squadmate is nudged out of Jay's way and stays at the new spot, and the squad AI resumes only after the car comes to rest at `R16a`

### Requirement: Tunnel power-loss emergency shift and onboard PA routing
When `r15a_heins_04` cuts off during Stage 2, traction power SHALL drop: `trainPowerDown` plays, Stage 2 hallway strips, `R16a` north shroud (`transit:tunnel_power`), and dynamic passing lights (`r15b_tunnel_pass_0..3`) shift to emergency red while cabin lights stay steady. Onboard Transit PA announcements (`r16_pa_01`, `r16_pa_02`) SHALL be heard overhead at a steady level from first word to last, and `r16_pa_01` SHALL finish before the Stage 3 hand-off.

#### Scenario: Traction power drops on Heins's radio cutoff
- **WHEN** `r15a_heins_04` ends in static during Stage 2 of `r15a_train_ride`
- **THEN** `trainPowerDown` plays, hallway strips, shroud strips, and dynamic passing lights shift to emergency red, cabin lights stay steady, and `r16_pa_01` plays overhead inside the cabin before deceleration

#### Scenario: The whole announcement is heard
- **WHEN** the ride plays with the shipped voice clips
- **THEN** `r16_pa_01` ends at least `2 s` before Train Car B appears in `R16a`

#### Scenario: Moved by a stage handoff
- **WHEN** the ride moves Jay to another stage while an onboard announcement is playing
- **THEN** the announcement stays overhead at the same loudness

#### Scenario: Tunnel lighting resets cleanly
- **WHEN** the level resets (`level:reset`)
- **THEN** the Stage 2 hallway and `R16a` north shroud return to their default lit state

### Requirement: Pitch-black arrival cutscene and Train Car B downward auxiliary lights
From the ride's departure through the end of the finale, `R16a` and `R16b` SHALL be pitch black (`lightState` `off` + `tint: 'black'`) except during scripted flickers, leaving Train Car B's cabin lights as the sole interior light on arrival. The boarding door SHALL stay closed until Jay locks into cutscene mode, walks to the center opening, and looks down as two downward auxiliary lights (`r16a_train_aux_n/s`, no raw `THREE.Light`s in the shell) reveal platform blood pools.

#### Scenario: Pitch-black dock arrival and auxiliary blood reveal
- **WHEN** Train Car B docks in `R16a` and `r16_arrival_finale` begins
- **THEN** `R16a` and `R16b` are pitch black with the boarding door closed until cutscene lock, Jay walks to the center opening looking down, and `r16_pa_02` engages the two downward auxiliary lights to expose blood on the platform without recompiling shaders

#### Scenario: Never lit on the way in
- **WHEN** Train Car B glides into `R16a`
- **THEN** the room's overhead lights are already off and are never seen switching off

### Requirement: Massacre flicker reveal, horror audio pacing, and cabin banter
On platform blood discovery, a smooth-onset low-bass horror hit (`r16HorrorHit`, 80 ms fade-in) SHALL play, followed by quiet `r16Build` rising under `r16_jay_01` and a `3.8 s` pan up. At eye level, full `r16HorrorHit` and 3x overhead flickers (`reducedFlashing` safe) SHALL reveal `R16b` as Jay backs up to `r16_train_back`, with no body drag (`r16_pillar_body` stays put). Speaker-tracked cabin banter SHALL fade to black with `r16Cut` as `r16_giles_02` ends, leaving surveillance score-free.

#### Scenario: Blood discovery, slow pan up, and flicker reveal
- **WHEN** the downward auxiliary lights expose blood on the `R16a` platform floor
- **THEN** `r16HorrorHit` hits smoothly, `r16Build` fades in quietly under `r16_jay_01` and the `3.8 s` pan up, and the 3x overhead flicker reveals the `R16b` massacre as Jay backs up without dragging `r16_pillar_body`

#### Scenario: Speaker-tracked cabin banter and cut to black
- **WHEN** the flicker drops back to pitch black and cabin dialogue begins
- **THEN** Jay's view tracks each speaker (`r16_giles_01` trimmed to a ~`0.35 s` internal pause; Giles lines generated individually), and the view fades to black with `r16Cut` as `r16_giles_02` ends so weapon-draw transitions stay hidden

### Requirement: CAM 09 armed squad advance and northwest-pillar gunfire
After the blackout, fullscreen `CAM 09  ARRIVAL DOCK` SHALL show Giles and Okafor walking up the stairs into `R16b` at `1.15 m/s` holding `aim_pistol` with forward weapon spotlights (no rear cone) while all surveillance dialogue uses the `radio` filter. Both squadmates SHALL stay aimed west down the concourse until `0.25 s` into `r16_okafor_03` (*"to the right!"*), then snap right to aim and fire boosted muzzle-flash bursts at the northwest-most pillar (`[63.5, 1.8, 31.2]`).

#### Scenario: Armed advance with weapon flashlights on CAM 09
- **WHEN** `CAM 09  ARRIVAL DOCK` activates and Okafor calls `"Flashlights on."`
- **THEN** Jay's flashlight is off and viewmodel is hidden, Giles and Okafor walk up the stairs holding `aim_pistol` with forward weapon spotlights (no rear cone), and all callouts play through the `radio` filter

#### Scenario: Delayed snap-right and gunfire at northwest-most pillar
- **WHEN** `ductScrape` plays and Okafor yells `r16_okafor_03`
- **THEN** both squadmates stay aimed down the concourse until `0.25 s` into `r16_okafor_03`, then turn right onto the northwest-most pillar (`[63.5, 1.8, 31.2]`) and open fire with boosted CCTV-readable muzzle flashes

### Requirement: CAM 10 high-aimed Juggernaut face reveal and hard blackout to cliffhanger
After gunfire begins, fullscreen `CAM 10  CONCOURSE` (`[71.2, 2.0, 28.8]` -> `[70.0, 1.5, 38.6]`) SHALL cut in with both squadmates immediately aiming high (`r16_monster_face_aim` at `Y = 5.4`, then `juggernautHead` `+ 0.8 m`, where `juggernautHead` is the creature's aim point riding its head) so only the creature's face is lit. The `5.1 m` skinned `monster_juggernaut.glb` SHALL walk on its creature gait from `[64.8, 0, 34.6]` to `[68.2, 0, 34.6]` (`yaw: 95`, clear of the foreground right pillar) over about `5.2 s`, with its eyes, teeth and tongue in place on its head, acting its walking roar as the initial CCTV roar (`r16MonsterRoar`) plays. Giles and Okafor SHALL keep firing as it walks. Once it stops, it SHALL act its long roar on camera as the sustained angry roar (`r16MonsterRoarBlackout`) plays. The squadmates SHALL keep firing, slowly (0.65 s between shots) and quietly (0.6 of the gunshot's level as it walks, 0.4 under the long roar), and SHALL back away about 1.6 m from it while it walks out, still facing it so their lights stay on its face. As it rears up, Giles (`r16_giles_05`) and then Okafor (`r16_okafor_04`) SHALL yell "What the fuck is that?!" on the radio channel, loud (line gain 1.3), before the long roar drowns them. On the roar's last beat the scene SHALL cut hard to black with dead silence (`CAM 10` off, Juggernaut and lights off, every bus hushed). About a second later, `story:cliffhanger` SHALL fade in the `THALASSA` credit.

#### Scenario: Juggernaut face reveal on CAM 10 and cliffhanger handoff
- **WHEN** `CAM 10  CONCOURSE` cuts in during scripted gunfire
- **THEN** both squadmates keep their weapon flashlights pitched high on the creature's face as the `5.1 m` Juggernaut walks out beside the foreground right pillar without clipping, acting its roar to `r16MonsterRoar`
- **AND** the squadmates back away facing it, their lights on its face, firing slowly and quietly
- **AND** Giles and then Okafor yell "What the fuck is that?!", and it acts its long roar to `r16MonsterRoarBlackout` on camera over their quieter fire
- **AND** the scene cuts hard to black and silence, then `story:cliffhanger` -> `title_card` (`THALASSA`) -> `stinger_priya` -> `endSlice`

#### Scenario: Juggernaut face parts and framing on CAM 10
- **WHEN** the Juggernaut walks out on `CAM 10`
- **THEN** its eyes, teeth and tongue show on its head, its hands and feet stay planted between steps, and it ends its walk within 5 cm of `[68.2, 0, 34.6]`

#### Scenario: No roar in the dark
- **WHEN** the scene has cut to black after the long roar
- **THEN** no creature sound plays until the `THALASSA` card

### Requirement: Debug jump access for the R16 arrival finale
The debug launcher SHALL support `?debug&jump=r16_finale` to inspect the full `R16a`/`R16b` arrival cutscene, surveillance camera finale, and cliffhanger handoff directly in the browser without playing earlier station rooms.

#### Scenario: Launching the R16 arrival finale directly
- **WHEN** the game launches with `?debug&jump=r16_finale`
- **THEN** Jay starts inside Train Car B in pitch-black `R16a` with `r16_arrival_finale` running cleanly through the auxiliary lights, flicker reveal, `CAM 09`/`CAM 10` Juggernaut reveal, and `story:cliffhanger` handoff

### Requirement: Okafor waits with Giles at the departure console
On the walk from `R11` to `R15a`, Okafor SHALL end beside Giles at the departure console: within `2 m` of Giles, turned toward Giles and the console, and clear of the platform railing and the boarding gap. Okafor SHALL stay there until both are told to board.

#### Scenario: Hearing both of them at the console
- **WHEN** Giles is working at the `R15a` departure console and Jay stands near Giles
- **THEN** Okafor is within `2 m` of Giles and Okafor's lines are heard at a normal speaking level

#### Scenario: Boarding path stays clear
- **WHEN** Jay or either squadmate walks from the `R15a` platform into Train Car A
- **THEN** nobody waiting at the console blocks the boarding gap

### Requirement: The finale follows the arrival without a stall
Every line scripted for the Stage 3 glide SHALL play while the train is arriving, and the arrival finale SHALL begin within `2 s` of the train coming to rest. A line that runs longer than its slot in Stage 2 MUST NOT make the script miss the arrival.

#### Scenario: Normal arrival
- **WHEN** the ride plays with the shipped voice clips
- **THEN** the gate sound and Okafor's arrival line play during the glide, and the finale starts within `2 s` of the stop

#### Scenario: A late line
- **WHEN** a Stage 2 line is still playing as the glide begins
- **THEN** the finale still starts as soon as that line and the arrival lines are done, with no timeout-length silence

### Requirement: Giles answers the lost call during the announcement
When Heins's transmission cuts off, Giles SHALL say `r15a_giles_04` over `r16_pa_01`, starting just after the announcement has said the traction power is lost, and SHALL say it only once.

#### Scenario: Reacting to the cut-off
- **WHEN** `r16_pa_01` reaches the pause after "traction power has been lost"
- **THEN** Giles says they have lost her while the announcement carries on, and the line is not repeated at the arrival

### Requirement: A body is dragged away before Jay's warning
After `r16_okafor_01` and before `r16_jay_02`, Jay's view SHALL turn to the far north-west pillar of `R16b` with a magnified look, and one flicker SHALL show the fallen body lying beside that pillar, its legs already behind it, dragged slowly the rest of the way out of sight. The concourse SHALL stay lit long enough to follow the drag. The Juggernaut MUST NOT appear before `CAM 10`. No flicker setting may add a second flash.

#### Scenario: Seeing the body pulled away
- **WHEN** Okafor finishes `r16_okafor_01` inside the cabin
- **THEN** one flicker shows a body with its legs behind the north-west pillar and the rest in the open, large enough to follow
- **AND** it slides slowly until none of it is in sight
- **AND** the concourse is dark again when Jay says something just moved by the north pillar

#### Scenario: The view returns
- **WHEN** the shot turns back to the speakers in the cabin
- **THEN** the view is no longer magnified

#### Scenario: Nothing is given away
- **WHEN** the finale plays up to the `CAM 10` cut
- **THEN** the creature has not been shown, and Giles and Okafor have not aimed at the concourse because of the drag

#### Scenario: The squad advance afterwards
- **WHEN** `CAM 09` and `CAM 10` play later in the same finale
- **THEN** they are framed as before and the Juggernaut walks out from its usual hiding place

### Requirement: Restoring the Arrival Terminal checkpoint starts the finale
Loading a save made at the `Arrival Terminal` checkpoint with the finale not yet finished SHALL put Jay, Giles and Okafor in Train Car B with its door closed, `R16a` and `R16b` dark and the cabin lights on, and SHALL play the arrival finale once from its start.

#### Scenario: Continue after leaving during the finale
- **WHEN** the player leaves during the finale and chooses Continue
- **THEN** the finale starts again in the parked car with `R16` dark

#### Scenario: Finale already finished
- **WHEN** a save with the finale finished is loaded
- **THEN** the finale does not play again

### Requirement: End-to-end finale playthrough from the R11 debug jump
The URL `?level=slice01&debug&jump=r11` SHALL play from the Power Bay through the departure walk, the train ride, the arrival finale, the title card and the stinger to the end of the slice, with no other parameter needed.

#### Scenario: Playing through from the Power Bay
- **WHEN** the game is opened with `?level=slice01&debug&jump=r11` and play begins
- **THEN** each stage starts the next one in order until the slice ends

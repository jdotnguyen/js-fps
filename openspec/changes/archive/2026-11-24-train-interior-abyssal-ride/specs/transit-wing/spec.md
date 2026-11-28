# Spec Delta: transit-wing

## MODIFIED Requirements

### Requirement: Blast-gate tunnel portals at R15a south and R16a north
`R15a`'s south track end and `R16a`'s north track end SHALL each feature a recessed sea-tunnel portal housing with heavy armored blast-gate shutter leaves, hazard chevrons, and rail aspect signals. Each gate SHALL default to sealed, support opening/closing via scripted transit events (disabling its shutter collider while open so a train car can pass cleanly through the bore and re-enabling it when sealed), and reset to sealed on level reset.

#### Scenario: Sealed tunnel portals on arrival in R15a and R16a
- **WHEN** `R15a` or `R16a` loads under default level state
- **THEN** the `R15a` south track wall and `R16a` north track wall each display a sealed armored blast-gate tunnel portal with red/amber rail aspect signals instead of a plain flat wall panel
- **AND** the sealed shutter collider blocks passage through the bore

#### Scenario: Opening a blast-gate tunnel portal for train transit
- **WHEN** a scripted transit event opens the `R15a` south blast gate (or `R16a` north blast gate)
- **THEN** the armored shutter leaves retract to reveal the dark sea-tunnel bore, the shutter collider is disabled for unobstructed train passage, and the rail aspect signals shift to green/clear, returning to sealed on level reset

## ADDED Requirements

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

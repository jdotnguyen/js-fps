# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: Isolated Arrival Track Dock with left-turn stair choreography`
- TO: `### Requirement: Isolated Arrival Track Dock opening across a platform from the train's right side`

## MODIFIED Requirements

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

### Requirement: Finished clean transit train interior and animated boarding door
Train Car A (`R15a`) and Train Car B (`R16a`) SHALL feature a finished clean transit cabin interior using the `transit` palette with no rusty or dirty textures, including bench seating, overhead grab rails, interior cabin lighting, status strips, wide end windshields, an animated right-side boarding door, a comms/radio terminal centred on the solid rear bulkhead (for incoming radio communication to Heins), and an interior transit infographic / info sign mounted on the solid windowless door-pocket wall at the north-west end of Train Car B.

#### Scenario: Inspecting the boarded train cabin interior
- **WHEN** Jay boards Train Car A in `R15a` or stands inside Train Car B in `R16a`
- **THEN** he sees clean slate/steel cabin walls, non-slip metal flooring, commuter bench seating, overhead grab rails, lit cabin status strips, clear side and end windows with no rusty or dirty textures, a comms/radio terminal centred on the solid rear bulkhead, and a transit infographic / info sign on the windowless door-pocket wall that does not overlap the doorway, door-leaf travel, or any window glass

#### Scenario: Boarding door seals for departure and opens on arrival
- **WHEN** the departure ride begins, and later Train Car B comes to rest at the `R16a` platform
- **THEN** the boarding door leaf of Train Car A slides closed and engages its doorway collider for departure
- **AND** Train Car B's door stays closed, with its doorway collider engaged, until a scripted `transit:train_door` open event is emitted for it, and then slides open with the collider cleared

#### Scenario: Open door leaf stays inside its pocket
- **WHEN** the boarding door is fully open
- **THEN** the leaf is entirely contained in a solid window-less wall pocket beside the doorway and does not overlap any window glass, mullion, trim post or bench
- **AND** the closed leaf fills the doorway flush with the wall plane

### Requirement: Stage 3 seamless handoff to Train Car B gliding into R16a
At the end of Stage 2, the ride SHALL hand off seamlessly to Train Car B, which glides ~`15 m` south at a start speed of `5 m/s` through the `r16a_north` blast gate (which lifts after the hand-off) into `R16a`, decelerating to rest at the `R16a` platform with its right side toward the concourse, keeping its boarding door closed, and sealing `r16a_north` behind it. The ride's axis, speeds and timings SHALL NOT change from the previous layout.

#### Scenario: Train Car B glides into R16a and opens for disembarkation
- **WHEN** Stage 3 of the transit ride runs
- **THEN** `r16a_north` lifts via `transit:blast_gate`, Train Car B glides ~`15 m` south through the north portal along the east edge of `R16a`, carrying Jay smoothly, and stops beside the platform with the concourse on its right
- **AND** `r16a_north` seals once the car is clear, and the boarding door stays closed until a scripted open event lets Jay walk out onto the platform

#### Scenario: Ride timings are unchanged
- **WHEN** the 3-stage ride runs in the new layout
- **THEN** the pull-out distance, the Stage 2 slow-down, the `5 m/s` glide start speed, the gate arrival distance and the glide duration match the previous layout, and the car never turns

### Requirement: Modular grid compliance and debug jump access
All new and modified rooms in the transit wing SHALL conform to the `4.0 m` modular grid standard with no coplanar z-fighting, no floor/wall seam gaps, valid sunken-floor anchor placement, and no cell that is the floor of two rooms. The debug launcher SHALL support `?debug&jump=r11`, `?debug&jump=r15a`, `?debug&jump=r16` and `?debug&jump=r16b` so each stage of the transit wing can be inspected directly in the browser.

#### Scenario: Jumping directly to the Departure Bay and Arrival Terminal
- **WHEN** the game launches with `?debug&jump=r15a` or `?debug&jump=r16`
- **THEN** Jay spawns standing on walkable floor inside `R15a` (facing the docked train) or on the `R16a` platform beside the parked car (facing west toward the stairs and the concourse) with clear sightlines and no black screen

## ADDED Requirements

### Requirement: Platform-edge guard and a through-track into a dark bore
`R16a` SHALL fence the track side of its platform with a continuous guard rail broken only by a boarding gap aligned to the car's doorway, reaching both the north and south walls, so the player cannot walk onto the track at the car's tail or nose. The track SHALL run through the dock and out of its south wall into an open tunnel bore that is unlit and fades to black within a few metres.

#### Scenario: Guard keeps the player off the track
- **WHEN** a player walks along the `R16a` platform or the stairs past the car's nose or tail
- **THEN** the guard rail blocks every route onto the track bed and into the bore, while the boarding gap in front of the car's doorway remains at least `2.2 m` wide

#### Scenario: Dark bore beyond the car
- **WHEN** Jay looks south along the track past the parked car, for example through its windshield
- **THEN** the rails run on into an open, unlit tunnel bore with no lit strips or guide bars, which fades to solid black within a few metres, and nothing in it can be walked into from the dock

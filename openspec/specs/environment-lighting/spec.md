# environment-lighting Specification

## Purpose

Defines how each room's own surroundings light and reflect in it: per-room reflections on shiny surfaces, room-coloured bounce light on characters and props, and keeping both in step with the room's current lighting.

## Requirements

### Requirement: Reflections come from the room the player is in
In the station level, reflective surfaces (metal, glass, polished and wet floors) SHALL reflect a capture of the room the camera is in, showing that room's colours and bright fixtures. The station level SHALL NOT use a generic environment shared by all rooms.

#### Scenario: Steel in Hydroponics
- **WHEN** the player looks at a steel rail in the Grow Hall
- **THEN** its reflection carries the hall's own fixtures (the magenta grow bars and white tubes), not a neutral grey studio

#### Scenario: Gallery glass
- **WHEN** the player looks at the Lab B glass from the Observation Gallery
- **THEN** the glass shows faint reflections of the gallery's warm lamps

### Requirement: Reflections hand over smoothly between rooms
When the camera moves into another room, reflections SHALL cross-fade from the old room's capture to the new one over 0.3 to 0.8 s, with no frame in which reflections vanish or jump.

#### Scenario: Commons to corridor
- **WHEN** the player walks from the Commons through a doorway into the next room
- **THEN** reflections on nearby metal shift from the Commons' warm tones to the new room's over less than a second, without a flash or a blank frame

### Requirement: Captures follow the room's lighting
A room's capture SHALL show the room as currently lit. A change of station power, a scripted tint (such as the alarm red), or lights switching off or on SHALL update the reflections and bounce light of the affected rooms within 2 s. Flicker and pulse patterns SHALL NOT cause repeated captures.

#### Scenario: Alarm
- **WHEN** a sequence sets the Lab Junction to `alarm` with the `emergency` tint while the player is in it
- **THEN** within 2 s the room's metal reflects red light, not the white light it had before

#### Scenario: Blackout
- **WHEN** the station goes to backup power
- **THEN** within 2 s of the player entering any room, its reflections show only that room's backup lights, with no bright fixtures that are out

#### Scenario: Flickering light
- **WHEN** a room's lights play the `flicker` pattern
- **THEN** its reflections stay steady and the room is not captured again on every flicker

### Requirement: Room-coloured bounce light
Characters and props in the room the player is in SHALL receive soft bounce light coloured by that room's capture, stronger from the directions its light comes from. The room's authored ambient preset SHALL still set its overall ambient strength.

#### Scenario: Heins by the gallery lamps
- **WHEN** Heins stands in the Observation Gallery near its warm lamps
- **THEN** the side of him facing the lamps carries a warmer fill than the side facing the Lab B glass

#### Scenario: Preset brightness kept
- **WHEN** a room uses the `gallery` ambient preset
- **THEN** its overall ambient level matches the preset's, within the tuning tolerance recorded in the design

### Requirement: Captures do not hitch or grow memory
Capturing a room SHALL NOT drop a frame below the `render-quality` frame-rate floor. The number of captures kept at once SHALL be bounded, and returning to the title screen SHALL release them all.

#### Scenario: Entering an uncaptured room
- **WHEN** the player first opens the door into a room that has not been captured
- **THEN** the 1% lows over that second stay at or above the floor, and the room has its own reflections within 1 s

#### Scenario: Long session
- **WHEN** the player walks through every room of the slice twice, under `?slot=scratch&memprobe`
- **THEN** GPU memory for captures stays within the bound recorded in the design and does not grow on the second loop

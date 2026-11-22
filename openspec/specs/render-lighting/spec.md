# render-lighting Specification

## Purpose

Defines how authored room lights become lit fixtures and real lights in the scene: which fixtures glow, which take a real light from the shared pool, the lamp light kind, and how scripted light changes reach every lit fixture.

## Requirements

### Requirement: Claimed fixtures light up
Every light slot a room claims in its level data SHALL show a lit fixture that follows that light's pattern and tint. A slot the room does not claim SHALL show a dark fixture. A kit piece built without a fixture SHALL offer no slot.

#### Scenario: All fixtures claimed
- **WHEN** a room's level data claims all six of its ceiling slots
- **THEN** all six ceiling fixtures glow and none shows a dark diffuser

#### Scenario: Unclaimed slot
- **WHEN** a room claims slots 0, 2 and 4 of six
- **THEN** slots 1, 3 and 5 show dark diffusers

### Requirement: Glow-only lights
A claimed light SHALL take a real light from the shared pool unless its level data sets `pool: false`. A glow-only light SHALL keep its glowing fixture, patterns and tints but SHALL never take a pooled light.

#### Scenario: Corner fixture set to glow only
- **WHEN** a room claims a ceiling slot with `pool: false`
- **THEN** the fixture glows and flickers with the room's pattern but casts no light, and the pool has one more light for other slots

### Requirement: Fill lights go to the current room first
The scene's fixed pool of fill lights SHALL go first to the pooled lights of the room the camera is in, nearest first, then to pooled lights of other visible rooms, nearest first. Pooled lights beyond the pool's size SHALL keep their glowing fixture but cast no light.

#### Scenario: Room seen through glass
- **WHEN** the camera is in a room with 4 pooled lights, a room with 3 pooled lights is visible through glass, and the pool holds 8
- **THEN** all 7 cast real light

#### Scenario: Pool smaller than demand
- **WHEN** the visible rooms have more pooled lights than the pool holds
- **THEN** the current room's lights are lit first and the farthest lights of other rooms cast no light while their fixtures still glow

### Requirement: Lamp lights
The light-slot kinds SHALL include `pendant`: a warm, short-range light whose source sits just below the bulb. The `pendant_light` prop SHALL offer one `pendant` slot per bulb when its `slots` param is true. Without the param, its bulbs SHALL glow as before and offer no slots.

#### Scenario: Lamp claimed as a room light
- **WHEN** a room places `pendant_light` with `slots: true` and claims its slot as a pooled light
- **THEN** light comes from the bulb's height and lights the area under the lamp more than the room around it

#### Scenario: Existing lamps untouched
- **WHEN** a room places `pendant_light` without `slots`
- **THEN** its bulbs glow as before and the room's slot list does not change

### Requirement: Scripted light changes reach every claimed light
A scripted light pattern or tint for a room SHALL apply to every light the room claims, of every kind, pooled or glow-only.

#### Scenario: Emergency in a room with lamps
- **WHEN** a sequence sets a room with ceiling lights and lamps to `alarm` with the `emergency` tint
- **THEN** the ceiling fixtures and the lamps, pooled and glow-only alike, follow the alarm pattern in emergency red

### Requirement: Backup lights
A claimed light SHALL be a backup light when its level data marks it as backup or when it is an `emergency` slot, such as an `emergency_beacon`'s. A room with no backup light SHALL treat its first claimed light as one. Under backup power only backup lights SHALL glow or cast light. Each glows a dim warm white at no more than 30% of its main-power intensity.

#### Scenario: Room with a beacon
- **WHEN** a room claims four ceiling lights and an `emergency_beacon` slot, and the station goes to backup power
- **THEN** the four ceiling fixtures show dark diffusers and cast no light, and only the beacon glows

#### Scenario: Room without a backup light
- **WHEN** a room claims slots 0, 2 and 4 with none marked backup, and the station goes to backup power
- **THEN** slot 0 glows dimly and slots 2 and 4 are dark

#### Scenario: Back on main power
- **WHEN** the station returns to main power
- **THEN** every claimed light returns to its own pattern, tint and intensity

### Requirement: Station power reaches every room
A change of station power SHALL apply to every room, including rooms not currently visible and rooms built after the change. Dark fixtures SHALL free their pooled lights for other lights.

#### Scenario: Room behind a closed door
- **WHEN** the station goes to backup power while the player is in R05, and the player later walks into the Commons
- **THEN** the Commons is already under backup lighting when its door opens

#### Scenario: Pool goes to backup lights
- **WHEN** the station is under backup power
- **THEN** no pooled light is assigned to a light that is out

### Requirement: Scripted light changes under backup power
Under backup power, a scripted light pattern or tint for a room SHALL apply to that room's backup lights only. Its main lights SHALL stay out.

#### Scenario: Flicker during the blackout
- **WHEN** a sequence sets a room to `flicker` under backup power
- **THEN** that room's backup lights flicker and its main lights stay dark

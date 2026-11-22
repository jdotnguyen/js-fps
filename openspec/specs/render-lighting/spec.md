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

### Requirement: Shadows have soft edges
Shadows cast by the flashlight and by shadow-casting room lights SHALL have soft edges, without visible stair-steps or banding.

#### Scenario: Flashlight on a chair
- **WHEN** the flashlight shines on a chair near a wall
- **THEN** the chair's shadow on the wall has a soft edge with no stair-stepped outline

#### Scenario: Sofa under the gallery lamp
- **WHEN** quality is High and the east lamp in the Observation Gallery lights the sofa
- **THEN** the sofa's shadow on the carpet has a soft edge with no stair-stepped outline

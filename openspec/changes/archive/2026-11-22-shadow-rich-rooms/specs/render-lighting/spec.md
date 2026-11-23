# Spec Delta

## MODIFIED Requirements

### Requirement: Room lights opt in to shadows
A pooled room light SHALL cast shadows only when its level data sets `shadow: true`. Shadow-casting room lights SHALL shine downward from the fixture as a cone. Shadow lights SHALL go first to opted-in lights in the visible rooms whose lit area is in the camera's view, then to those whose lit area is not. Within each group the current room comes first, then nearest first. An opted-in light that misses the shadow pool SHALL still light the room, unshadowed.

#### Scenario: Shadowed lamp
- **WHEN** a lamp over a sofa sets `shadow: true` and the shadow pool has room
- **THEN** the sofa and anyone sitting on it cast shadows on the floor inside the lamp's pool of light

#### Scenario: Shadow pool full
- **WHEN** more visible lights opt in than the shadow pool holds, and all of their lit areas are in view
- **THEN** the farthest opted-in lights light the room without shadows

#### Scenario: Light behind the player
- **WHEN** quality is Medium, the player stands in R03 between two opted-in lights behind them and two in front, and the lit areas of only the two in front are in view
- **THEN** the two lights in front cast shadows, even though the two behind are nearer

#### Scenario: Light behind the player that lights the view
- **WHEN** an opted-in light behind the player throws light onto the floor in front of them
- **THEN** it ranks as in view, and the player's and nearby characters' shadows it casts can be seen

## ADDED Requirements

### Requirement: Shadow lights are held steadily
A light holding a shadow SHALL keep it until another opted-in light has outranked it for at least 0.5 s. Shadows SHALL NOT swap between lights in consecutive frames as the camera moves or turns.

#### Scenario: Walking between two lamps
- **WHEN** quality is Medium and the player walks slowly past the midpoint between two pairs of opted-in lights in R03
- **THEN** the shadows hand over from one pair to the other once, not back and forth

#### Scenario: A quick glance
- **WHEN** the player turns away from a shadowed light and back within 0.5 s
- **THEN** that light keeps its shadow throughout

### Requirement: Shadows fade in and out
A light that gains or loses its shadow SHALL fade that shadow in or out over 0.2 to 0.4 s rather than switching it in one frame. A tier switch MAY apply at once.

#### Scenario: Shadow hand-over
- **WHEN** a shadow passes from one light to another
- **THEN** the old shadow fades out and the new one fades in, the whole hand-over taking no more than 0.6 s, and neither appears or vanishes in a single frame

### Requirement: Shadows stay correct while things move
The shadow of a moving thing (a character, a door, a held or thrown prop, a gore chunk, a swaying lamp) SHALL follow it every frame within a shadow light's reach. When it leaves that reach, or stops moving, its old shadow SHALL NOT remain behind. Shadows of static walls and furniture SHALL stay as they are.

#### Scenario: Heins walks out of a lamp's reach
- **WHEN** Heins walks under a shadowed lamp in R03 and then out of its reach
- **THEN** his shadow follows him under the lamp, and no shadow of him is left on the floor after he has gone

#### Scenario: Door opening under a shadow light
- **WHEN** a door inside a shadow light's reach opens
- **THEN** its shadow moves with the door as it opens and rests where it stops

### Requirement: Swaying lights
A hanging lamp whose level data sets `sway` SHALL swing gently on its cable. Its shade, its light and its shadow SHALL move together. A shotgun shot within 3 m, a bullet passing the shade, or a scripted jolt SHALL set a hanging lamp swinging harder, easing back to its authored sway.

#### Scenario: Authored sway
- **WHEN** R03's pendant over the sofa sets `sway` and casts shadows
- **THEN** the shade swings slowly, and the sofa's shadow moves with it across the carpet

#### Scenario: Shot near a lamp
- **WHEN** the player fires the shotgun 2 m from a hanging lamp
- **THEN** the lamp swings visibly harder, its shadows swing with it, and it settles back over a few seconds

#### Scenario: Swaying light on Low
- **WHEN** quality is Low and a swaying lamp casts no shadow
- **THEN** the shade and its light still swing together

### Requirement: Light patterns
A shadow light whose level data sets `cookie` SHALL project that pattern (at least a grille, a vent fan and a cracked lens). A fan pattern SHALL turn. Patterned lights SHALL take the patterned shadow lights first, at least 1 on Medium and 2 on High. A patterned light without one SHALL light without the pattern.

#### Scenario: Vent fan
- **WHEN** a light behind a vent sets `cookie: "fan"` and holds a shadow
- **THEN** the floor shows the fan's blades turning in its light

#### Scenario: Patterned light misses the pool
- **WHEN** quality is Low and a light sets `cookie: "grille"`
- **THEN** it lights the room evenly, without the grille pattern

#### Scenario: Two patterned lights on Medium
- **WHEN** quality is Medium and two patterned lights in view both hold shadows
- **THEN** the higher-ranked one shows its pattern and the other casts its shadow without a pattern

### Requirement: Characters are grounded
Every standing, walking or seated character SHALL have a soft contact shadow under it on every tier, so that no character looks as if it floats. That includes characters beyond the character-shadow distance and in rooms without shadow lights. The contact shadow SHALL NOT appear on walls or the ceiling, and SHALL NOT double-darken under a real shadow.

#### Scenario: Far end of the gallery
- **WHEN** quality is Medium and Heins stands 20 m from the camera, beyond the character-shadow distance
- **THEN** a soft darkening under his feet grounds him on the floor

#### Scenario: Low tier
- **WHEN** quality is Low, where no room light casts shadows
- **THEN** every visible character still has a contact shadow

#### Scenario: Under a shadow light
- **WHEN** a character stands inside a shadow light's pool and casts a real shadow
- **THEN** the floor at its feet is no darker than the real shadow with a soft contact edge

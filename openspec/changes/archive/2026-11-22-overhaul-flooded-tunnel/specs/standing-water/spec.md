# Spec Delta

## Purpose

Defines standing water placed in a level: how its surface looks under the room's lights, how it reacts to the people,
shots and bodies that disturb it, what it leaves on them, and how scripted sequences change its level.

## ADDED Requirements

### Requirement: The surface is lit by the room
A standing-water surface SHALL be lit by the lights around it. Each light SHALL leave a highlight on the surface that
follows its pattern and tint, and the surface SHALL reflect more as the view gets closer to grazing.

#### Scenario: A flickering tube over the water
- **WHEN** a ceiling tube above the water flickers off and on
- **THEN** its highlight on the water goes dark and comes back with it

#### Scenario: Looking along the water
- **WHEN** Jay looks along the water at a low angle
- **THEN** it reflects more strongly than when he looks straight down

### Requirement: The surface reflects the room
A standing-water surface SHALL show a reflection of the room above it, including its lit fixtures, the walls and the
people standing in it. Ripples SHALL bend and break up the reflection, and reflected lights SHALL follow their patterns.

#### Scenario: Reflected fixtures
- **WHEN** Jay looks along the water toward a lit fixture at the far end of the room
- **THEN** the fixture shows reflected in the water, and the reflection wobbles when the surface ripples

### Requirement: Depth makes the water murky
Things under the surface SHALL fade into the water's colour with depth: just below the surface they SHALL be clear,
and SHALL be faint or unseen near the floor of deep water. Things under the surface SHALL appear shifted by refraction,
more so where it ripples.

#### Scenario: Submerged stairs
- **WHEN** Jay looks down the stairs into the water
- **THEN** the first submerged step is clear, and each lower step is fainter and more water-tinted

### Requirement: The water ripples from what disturbs it
The surface SHALL ripple from everything that disturbs it: Jay, squadmates and enemies wading, bullets, falling bodies
and severed parts, drips and pouring water. Ripples SHALL spread out, cross and reflect off walls and other solid edges,
and fade over a few seconds.

#### Scenario: A wake
- **WHEN** a shambler wades toward Jay through still water
- **THEN** a wake spreads out from its legs and reaches the water around Jay before it does

#### Scenario: Ripples off a wall
- **WHEN** a ring spreads from a splash near a wall
- **THEN** it reflects off the wall rather than passing through it

### Requirement: Undisturbed water is calm but alive
Where nothing disturbs it, the surface SHALL show only slow, fine ripples, never rolling waves. A hull groan or camera
shake in the room SHALL send a brief shudder across the whole surface.

#### Scenario: Hull groan
- **WHEN** a scripted hull groan shakes the camera while Jay stands in still water
- **THEN** the whole surface shivers briefly and settles again

### Requirement: Splashes
Things that hit or break the surface SHALL splash: a jump takeoff, a landing, a bullet impact, a body falling or rising,
a severed part landing. A splash SHALL throw spray scaled to the impact, start a ripple ring and play a matching splash
sound from where it happened.

#### Scenario: Shooting the water
- **WHEN** a bullet hits the water
- **THEN** a small spout and spray rise at the impact point, a ring spreads and a short splash sounds there

#### Scenario: A body falls in
- **WHEN** a shambler is killed and falls into the water
- **THEN** a large splash and a strong ring mark where it fell

### Requirement: Blood clouds in water
Blood shed onto or into standing water SHALL spread as a slow, fading cloud under the surface instead of a blood pool
decal on the floor.

#### Scenario: A kill in the water
- **WHEN** a shambler is shot and bleeds into the water
- **THEN** a dark red cloud spreads slowly under the surface around it and fades, and no floor pool appears under the water

### Requirement: Bodies stay wet
A character that has waded or lain in standing water SHALL look darker and glossier up to the deepest point the water
reached on its body. The wetness SHALL dry slowly once it leaves the water.

#### Scenario: Leaving the water
- **WHEN** Okafor walks out of the water up the stairs
- **THEN** her legs look wet up to the depth she waded to, and they dry over the following minute

### Requirement: Sequences change the water level
A sequence step SHALL be able to set a room's water level, either at once or rising or falling over a duration. During
the change, the surface, reflections, depth tint, wading depth and splashes SHALL all follow the current level. Skipping
the sequence SHALL leave the water at the final level.

#### Scenario: Rising water
- **WHEN** a sequence raises R09's water by 1 m over 3 s
- **THEN** the surface rises smoothly over 3 s, and a character standing in it is deeper by 1 m at the end

#### Scenario: Skipped while rising
- **WHEN** a sequence that raises the water is skipped partway through
- **THEN** the water is at the final level afterwards

### Requirement: Water level survives checkpoints
A checkpoint save SHALL record each room's water level, and restoring it SHALL bring back that level.

#### Scenario: Restore after a level change
- **WHEN** a checkpoint is saved after a room's water has risen, and later restored
- **THEN** the water is at the risen level

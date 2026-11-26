# severed-debris Specification

## Purpose

Defines how severed limbs and gore chunks move once they leave a body: colliding with the level and each other, settling, leaving marks where they land, and staying within the existing gore budgets.

## Requirements

### Requirement: Severed pieces collide with the level
With severed debris on, a severed limb, head or gore chunk SHALL collide with walls, floors, ceilings, props, glass, closed doors and other pieces, and SHALL NOT pass through any of them, including at the highest launch speed weapons produce.

#### Scenario: Limb shot toward a wall
- **WHEN** an arm is severed by a shotgun blast toward a wall 1 m away
- **THEN** the arm hits the wall and falls, ending on the room's side of the wall

#### Scenario: Limb lands on a bench
- **WHEN** a severed leg falls onto a bench top
- **THEN** it comes to rest on the bench top, not at floor height inside the bench

### Requirement: Pieces tumble and settle
A severed piece SHALL roll, tip and slide according to its shape and its contacts, and SHALL come to rest within 6 seconds of being severed. A piece at rest SHALL stop costing simulation time.

#### Scenario: Long piece on a slope
- **WHEN** a severed leg lands on a ramp
- **THEN** it slides or rolls down and comes to rest against the next obstacle or the level floor

#### Scenario: Settling
- **WHEN** 6 seconds have passed since a piece was severed and nothing has touched it since
- **THEN** it is at rest and asleep

### Requirement: Marks follow the real landing point
Pools, splats and smears made by a piece landing SHALL be placed at the point and on the surface it actually hit, including walls and prop tops, and SHALL respect the existing glass clipping.

#### Scenario: Splat on a wall
- **WHEN** a severed head strikes a wall
- **THEN** a splat appears on the wall where it struck

### Requirement: A landing piece is heard
When a severed piece first strikes the level or a prop fast enough to be heard, a wet thud SHALL play from that point, once for the piece.

#### Scenario: Arm hits the floor
- **WHEN** a severed arm falls to the floor
- **THEN** one thud is heard where it lands

### Requirement: Debris budget is unchanged
The number of live severed pieces SHALL stay within the existing debris cap. When the cap is exceeded, the oldest piece SHALL fade out as it does today.

#### Scenario: Over the cap
- **WHEN** a 25th piece is severed while 24 are live
- **THEN** the oldest piece fades out and is removed

### Requirement: Reduced gore is unaffected
In reduced gore mode, nothing SHALL be detached, exactly as today, and severed debris SHALL create no physical pieces.

#### Scenario: Reduced mode
- **WHEN** a limb is shot off in reduced gore mode
- **THEN** the limb goes limp on the body and no physical piece is created

# Spec Delta

## Purpose

How Jay, the player, moves through the level: walking, stepping and jumping, including when a jump is allowed, what he
can get onto with one, and what stops him.

## ADDED Requirements

### Requirement: Jump only from the ground in free play
Jay SHALL jump when the jump key (Space by default) is pressed while he stands on the ground and the player has free
movement. A jump SHALL NOT start while airborne, on rails (movement locked), downed, dead, wading, or during a
scripted walk.

#### Scenario: Jump from the ground
- **WHEN** Jay stands on the floor with free movement and the player presses jump
- **THEN** Jay leaves the ground and rises

#### Scenario: No jump in the air
- **WHEN** Jay is already airborne and the player presses jump again
- **THEN** no second jump starts and he keeps falling as before

#### Scenario: No jump when control is taken away
- **WHEN** the player presses jump while Jay is on rails, downed, dead, wading or on a scripted walk
- **THEN** Jay does not leave the ground

### Requirement: Jump reach is 1.00 m
A jump SHALL let Jay get onto any walkable top up to 1.00 m above the floor he jumped from, when he moves toward it
during the jump. The reach SHALL be measured from the takeoff floor, not from world zero.

#### Scenario: Onto a desk
- **WHEN** Jay jumps at walking speed toward a desk whose top is 0.75 m above his floor
- **THEN** he can land on the desk top

#### Scenario: Onto a counter
- **WHEN** Jay jumps at walking speed toward a counter whose top is 0.90 m above his floor
- **THEN** he can land on the counter top

#### Scenario: At the limit
- **WHEN** Jay jumps at walking speed toward a box whose top is exactly 1.00 m above his floor
- **THEN** he can land on the box top

#### Scenario: Measured from the takeoff floor
- **WHEN** Jay jumps from a platform 0.50 m high toward a box whose top is 1.50 m above world floor level
- **THEN** he can land on the box top

### Requirement: Taller obstacles block a jump
An obstacle whose top is clearly above Jay's jump reach SHALL block him sideways for the whole jump, as a wall does;
he SHALL NOT end up on top of it or past it.

#### Scenario: Just too tall
- **WHEN** Jay jumps at walking speed toward a box whose top is 1.10 m above his floor
- **THEN** the box stops him and he lands back on his own floor in front of it

#### Scenario: Just over the limit at a sprint
- **WHEN** Jay jumps at sprint speed toward a box whose top is 1.02 m above his floor
- **THEN** the box stops him and he lands back on his own floor in front of it

#### Scenario: Full-height wall
- **WHEN** Jay jumps toward a full-height wall
- **THEN** the wall stops him and he lands back on his own floor

### Requirement: Only tops with headroom can be mounted
Jay SHALL get onto a top with a jump only if there is room for his full standing height above it. A top with
anything lower than that over it (a wall cabinet above a counter, a shelf, pipes) SHALL block him like a too-tall
obstacle, so his head never ends up inside a prop or ceiling.

#### Scenario: Counter under a wall cabinet
- **WHEN** Jay jumps toward a 0.90 m counter with a cabinet underside 1.20 m above the counter top
- **THEN** the counter blocks him and he lands back on his own floor

#### Scenario: Counter in an open room
- **WHEN** Jay jumps toward a 0.90 m counter in a 3.2 m room with nothing above it
- **THEN** he can land on the counter top

### Requirement: A ceiling stops the rise
While rising, Jay's head SHALL NOT pass through a ceiling or any underside above him; the rise SHALL stop there and
he SHALL fall back.

#### Scenario: Low ceiling
- **WHEN** Jay jumps under a ceiling 2.00 m above his floor
- **THEN** the top of his head never goes above 2.00 m and he falls back to the floor

### Requirement: Landing is smooth and audible
Landing from a jump SHALL play a landing footstep. Landing on a top higher than the takeoff floor SHALL NOT snap the
view: the camera SHALL ease up to the new height as it does on a walking step-up.

#### Scenario: Landing footstep
- **WHEN** Jay lands on any floor after a jump
- **THEN** one landing footstep plays for that floor's surface

#### Scenario: Mounting a counter
- **WHEN** Jay lands on a 0.90 m counter top after a jump
- **THEN** the view rises to the new height over a short ease, without a one-frame jump

### Requirement: Reach belongs to jumps only
The jump reach SHALL NOT change walking. Without a jump, Jay SHALL step up at most 0.35 m, and falling off a ledge
SHALL NOT let him climb anything higher than that. Characters that never jump (enemies, squad, crew) SHALL step and
fall exactly as before.

#### Scenario: Walking into a desk
- **WHEN** Jay walks, without jumping, into a desk 0.75 m high
- **THEN** the desk blocks him

#### Scenario: Falling off a ledge
- **WHEN** Jay walks off a ledge without jumping and moves sideways while he falls
- **THEN** he cannot get onto any top more than 0.35 m above his feet at that moment of the fall

#### Scenario: Other characters unchanged
- **WHEN** an enemy, squadmate or crew member walks into a 0.75 m desk
- **THEN** the desk blocks them, as it does today

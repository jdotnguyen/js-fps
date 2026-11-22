# player-movement Specification

## Purpose

How Jay, the player, moves through the level: walking, stepping and jumping, including when a jump is allowed, what he
can get onto with one, and what stops him.

## Requirements

### Requirement: Jump only from the ground in free play
Jay SHALL jump when the jump key (Space by default) is pressed while he stands on the ground and the player has free
movement, including while he wades. A jump SHALL NOT start while airborne, on rails (movement locked), downed, dead, or
during a scripted walk.

#### Scenario: Jump from the ground
- **WHEN** Jay stands on the floor with free movement and the player presses jump
- **THEN** Jay leaves the ground and rises

#### Scenario: No jump in the air
- **WHEN** Jay is already airborne and the player presses jump again
- **THEN** no second jump starts and he keeps falling as before

#### Scenario: No jump when control is taken away
- **WHEN** the player presses jump while Jay is on rails, downed, dead or on a scripted walk
- **THEN** Jay does not leave the ground

#### Scenario: Jump while wading
- **WHEN** Jay stands in water with free movement and the player presses jump
- **THEN** Jay leaves the ground and rises

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

### Requirement: Jumps in water are heavier
A jump that starts in water SHALL rise more slowly and lower than one on a dry floor, but SHALL still let Jay get onto
tops up to 0.90 m above the floor under the water. A jump SHALL NOT start again until a short recovery after landing in
water, so hopping is never faster than wading.

#### Scenario: Onto a case from the water
- **WHEN** Jay jumps from the sump floor toward a top 0.85 m above it
- **THEN** he can land on the top

#### Scenario: Too high from the water
- **WHEN** Jay jumps from the sump floor toward a top 0.95 m above it
- **THEN** the top stops him and he lands back in the water

#### Scenario: No bunny-hopping
- **WHEN** the player holds forward and presses jump repeatedly while Jay crosses a stretch of water
- **THEN** Jay crosses it no faster than wading across

### Requirement: Wading slows with depth
In standing water, Jay's speed SHALL fall as he gets deeper, from almost walking speed at ankle depth to 0.5 of walking
speed at thigh depth. Starting and stopping SHALL feel heavier the deeper he is. Jay SHALL NOT sprint in water deeper
than his knees.

#### Scenario: Down the stairs
- **WHEN** Jay walks down stairs into water
- **THEN** he slows a little on each submerged step rather than all at once at the waterline

#### Scenario: Sprinting into deep water
- **WHEN** Jay sprints off the stairs into thigh-deep water
- **THEN** his sprint ends and he moves at wading speed

### Requirement: Downed in water keeps the view above it
When Jay is downed in standing water, his view SHALL stay just above the surface instead of dropping under it, so he
can still see and be revived.

#### Scenario: Downed in the sump
- **WHEN** Jay is downed in 0.75 m of water
- **THEN** his view sits just above the surface, looking out across the water

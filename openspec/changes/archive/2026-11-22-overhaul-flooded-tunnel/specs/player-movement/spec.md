# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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

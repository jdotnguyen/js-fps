# enemy-encounters Specification

## Purpose

Defines where spawned enemies land, how far their attacks reach and how a scripted fight's group is resolved when one of its enemies can't be reached, so every fight can be won and ends.

## Requirements

### Requirement: Emerging enemies land on the floor below their spawn point
An enemy spawned from a vent or ceiling spawn point SHALL come out on the highest walkable top at or below the spawn point. It SHALL NOT end up on any top above the spawn point, including a ceiling slab within its step height.

#### Scenario: Ceiling spawn just under a ceiling slab
- **GIVEN** `r11_vent_1` at y 3.8 in R11, just under R11's ceiling slab
- **WHEN** the enemy spawns and gets up
- **THEN** it stands on the R11 floor, under the spawn point

#### Scenario: Vent spawn up a wall
- **GIVEN** `r06_duct` in R06's ceiling vent
- **WHEN** the enemy drops
- **THEN** it lands on the R06 floor below the vent, not on the ceiling slab

### Requirement: Attacks reach vertically as well as horizontally
An enemy SHALL start a windup, and its swipe, bite or grab SHALL connect, only when the target is within its attack reach horizontally and the gap between the enemy's feet and the target's feet is at most 1.2 m.

#### Scenario: Enemy above the ceiling
- **GIVEN** an enemy stands on a ceiling slab 4.12 m above Jay and 1 m from him horizontally
- **WHEN** it would attack
- **THEN** it does not wind up, Jay takes no damage and he is not grabbed

#### Scenario: Jay on a crate
- **GIVEN** Jay stands on a crate 1.0 m high and an enemy is within reach beside it
- **WHEN** the enemy attacks
- **THEN** the attack can connect as normal

### Requirement: A group enemy that can't reach anyone is removed
An enemy in a spawn group that has been unable to walk to any target for 10 s SHALL be removed and counted as dead for its group, once Jay can't see it. If it is still in view after 30 s it SHALL be removed anyway.

#### Scenario: The last enemy of a cover fight is stuck out of reach
- **GIVEN** the `r06_cover` creature has had no walking route to Jay or the squad for 10 s and is out of Jay's view
- **WHEN** the encounter updates
- **THEN** it is removed, `r06_cover` is cleared and `cover_me` carries on past `waitGroup`

#### Scenario: An enemy that can still reach a target
- **GIVEN** a group enemy has a walking route to Jay
- **WHEN** 10 s or more pass while it chases him
- **THEN** it is not removed

### Requirement: Dropping enemies fall from their spawn point
A spawn point SHALL be able to make its enemies drop: the enemy appears at the spawn point, falls under gravity to the
floor below, lands with a heard and felt impact, gets up and hunts the player at once. It SHALL NOT appear already lying
on the floor.

#### Scenario: Drop from the R06 vent
- **WHEN** the `r06_duct` creature spawns
- **THEN** it is first seen at the vent, falls to the floor, a landing sound plays with a camera shake, and it then gets up and goes for Jay

#### Scenario: Emerging spawns are unchanged
- **WHEN** an enemy spawns from a vent or ceiling point that does not drop
- **THEN** it comes out as before

### Requirement: A spawn point can set its enemies' health
A spawn point SHALL be able to give its enemies a health value in place of their variant's base health. The difficulty
setting's health multiplier SHALL still apply to it. A spawn point without one SHALL use the variant's base health.

#### Scenario: The escaped creature
- **WHEN** the `r06_duct` creature spawns at normal difficulty
- **THEN** it has 90 health and the shambler's moves and attacks

#### Scenario: No override
- **WHEN** a shambler spawns from a point with no health value
- **THEN** it has the shambler's base health

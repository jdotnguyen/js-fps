# Spec Delta

## Purpose

Defines where spawned enemies land, how far their attacks reach and how a scripted fight's group is resolved when one of its enemies can't be reached, so every fight can be won and ends.

## ADDED Requirements

### Requirement: Emerging enemies land on the floor below their spawn point
An enemy spawned from a vent or ceiling spawn point SHALL come out on the highest walkable top at or below the spawn point. It SHALL NOT end up on any top above the spawn point, including a ceiling slab within its step height.

#### Scenario: Ceiling spawn just under a ceiling slab
- **GIVEN** `r06_ceiling` at y 3.8 in R06, whose ceiling slab spans y 4.00 to 4.12
- **WHEN** the enemy spawns and gets up
- **THEN** it stands on the R06 floor at y 0, under the spawn point

#### Scenario: Vent spawn up a wall
- **GIVEN** `r05_vent` at y 2.7 in R05
- **WHEN** the enemy spawns
- **THEN** it comes out on the R05 floor below the vent

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
- **GIVEN** every `r06_cover` enemy but one is dead, and that one has had no walking route to Jay or the squad for 10 s and is out of Jay's view
- **WHEN** the encounter updates
- **THEN** it is removed, `r06_cover` is cleared and `cover_me` carries on past `waitGroup`

#### Scenario: An enemy that can still reach a target
- **GIVEN** a group enemy has a walking route to Jay
- **WHEN** 10 s or more pass while it chases him
- **THEN** it is not removed

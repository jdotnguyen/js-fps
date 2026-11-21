# Spec Delta

## Purpose

Defines how the player and the world act on physical bodies: walking into debris and corpses, stomping corpses, and props that are allowed to move.

## ADDED Requirements

### Requirement: The player pushes loose bodies
With physical interaction on, the player's movement SHALL push severed pieces and small dynamic props aside. The pieces SHALL NOT slow, block or lift the player.

#### Scenario: Walking through limbs
- **WHEN** the player walks over a severed arm on the floor
- **THEN** the arm is nudged aside and the player's speed and height are unchanged

### Requirement: Corpses can be stomped
The player SHALL be able to stomp a corpse in reach. A stomp SHALL push the corpse physically, play a stomp sound, and deal stomp damage that can sever limbs.

#### Scenario: Stomp severs an arm
- **WHEN** the player stomps a corpse's arm enough times to reach its sever threshold
- **THEN** the arm comes off as severed debris

### Requirement: Only named props move
A prop SHALL be dynamic only when its level or kit data marks it as dynamic. Every other prop SHALL keep its authored static colliders. A dynamic prop's movement SHALL NOT block any path the level's walk tests require.

#### Scenario: Unmarked prop
- **WHEN** a shotgun blast hits a cabinet not marked as dynamic
- **THEN** the cabinet does not move

#### Scenario: Trolley pushed into a doorway
- **WHEN** a dynamic trolley is pushed into a doorway on a required path
- **THEN** the player can still pass, either by pushing it through or because it cannot fill the doorway

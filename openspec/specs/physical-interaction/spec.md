# physical-interaction Specification

## Purpose

Defines how the player and the world act on physical bodies: walking into debris, stomping corpses, props that are allowed to move, and scripted kills knocking loose objects over.

## Requirements

### Requirement: The player pushes loose bodies
With physical interaction on, the player's movement SHALL push severed pieces and small dynamic props aside. The pieces SHALL NOT slow, block or lift the player.

#### Scenario: Walking through limbs
- **WHEN** the player walks over a severed arm on the floor
- **THEN** the arm is nudged aside and the player's speed and height are unchanged

### Requirement: Corpses can be stomped
With physical interaction on, the player SHALL be able to stomp a corpse in reach. A stomp SHALL play a stomp sound, deal stomp damage that can sever limbs, and shove loose bodies under the boot.

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

### Requirement: Lab B is furnished with loose lab objects
Lab B SHALL have a loaded prep cart standing on Dr. Voss's way to the gallery glass, and glassware and instruments on its benches. The objects SHALL be visible from the gallery whether or not physics is on.

#### Scenario: Seen from the gallery with physics off
- **WHEN** the player looks into Lab B before the kill with every physics feature switched off
- **THEN** the loaded cart and the objects on the benches are there, standing still

#### Scenario: At rest before the kill
- **WHEN** Lab B has been loaded with physical interaction on and nothing has touched it
- **THEN** every loose object is still where it was placed, with none sunk, jittering or fallen

### Requirement: Scripted kills knock loose objects over
With physical interaction on, Dr. Voss SHALL knock over loose objects she reaches as she staggers to the glass during her kill. A kill that is restored or skipped SHALL move nothing.

#### Scenario: Played kill
- **WHEN** the Voss kill plays and she staggers to the glass
- **THEN** the cart's load and the objects she reaches are thrown or topple, and land on the floor or furniture without passing through it or the glass

#### Scenario: Restored kill
- **WHEN** the level is restored from a checkpoint taken after the kill
- **THEN** no loose object is moved by the restored kill

#### Scenario: Restart before the kill
- **WHEN** the player restarts from a checkpoint taken before the kill
- **THEN** every loose object is back where it was placed

### Requirement: Loose objects never block movement
A loose object SHALL NOT be an obstacle to the player, squad or enemies, standing or fallen, and SHALL NOT delay a scripted walk.

#### Scenario: Fallen objects on her path
- **WHEN** objects lie on the floor between Dr. Voss and the glass
- **THEN** she reaches the glass as she does with physics off

### Requirement: Loose objects are heard when they hit something
A loose object SHALL make a sound suited to what it is when it is struck or lands, from where it is, louder for a harder hit. Many objects hitting at once SHALL stay within a fixed number of sounds. Objects at rest, a room settling as it loads, a restored kill and a restart SHALL be silent.

#### Scenario: The cart goes over
- **WHEN** Dr. Voss knocks the cart over
- **THEN** the cart is heard crashing and its glassware clinking, from where they are

#### Scenario: Quiet room
- **WHEN** the room loads, or a save made past the kill is loaded
- **THEN** no impact sound plays

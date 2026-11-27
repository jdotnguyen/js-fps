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
Lab B SHALL have a loaded prep cart standing on Dr. Voss's way to the gallery glass, loose glassware and instruments on the bench beside her, and glassware and instruments on its other benches. The objects SHALL be visible from the gallery whether or not physics is on.

#### Scenario: Seen from the gallery with physics off
- **WHEN** the player looks into Lab B before the kill with every physics feature switched off
- **THEN** the loaded cart and the objects on the benches are there, standing still

#### Scenario: At rest before the kill
- **WHEN** Lab B has been loaded with physical interaction on and nothing has touched it
- **THEN** every loose object is still where it was placed, with none sunk, jittering or fallen

#### Scenario: Her bench
- **WHEN** Lab B loads with physical interaction on
- **THEN** the glassware and instruments on the bench beside Voss are loose objects

### Requirement: Scripted kills knock loose objects over
During her kill, Dr. Voss SHALL sweep the bench beside her clear and pull the prep cart over, each at an authored moment of her run. The cart SHALL go over on the same frame of the kill on every run, whether or not physics is on. With physical interaction on, the swept and spilled objects SHALL fall by physics; with it off they SHALL appear at authored resting spots at the moment they would be thrown. A kill that is restored or skipped SHALL leave the cart and those objects at their resting spots and move nothing.

#### Scenario: Played kill
- **WHEN** the Voss kill plays with physical interaction on and she sweeps the bench and pulls the cart
- **THEN** the bench glassware and the cart's load are thrown or topple, and land on the floor or furniture without passing through it or the glass

#### Scenario: The cart on its frame
- **WHEN** the kill plays once with physics on and once with every physics feature off
- **THEN** the cart starts going over at the same time after Okafor's question ends in both runs, to within one frame, and comes to rest in the same pose

#### Scenario: Physics off
- **WHEN** the kill plays with every physics feature switched off
- **THEN** at the sweep and at the cart's fall, the swept and spilled objects appear at their authored resting spots and stay there

#### Scenario: Restored kill
- **WHEN** the level is restored from a checkpoint taken after the kill
- **THEN** the cart and the swept objects lie at their resting spots, and no loose object is moved by the restored kill

#### Scenario: Restart before the kill
- **WHEN** the player restarts from a checkpoint taken before the kill
- **THEN** every loose object is back where it was placed

### Requirement: Loose objects never block movement
A loose object SHALL NOT be an obstacle to the player, squad or enemies, standing or fallen, and SHALL NOT delay a scripted walk.

#### Scenario: Fallen objects on her path
- **WHEN** objects lie on the floor between Dr. Voss and the glass
- **THEN** she reaches the glass as she does with physics off

### Requirement: Loose objects are heard when they hit something
A loose object SHALL make a sound suited to what it is when it is struck or lands, from where it is, louder for a harder hit. Many objects hitting at once SHALL stay within a fixed number of sounds. Objects at rest, a room settling as it loads, a restored kill and a restart SHALL be silent. A scripted crash SHALL play one designed sound at its scripted time, and the impacts of the objects it throws SHALL play quieter beneath it.

#### Scenario: The cart goes over
- **WHEN** Dr. Voss pulls the cart over
- **THEN** one designed cart crash plays from the cart at the scripted moment, and the glassware it spills is heard clinking more quietly, from where it lands

#### Scenario: Quiet room
- **WHEN** the room loads, or a save made past the kill is loaded
- **THEN** no impact sound plays

#### Scenario: Physics off
- **WHEN** the cart goes over with every physics feature switched off
- **THEN** the designed cart crash still plays at the scripted moment

### Requirement: Scripted impacts throw loose objects
With physical interaction on, a kill's impact SHALL be able to throw the loose objects within a set reach of it,
upward and away from the impact, with an authored strength. Each impact SHALL throw each object at most once. A kill
that is skipped or restored SHALL throw nothing.

#### Scenario: Impact throws what is near
- **WHEN** a kill impact with a 0.6 m reach lands beside three loose objects 0.3 m away and one 1 m away
- **THEN** the three near objects are thrown upward and away from the impact, and the far one does not move

#### Scenario: Stronger impact throws further
- **WHEN** the same object is thrown by an impact of strength 1 and, in another run, of strength 2
- **THEN** it travels further from the impact in the second run

#### Scenario: Skipped kill
- **WHEN** a kill with impacts is skipped
- **THEN** no loose object is thrown by its impacts

### Requirement: A scripted pose can be given to loose objects
A skipped or restored kill SHALL be able to put named loose objects at authored resting poses, so the scene shows its
aftermath. The objects SHALL then rest there without moving, whether or not physics is on, until something knocks
them.

#### Scenario: Skipped scene
- **WHEN** a kill that authors resting poses for its loose objects is skipped with physical interaction on
- **THEN** each named object is at its authored pose and stays still

#### Scenario: Physics off
- **WHEN** the same kill is skipped with every physics feature switched off
- **THEN** each named object is drawn at its authored pose

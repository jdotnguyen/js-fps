# Spec Delta

## MODIFIED Requirements

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

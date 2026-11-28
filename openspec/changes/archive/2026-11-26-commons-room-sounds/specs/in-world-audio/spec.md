# Spec Delta

## ADDED Requirements

### Requirement: Chairs scrape in the Commons
When a Commons crew member who wanders between seats gets up from a chair to move, or sits down on one, that chair SHALL scrape once. Stools, sofas and wall leans SHALL make no scrape, and neither SHALL anyone who is placed or reset without being seen to sit or stand.

#### Scenario: A diner moves tables
- **WHEN** a diner gets up from a chair, walks to another table and sits on a chair there
- **THEN** a scrape is heard from the first chair as they get up and from the second as they sit

#### Scenario: Moving to the sofa
- **WHEN** a crew member walks from a stool to a sofa
- **THEN** no chair scrape is heard

#### Scenario: Loading a save
- **WHEN** a load puts the crew back in their seats
- **THEN** no scrape is heard

### Requirement: Cups and cutlery at occupied tables
While crew sit on chairs in the Commons, a cup or cutlery sound SHALL come now and then from the table in front of one of them, at random intervals of about 4 to 10 s. With nobody on a chair there SHALL be none.

#### Scenario: Standing by a full table
- **WHEN** the player stands near a table with seated crew for a minute
- **THEN** several irregular clinks are heard from that part of the room

#### Scenario: An empty room of chairs
- **WHEN** no crew member is sitting on a chair
- **THEN** no table sound plays

### Requirement: Kitchen sounds while Bram is at his station
After the intro, while Bram stands at his station and no scripted Commons scene is running, pans, plates or the tap SHALL be heard from the kitchen counter at random intervals of about 8 to 20 s.

#### Scenario: Bram at work
- **WHEN** the intro has ended and Bram is at his station
- **THEN** irregular kitchen sounds come from the counter

#### Scenario: Bram away from the counter
- **WHEN** Bram is walking to the coffee machine or working it
- **THEN** no kitchen sound starts

#### Scenario: During the intro
- **WHEN** the intro is playing
- **THEN** no random kitchen sound starts

#### Scenario: Loading the save made as the intro ends
- **WHEN** the player loads the save made as the intro ends
- **THEN** kitchen sounds and brews happen as they would have without the load

### Requirement: Bram makes a brew
After the intro, Bram SHALL now and then walk from his station to the coffee machine, work it for about 8 s while the machine grinds, hisses and drips from where it stands, then walk back to his station and face as he did before. The first brew SHALL come within 60 s of time the player spends free in the Commons, and later ones about 2 to 3 minutes of such time apart.

#### Scenario: Waiting in the Commons
- **WHEN** the player stays free in the Commons for a minute after the intro with no one speaking
- **THEN** Bram walks to the machine, the brew is heard from it, and Bram returns to his station

#### Scenario: Player elsewhere
- **WHEN** the player stays outside the Commons
- **THEN** Bram does not start a brew

### Requirement: When a brew may start
A brew SHALL start only while the player is in the Commons with free control, no line is being spoken, no overheard exchange is running, no scripted Commons scene is running, and Bram is free at his station. A brew that is due while one of these fails SHALL wait for all of them.

#### Scenario: A line is playing
- **WHEN** a brew is due while a story line, hint or bark is audible, or a pair is saying an exchange
- **THEN** Bram stays at his station until the talk has ended

#### Scenario: Leaving mid-brew
- **WHEN** the player leaves the Commons while Bram is brewing
- **THEN** Bram finishes and returns to his station

### Requirement: A brew gives way
A scripted command to Bram, the drop or a checkpoint load SHALL end a brew and its sound at once. A script then has full control of Bram, and the brew SHALL NOT resume or move him afterwards. If Bram cannot reach the machine within about 12 s, he SHALL give up without the sound and return to his station.

#### Scenario: A scene takes Bram
- **WHEN** a script moves Bram while he is walking to the machine or working it
- **THEN** the brew sound stops and Bram does what the script says
- **AND** he is not walked back to the machine later by that brew

#### Scenario: The drop starts mid-brew
- **WHEN** the drop starts while Bram is brewing
- **THEN** the sound stops and Bram returns to his station

#### Scenario: Loading mid-brew
- **WHEN** a checkpoint is loaded while Bram is brewing
- **THEN** the sound stops and Bram is where the story has left him

#### Scenario: The player stands in the way
- **WHEN** the player blocks Bram from the machine
- **THEN** Bram gives up, no brew is heard, and he goes back to his station once the way is clear

### Requirement: The coffee machine sounds in the intro
When Bram works the coffee machine in the intro, the machine SHALL be heard from where it stands, quietly enough that the lines stay clear. A skipped intro SHALL NOT play it afterwards.

#### Scenario: Walking into the kitchen scene
- **WHEN** the intro shows Bram working the coffee machine
- **THEN** the machine is heard and every line over it is easy to follow

#### Scenario: Skipping the intro
- **WHEN** the player skips the intro before Bram reaches the machine
- **THEN** no intro brew sound plays

### Requirement: Commons room sounds sit in the room
Chair, table, kitchen and brew sounds SHALL come from their place in the room, fade with distance and be muffled by walls and closed doors as other world sounds are. Repeats SHALL vary in recording or pitch. While a line is audible or an exchange is being said, chair, table and kitchen sounds that start SHALL be quieter.

#### Scenario: Behind a closed door
- **WHEN** a clink sounds while the player is in a neighbouring room with the door closed
- **THEN** it is muffled and quieter, or not heard

#### Scenario: Talk over the clatter
- **WHEN** a pair is saying an exchange as a table sound starts
- **THEN** the sound is quieter than usual and the words are easy to follow

#### Scenario: Back to title
- **WHEN** the player returns to the title screen during a brew
- **THEN** no room sound is heard

### Requirement: Commons room sounds end at the drop
From the moment the drop starts, no chair, table or kitchen sound SHALL start and Bram SHALL NOT brew for the rest of the playthrough.

#### Scenario: Loading a checkpoint saved after the drop
- **WHEN** a checkpoint saved after the drop is loaded and the player is within earshot of the Commons
- **THEN** no chair, table, kitchen or brew sound is heard

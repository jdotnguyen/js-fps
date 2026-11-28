## MODIFIED Requirements

### Requirement: A room scene ends when the player leaves its room
A sequence MAY name the room its scene belongs to. While it runs, whenever the player is not inside that room, the scene SHALL end: every line it has queued is dropped and the sequence is released. A line that has already started SHALL NOT be cut off: it plays to its end, and its voice and subtitle keep following the player's earshot, so it fades as he walks away. A scene with no speaker but Jay, such as a greeting to a passer-by, ends the same way. Standing in a doorway that belongs to the room counts as inside.

#### Scenario: Leaving Hale's office mid-scene
- **GIVEN** Hale's office scene is playing and the player is in the office
- **WHEN** the player walks out of the office before Jay's "Everything all right, Director?"
- **THEN** that line is never said, and none of Hale's later lines are said either

#### Scenario: Leaving mid-line
- **WHEN** the player leaves the room while Hale is saying a line
- **THEN** Hale finishes that line, quieter and muffled as the player walks away, and nothing after it plays

#### Scenario: Jay greeting a passer-by
- **GIVEN** a lab researcher walks across the Commons and Jay greets them after a few seconds
- **WHEN** the player leaves the Commons before the greeting, or between the two greetings
- **THEN** Jay says no more, even though nobody else in the scene is speaking

#### Scenario: Leaving through the door and standing outside it
- **WHEN** the player steps just outside the open office door while the scene is playing
- **THEN** the scene ends, even though Hale's voice would still be audible there

#### Scenario: A scene that is not tied to a room
- **WHEN** the player leaves the room during a scene that names no room
- **THEN** the scene carries on as before

## ADDED Requirements

### Requirement: A scene may belong to several rooms
A sequence MAY name more than one room for its scene. The player SHALL count as inside while standing in any of them, and the scene SHALL end only when the player is in none. Naming one room behaves as before.

#### Scenario: Walking from the vestibule into the hall
- **GIVEN** a scene belongs to a vestibule and the hall beyond it, and it starts as the player enters the vestibule
- **WHEN** the player walks on into the hall
- **THEN** the scene carries on

#### Scenario: Leaving every room
- **WHEN** the player walks out of both rooms
- **THEN** the scene ends as for a single room

### Requirement: Round conversations are room scenes
The hydroponics greeting, the dive bay briefing, the admin reception greeting and the storeroom remarks SHALL each belong to the rooms where they take place, so they end the moment the player leaves those rooms.

#### Scenario: Leaving hydroponics mid-conversation
- **GIVEN** the botanist has asked about the alarm and Jay's reply is due
- **WHEN** the player walks out of the vestibule and the grow hall
- **THEN** Jay's reply is never said, the botanist says nothing more, and the botanist returns to work

#### Scenario: Leaving the dive bay before the case briefing ends
- **WHEN** the player leaves the wet vestibule and the launch hall while Sung is still speaking
- **THEN** the conversation stops, the sample case trunk is still secured, and Sung does not repeat it on return

#### Scenario: Leaving before the scene starts
- **GIVEN** the player's trigger fires as he passes through a doorway and he is outside the scene's rooms a moment later
- **WHEN** the scene would begin
- **THEN** it does not start and stays available for his next visit

#### Scenario: Staying
- **WHEN** the player stays in the rooms for the whole scene
- **THEN** every line plays as before, with no change in order or timing

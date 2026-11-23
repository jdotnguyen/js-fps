# scene-presence Specification

## Purpose

Lets a conversation scene belong to a room, so it ends for everyone in it the moment the player leaves that room, instead of carrying on to an empty room or to a player who has gone elsewhere.

## Requirements

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

### Requirement: An ended room scene tidies up after itself
When a room scene ends because the player left, what was left of it SHALL land on its end state as a skipped scene does: an NPC it spawned for the scene is removed, and a flag or objective it sets is set. Lines it did not get to say count as heard and are not said later.

#### Scenario: The walk-by researcher
- **WHEN** the player leaves the Commons while the lab researcher is crossing it
- **THEN** the researcher is gone, nobody is left standing there, and the scene counts as seen

### Requirement: Speakers return to idle when a room scene ends
When a room scene ends because the player left, each NPC speaking in it SHALL stop gesturing and SHALL stop looking at the player or another speaker, and SHALL return to its idle behaviour.

#### Scenario: Hale mid-gesture
- **WHEN** the player leaves while Hale is talking with his hand gesture and looking at Jay
- **THEN** Hale drops the gesture and the look, and idles at his desk

### Requirement: An ended room scene stays finished
A room scene that ended because the player left SHALL NOT restart or resume when the player comes back, and a scene that plays once SHALL NOT play again. The scene's other effects that do not depend on dialogue, such as the card on the Director's desk, SHALL stay available.

#### Scenario: Coming back
- **GIVEN** Hale's office scene ended because Jay left
- **WHEN** Jay walks back into the office
- **THEN** the scene does not restart, Hale stays quiet, and the card is still on his desk

#### Scenario: Leaving after the scene finished
- **WHEN** the player leaves the office after the whole scene has played
- **THEN** nothing changes, since the scene had already ended

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

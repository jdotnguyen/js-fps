# Spec Delta

## Purpose

Lets a conversation scene belong to a room, so it ends for everyone in it the moment the player leaves that room, instead of carrying on to an empty room or to a player who has gone elsewhere.

## ADDED Requirements

### Requirement: A room scene ends when the player leaves its room
A sequence MAY name the room its scene belongs to. While it runs, whenever the player is not inside that room, the scene SHALL end: every line it is playing stops with its subtitle, every line it has queued is dropped, and the sequence is released. A scene with no speaker but Jay, such as a greeting to a passer-by, ends the same way. Standing in a doorway that belongs to the room counts as inside.

#### Scenario: Leaving Hale's office mid-scene
- **GIVEN** Hale's office scene is playing and the player is in the office
- **WHEN** the player walks out of the office before Jay's "Everything all right, Director?"
- **THEN** that line is never said, and none of Hale's later lines are said either

#### Scenario: Leaving mid-line
- **WHEN** the player leaves the room while Hale is saying a line
- **THEN** that line stops at once, its subtitle hides, and nothing after it plays

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

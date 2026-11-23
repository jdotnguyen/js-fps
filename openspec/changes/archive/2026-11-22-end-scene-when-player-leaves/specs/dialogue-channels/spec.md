# Spec Delta

## MODIFIED Requirements

### Requirement: Jay answers the conversation he can hear
When Jay's line is due on a channel whose other speakers are all out of earshot, it SHALL be dropped, and that conversation SHALL continue without it. A Jay line due while he is already speaking SHALL wait for his current line, as for any speaker. A scene tied to a room ends instead when the player leaves it, as scene-presence defines.

#### Scenario: Leaving a conversation that is not tied to a room
- **WHEN** a scene that names no room reaches Jay's line after the player has walked out of earshot of the other speaker
- **THEN** Jay does not say it, and the other speaker's next line follows on cue

#### Scenario: Leaving Hale's office mid-scene
- **WHEN** the player leaves Hale's office before Jay's "Everything all right, Director?"
- **THEN** the scene ends for everyone, as scene-presence defines

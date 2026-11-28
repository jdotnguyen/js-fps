# Spec Delta

## MODIFIED Requirements

### Requirement: Sequence sound steps
Sequences SHALL be able to play a named sound (optionally at a world position), set the ambience, and start or stop the radio. A `music` step SHALL either control the music or be rejected when content is validated; it SHALL NOT be skipped silently at runtime. A sound step MAY ask to land on the score's next beat; it SHALL then play on that beat, or at once when no score is playing.

#### Scenario: Positional sequence sfx
- **WHEN** a sequence runs `{ "do": "sfx", "id": "klaxon", "at": "R03" }`
- **THEN** the klaxon plays from R03

#### Scenario: Music step
- **WHEN** a sequence contains a `music` step
- **THEN** it either changes the music or the content check fails, naming the step

#### Scenario: Klaxon on the beat
- **WHEN** the Lab B score plays and a sequence runs a klaxon step that asks for the beat
- **THEN** the klaxon starts on the score's next beat, no more than one beat later

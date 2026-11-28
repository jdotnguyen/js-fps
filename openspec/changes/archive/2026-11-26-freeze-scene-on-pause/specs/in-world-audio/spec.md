# Spec Delta

## MODIFIED Requirements

### Requirement: Ambience follows the game mode
Ambience SHALL be silent on the title screen, held while the scene is frozen (see `game-pause`), and at full level during play.

#### Scenario: Back to title
- **WHEN** the player returns to the title screen
- **THEN** the room ambience fades out and only the menu music remains

#### Scenario: Pause and resume
- **WHEN** the player pauses and later resumes
- **THEN** the room ambience is silent while paused and carries on at full level from where it stopped

### Requirement: Sequence sound steps
Sequences SHALL be able to play a named sound (optionally at a world position), set the ambience, and start or stop the radio. A `music` step SHALL either control the music or be rejected when content is validated; it SHALL NOT be skipped silently at runtime. A `music` step MAY set the level its track plays at, from silent to full (the default); naming the playing track again SHALL ease it to the new level without restarting it. Pausing SHALL hold the track with the rest of the scene, and the pause menu SHALL play the menu theme at its own pause level. A sound step MAY ask to land on the score's next beat; it SHALL then play on that beat, or at once when no score is playing.

#### Scenario: Positional sequence sfx
- **WHEN** a sequence runs `{ "do": "sfx", "id": "klaxon", "at": "R03" }`
- **THEN** the klaxon plays from R03

#### Scenario: Music step
- **WHEN** a sequence contains a `music` step
- **THEN** it either changes the music or the content check fails, naming the step

#### Scenario: Music dips under a sound
- **WHEN** the main theme is playing and a sequence runs a `music` step naming it with a lower level
- **THEN** the theme eases down to that level and carries on, and the next `music` step that gives no level plays at full

#### Scenario: Pause during scene music
- **WHEN** the player pauses while a scene has the main theme playing at a lowered level, then resumes
- **THEN** the pause menu plays the menu theme, and the scene's track carries on at its lowered level from where it stopped

#### Scenario: Klaxon on the beat
- **WHEN** the Lab B score plays and a sequence runs a klaxon step that asks for the beat
- **THEN** the klaxon starts on the score's next beat, no more than one beat later

### Requirement: Positional prop loops and synchronized burst sounds
Level props SHALL be able to declare positional looping emitters and fire synchronized positional one-shots. Positional prop loops SHALL follow the game mode (silent on title, held while the scene is frozen, full during play), hot-swap to decoded ElevenLabs recordings, and reset cleanly on level reset or dispose. Prop one-shots SHALL respect distance culling and world sound occlusion through walls, closed doors, and glass partitions.

#### Scenario: Equipment loop respects pause and title
- **WHEN** a room prop runs a positional loop (such as a dehumidifier or kettle simmer) and the player pauses or returns to the title screen
- **THEN** the loop is held while paused, carrying on from the same point on resume, and fades to silence on the title screen

#### Scenario: Prop burst occluded by wall or glass
- **WHEN** a prop fires a synchronized positional one-shot in `R12b` while the player is behind a glass partition in `R12c` or behind a solid wall in `R12e`
- **THEN** the one-shot is lightly muffled through glass and fully muffled through a solid wall or closed door

### Requirement: Murmur sits in the room
Murmur SHALL play on the `ambience` bus and fade with distance. Room boundaries and closed doors SHALL make it quieter, and it SHALL be silent where a local voice would be silent. It SHALL follow the game mode as ambience does.

#### Scenario: Behind a closed door
- **WHEN** the player stands in a neighbouring room with the Commons door closed
- **THEN** the murmur is far quieter than inside the Commons, or silent

#### Scenario: Paused
- **WHEN** the game is paused in the Commons
- **THEN** the murmur stops with the rest of the ambience and carries on from the same point on resume

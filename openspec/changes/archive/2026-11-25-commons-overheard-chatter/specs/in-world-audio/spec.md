# Spec Delta

## ADDED Requirements

### Requirement: Overheard exchanges in the Commons
The Commons bar pair and wall pair SHALL each have one voiced exchange for the time before the briefing (once the intro has ended) and two for the time after it. An exchange SHALL be spoken by the pair as `background` lines in written order, each from its speaker, with a short natural pause between lines. The two SHALL look at each other as in any conversation.

#### Scenario: Lingering at the bar
- **WHEN** the intro has ended and the player stops 3 m from the bar pair
- **THEN** they speak their pre-briefing exchange in order, each voice coming from its own speaker

#### Scenario: After the briefing
- **WHEN** the player returns after the briefing to a pair whose pre-briefing exchange was never heard
- **THEN** the pair speaks only after-briefing exchanges

#### Scenario: During the intro
- **WHEN** the player walks past either pair while the intro is playing
- **THEN** no exchange starts

### Requirement: When an exchange may start
An exchange SHALL start only when the player is in the Commons within 5 m of the pair, both speakers are free to talk, no other exchange is playing, no higher-priority line has been audible for 2 s, no scripted Commons scene is running, the player has free control, and every recording of the exchange is ready. When both pairs qualify, the nearer SHALL speak.

#### Scenario: Between the two pairs
- **WHEN** the player is within 5 m of both pairs
- **THEN** only the nearer pair's exchange plays

#### Scenario: A pause in a Commons scene
- **WHEN** the lab researcher's walk-by is running and no one is speaking at that moment
- **THEN** no exchange starts

#### Scenario: A recording is not ready
- **WHEN** one clip of an exchange has not loaded or is missing
- **THEN** the exchange does not start, no substitute voice sound plays, and the pair keeps murmuring

### Requirement: An exchange plays once
An exchange that has started SHALL NOT play again in that playthrough, including after loading a checkpoint saved later. A pair's second after-briefing exchange SHALL NOT start until at least 20 s after its first ended.

#### Scenario: Coming back
- **WHEN** the player returns to a pair whose exchanges have all played
- **THEN** the pair only murmurs

#### Scenario: Reloading a checkpoint
- **WHEN** the player hears an exchange, a checkpoint is saved afterwards and that checkpoint is loaded
- **THEN** that exchange does not play again

### Requirement: An exchange ends early when it loses its audience
When the player leaves the Commons or moves more than 8 m from the pair, the current line SHALL finish and the rest SHALL be dropped. When a line is cut off by a higher-priority line, or a speaker stops being free to talk, the rest SHALL be dropped at once. Either way the exchange counts as played.

#### Scenario: Walking away mid-exchange
- **WHEN** the player walks 10 m from the bar pair during the second line
- **THEN** that line finishes, fading with distance, and the third line is never said

#### Scenario: Interrupted by the squad
- **WHEN** Giles speaks within earshot during an exchange
- **THEN** the exchange stops and does not resume after his line

### Requirement: Voiced pairs stay put
Until the drop starts, the members of both voiced pairs SHALL stay at their places and SHALL NOT wander to other seats.

#### Scenario: A long stay in the Commons
- **WHEN** five minutes pass before the drop
- **THEN** both pairs are still together where they started, while other crew may have changed seats

### Requirement: Conversation murmur
Every Commons conversation with at least two people taking part SHALL give a soft, wordless murmur from where they are, whether it is a set pair or a table group formed as crew move. It SHALL fade in and out over about 1 s as the conversation forms or breaks up, and two groups SHALL NOT sound identical.

#### Scenario: Walking through the lounge
- **WHEN** two table groups are talking on opposite sides of the player
- **THEN** a murmur is heard from each side, with no intelligible words

#### Scenario: A group breaks up
- **WHEN** a member walks off and only one person is left
- **THEN** that murmur fades out

### Requirement: Murmur makes way for an exchange
While a pair is speaking an exchange its own murmur SHALL be silent and other murmurs SHALL be quieter, returning when the exchange ends.

#### Scenario: The bar pair starts talking
- **WHEN** the bar pair's exchange begins
- **THEN** their murmur stops, the nearby wall murmur drops, and the words are easy to follow

### Requirement: Murmur sits in the room
Murmur SHALL play on the `ambience` bus and fade with distance. Room boundaries and closed doors SHALL make it quieter, and it SHALL be silent where a local voice would be silent. It SHALL follow the game mode as ambience does.

#### Scenario: Behind a closed door
- **WHEN** the player stands in a neighbouring room with the Commons door closed
- **THEN** the murmur is far quieter than inside the Commons, or silent

#### Scenario: Paused
- **WHEN** the game is paused in the Commons
- **THEN** the murmur drops with the rest of the ambience

### Requirement: Commons talk ends at the drop
From the moment the drop starts, no overheard exchange SHALL start and no conversation murmur SHALL play for the rest of the playthrough.

#### Scenario: Loading a checkpoint saved after the drop
- **WHEN** a checkpoint saved after the drop is loaded and the player is within earshot of the Commons
- **THEN** no exchange or murmur is heard

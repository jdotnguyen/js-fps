# runtime-memory Specification

## Purpose

Defines how much memory a running game tab may use, that the amount stays flat over a play session, and how it is measured, so the game can run alongside development tools on one machine.

## Requirements

### Requirement: No memory growth over a session
A scripted play session SHALL return to its post-load level. After 10 minutes of repeated enemy spawns, kills and gore, then all enemies removed and gore settled, JS heap after a forced garbage collection SHALL be within 10% of the post-load value. Live GPU textures and buffers SHALL be within 5% of the post-load count.

#### Scenario: Enemy churn
- **WHEN** waves of 8 shamblers are spawned and killed for 10 minutes, then every enemy is removed
- **THEN** the JS heap after garbage collection is within 10% of the value taken right after the level loaded
- **AND** the number of live GPU textures and buffers is within 5% of the post-load count

#### Scenario: Restart from checkpoint
- **WHEN** the player restarts from the same checkpoint five times
- **THEN** JS heap and live GPU resource counts after the fifth restart match the first within the same tolerances

### Requirement: Steady-state memory is recorded
The steady-state JS heap, GPU texture memory and decoded audio memory of the heaviest scene at High SHALL be measured in a scratch session with the memory probe (load, enemy churn, remove all, settle, sample) and recorded in the design of the change that measures them. A change that raises any of them by more than 15% SHALL say so and give the reason.

#### Scenario: A change adds a texture set
- **WHEN** a change adds a new photo texture set to the slice
- **THEN** the change re-measures GPU texture memory with the documented procedure and records the new figure

### Requirement: Measurement does not touch player saves
Automated memory sessions SHALL be able to start, play, restart from checkpoints and finish without reading or writing the player's save slots.

#### Scenario: Scratch session
- **WHEN** the game is opened with the scratch save slot and a session starts a new game and restarts from a checkpoint
- **THEN** every save slot stored before the session is byte-for-byte unchanged afterwards
- **AND** no new save slot is created

### Requirement: Returning to the title screen releases session memory
Quitting an active play session back to the title screen SHALL dispose the session's GPU resources, level geometry, textures, navmesh, physics world, and decoded voice-over buffers so memory returns near the title-screen shell baseline, and repeating a New Game -> Quit to title cycle SHALL NOT accumulate memory across sessions.

#### Scenario: Quit to title after playing
- **WHEN** a scratch session with `?slot=scratch&memprobe` starts a new game, plays briefly, and quits to the title screen
- **THEN** all session WebGL textures, buffers, render targets, and decoded voice-over buffers are released
- **AND** after garbage collection, JS heap releases at least 85% of the active session heap and stays within 15% of the warm post-first-import title baseline across repeated quits

#### Scenario: Repeated session cycles
- **WHEN** a scratch session starts a new game, quits to title, and repeats the cycle three times
- **THEN** post-load JS heap and live GPU resource counts on the third session remain within 10% of the first session

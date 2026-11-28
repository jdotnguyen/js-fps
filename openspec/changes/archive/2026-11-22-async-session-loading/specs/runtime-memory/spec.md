# Spec Delta

## ADDED Requirements

### Requirement: Returning to the title screen releases session memory
Quitting an active play session back to the title screen SHALL dispose the session's GPU resources, level geometry, textures, navmesh, physics world, and decoded voice-over buffers so memory returns near the title-screen shell baseline, and repeating a New Game -> Quit to title cycle SHALL NOT accumulate memory across sessions.

#### Scenario: Quit to title after playing
- **WHEN** a scratch session with `?slot=scratch&memprobe` starts a new game, plays briefly, and quits to the title screen
- **THEN** all session WebGL textures, buffers, render targets, and decoded voice-over buffers are released
- **AND** after garbage collection, JS heap releases at least 85% of the active session heap and stays within 15% of the warm post-first-import title baseline across repeated quits

#### Scenario: Repeated session cycles
- **WHEN** a scratch session starts a new game, quits to title, and repeats the cycle three times
- **THEN** post-load JS heap and live GPU resource counts on the third session remain within 10% of the first session

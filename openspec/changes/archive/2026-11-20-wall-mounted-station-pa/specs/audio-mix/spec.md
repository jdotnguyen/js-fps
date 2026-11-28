# Spec Delta

## MODIFIED Requirements

### Requirement: Local sounds sit in the room

Positional sound effects, local dialogue and Station PA announcements SHALL send part of their signal to the current room reverb. Radio dialogue and UI sounds SHALL stay dry. The voice volume setting SHALL control both the direct and reverberant sound of a PA announcement.

#### Scenario: Squadmate speaks in a hall

- **WHEN** a squadmate speaks on the local channel inside a `metal_hall` room
- **THEN** their voice carries that room's reverb

#### Scenario: Announcement in the Docking Ring

- **WHEN** the wall speaker announces Halcyon at the post
- **THEN** a short audible reflection places the voice in the hall while the grille remains easy to locate by ear

#### Scenario: Player mutes voices

- **WHEN** voice volume is set to zero before a PA announcement
- **THEN** the announcement and its room reflections are silent

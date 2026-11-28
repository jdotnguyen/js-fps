# Spec Delta

## ADDED Requirements

### Requirement: Resuming from pause restores nothing
Returning to play from the pause menu, the map or a lost window focus SHALL NOT run restore sequences. Restore sequences
SHALL run only when play starts from the title (a new game, Continue or Load game) or after a death restart.

#### Scenario: Resume after a pause
- **WHEN** the player alt-tabs away during the security office scene and then returns to play
- **THEN** Priya stays where the scene put her, the intercom stays as it was, and `D_R06_R07` stays sealed

#### Scenario: Death restart still restores
- **WHEN** Jay dies and restarts at a checkpoint
- **THEN** the restore sequences run as before

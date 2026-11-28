# Spec Delta

## MODIFIED Requirements

### Requirement: Mix buses
Every sound SHALL play on exactly one of five buses: `sfx`, `voice`, `music`, `ambience` or `ui`. All buses SHALL feed a master stage that follows the master volume setting; scene sound and menu sound MAY have separate master stages so that one can be held while the other plays. No sound SHALL reach the output while bypassing a master stage.

#### Scenario: Dialogue on the voice bus
- **WHEN** a dialogue line plays, on either the local or the radio channel
- **THEN** it is heard through the `voice` bus, and changing the voice volume changes its level

#### Scenario: Diegetic music is ambience
- **WHEN** the in-world TAG FM radio plays
- **THEN** it is on the `ambience` bus, not the `music` bus

#### Scenario: Master volume reaches menu sound
- **WHEN** the player sets master volume to 0% in the pause menu
- **THEN** the menu theme and interface sounds are silent, and scene sound is silent after resume

### Requirement: Master limiter
Every master stage SHALL end in a limiter so that the mix never clips at the output, however many sounds play at once.

#### Scenario: Gunfight peak
- **WHEN** a shotgun blast, several zombie groans and a story line play at the same moment
- **THEN** the output does not clip

### Requirement: Pause ducking
While the pause menu, the map or a save station screen is open, the menu theme and interface sounds SHALL play at about 45% of the master setting. Scene sound is held rather than reduced (see `game-pause`) and SHALL return at full level on resume.

#### Scenario: Open the pause menu
- **WHEN** the player pauses during play
- **THEN** the scene falls silent and the menu sounds play at about 45% of the master setting

#### Scenario: Resume
- **WHEN** the player resumes
- **THEN** scene sound is back at 100% of the master setting at once, without fading up from a quieter pause level

# Spec Delta

## ADDED Requirements

### Requirement: Shipped clips say their line
The recording wired to a spoken dialogue line SHALL contain that line's words, all of them, and no words from another line. This applies to every line the game can play. Non-verbal reactions are exempt.

#### Scenario: A line next to another in the same take
- **WHEN** Jay says "They're powdered, Giles. You ask every single morning." in the intro
- **THEN** the recording ends with that line, and "What's in it?" is heard only in the dive bay, as its own line

#### Scenario: A line with a pause inside it
- **WHEN** Heins says "Blinds up. Hale wants eyes on it. Nobody touches the glass."
- **THEN** the whole line is in one recording, and the next recording starts with her next line

### Requirement: New takes are checked before they ship
Before a newly cut dialogue clip replaces a shipped clip or is wired to a line, voice generation SHALL transcribe it and compare it with the line's text. A clip with words missing or added SHALL be held back and reported with what was heard, leaving the shipped clip and the line unchanged. The author SHALL be able to accept a held clip by naming it, after listening.

#### Scenario: A bad cut
- **WHEN** a generated clip also contains the start of the next line
- **THEN** it is not written over the shipped clip, and the run reports its line id, the expected text and the heard text

#### Scenario: A misheard name
- **WHEN** a held clip is correct and the author accepts it by its line id
- **THEN** it ships and is wired like any other clip

#### Scenario: No speech-to-text available
- **WHEN** generation runs on a machine without the speech-to-text model
- **THEN** the run states that its clips are unchecked, naming each one, and does not report them as verified

#### Scenario: A non-verbal line
- **WHEN** the line is only a gasp, a scream or a bracketed sound
- **THEN** it is not compared with its text

### Requirement: Raw batch recordings are kept
Voice generation SHALL NOT destroy an earlier raw batch recording. When a new recording takes the same batch name, the earlier one SHALL remain available for re-cutting.

#### Scenario: Two retakes for one speaker
- **WHEN** a speaker's lines are retaken twice, in separate runs
- **THEN** both raw recordings exist afterwards, and re-splitting without new voice requests uses the newer one

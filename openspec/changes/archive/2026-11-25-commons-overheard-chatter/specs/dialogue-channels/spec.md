# Spec Delta

## ADDED Requirements

### Requirement: Background lines give way to every other line
A `background` line SHALL rank below `idle`. It SHALL NOT start while any higher-priority line the player can hear is playing, and a higher-priority line starting within earshot SHALL cut off every background line at once. A background line that cannot start within 2 s SHALL be dropped. Higher-priority lines the player cannot hear SHALL NOT affect it.

#### Scenario: A story line starts
- **WHEN** Giles calls "Jay, come on" within earshot while a crew member is mid-line in a background exchange
- **THEN** the background line stops at once with its subtitle, and Giles's line plays

#### Scenario: A squad bark or hint starts
- **WHEN** an idle bark or a hint starts within earshot during a background line
- **THEN** the background line is cut off and the bark or hint plays

#### Scenario: Waiting behind speech
- **WHEN** a background line is due while an audible story line has more than 2 s left
- **THEN** the background line is dropped and never plays late

#### Scenario: A far-off scene
- **WHEN** a story line is playing out of earshot
- **THEN** a background line starts as usual

### Requirement: Background lines do not hold back barks or hints
Barks, hints and their quiet timers SHALL behave as though no one were speaking while only background lines play.

#### Scenario: Idle bark timer
- **WHEN** the player stands in the Commons for 75 s of otherwise quiet play while background exchanges are heard
- **THEN** the squad's idle bark comes due as it would in silence

### Requirement: Background lines leave the mix and bystanders alone
A background line SHALL NOT duck music or ambience, and SHALL NOT make any character outside its conversation turn to look at the speaker or turn the player's view. The speaker's mouth and gestures SHALL still act the line.

#### Scenario: Music under background talk
- **WHEN** a background line plays beside the player
- **THEN** music and ambience levels do not change

#### Scenario: Bystanders stay as they are
- **WHEN** a background line plays 2 m from another seated group
- **THEN** nobody in that group turns to look at the speaker
- **AND** the speaker's mouth moves with the line

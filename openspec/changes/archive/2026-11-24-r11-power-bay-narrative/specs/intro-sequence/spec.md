# Spec Delta

## MODIFIED Requirements

### Requirement: Walk to the kitchen on rails
When Jay leaves the booth, he SHALL walk on rails from his post to the kitchen in R02, leaving by the booth's open side. Giles and Okafor walk ahead to the kitchen counter. During the walk, the quarantine PA SHALL play over the squad's banter, with no forearm-rub tell or injury check from Okafor.

#### Scenario: The walk
- **WHEN** Okafor's kitchen line ends
- **THEN** Jay walks on rails from `post_front` to `kitchen_stand`, and the squad arrives at the counter

#### Scenario: Blocked walk
- **WHEN** Jay's walk is blocked and he has not arrived within the walk's timeout
- **THEN** he is placed at `kitchen_stand` and the intro continues

#### Scenario: PA over the banter
- **WHEN** the quarantine PA plays during the walk
- **THEN** it plays at once over the squad's lines, and both subtitles show together with the PA above

#### Scenario: No forearm-rub foreshadowing on the walk
- **WHEN** the squad walks from the booth to the kitchen counter
- **THEN** Giles does not play `rub_forearm`, `giles_forearm_seen` is not set, and Okafor does not ask about Giles's arm

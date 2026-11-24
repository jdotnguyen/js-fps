# Spec Delta

## ADDED Requirements

### Requirement: Squad pistol carry keeps natural wrist and support-hand alignment
Okafor and Giles SHALL each use a character-calibrated pistol-aiming clip (`okafor_pistol` and `giles_pistol`) so that in `aim_pistol`, both point the pistol level or slightly downward rather than pitched up, Okafor's right wrist sits straight, and both characters' left support hands cup directly beneath their right hand and pistol grip.

#### Scenario: Okafor holds the pistol with a level right wrist and cupped left hand
- **WHEN** Okafor settles into `aim_pistol` with no active `aimTarget`
- **THEN** his pistol barrel pitch is level or slightly downward (-5° to +3°) and his left hand cups beneath his right hand and pistol grip

#### Scenario: Giles aims level and supports the pistol directly beneath his right hand
- **WHEN** Giles settles into `aim_pistol` with no active `aimTarget`
- **THEN** his pistol barrel pitch is level or slightly downward (-5° to +3°) and his left hand cups directly beneath his right hand and pistol grip without protruding past the right hand

### Requirement: Squadmates lower their pistols at idle out of combat
When a squadmate has no active combat target, the squadmate SHALL return to `idle` (lowering the pistol) rather than holding `aim_pistol` while standing idle.

#### Scenario: Combat ends and mates return to idle
- **WHEN** combat ends after `gunDrawn` is true and no enemy target remains
- **THEN** Giles and Okafor transition back to `idle` and hide their pistols until they engage in combat again

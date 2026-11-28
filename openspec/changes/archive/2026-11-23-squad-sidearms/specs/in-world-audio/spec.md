# Spec Delta

## ADDED Requirements

### Requirement: Squad gunshots
Each squad shot SHALL play a squad gunshot from the shooting mate's pistol muzzle. It SHALL be positional and muffled through walls and closed doors as other world sounds are. It SHALL be clearly distinguishable from Jay's own pistol shot, so that covering fire never sounds like Jay firing. Consecutive squad shots SHALL vary in pitch.

#### Scenario: Covering fire to the left
- **WHEN** Giles fires at an infected while standing 3 m to Jay's left
- **THEN** Jay hears a gunshot from the left that is distinct from his own pistol

#### Scenario: Through a door
- **WHEN** Okafor fires on the other side of a closed door
- **THEN** his gunshots are muffled and quieter

### Requirement: Squad brass
Each squad shot SHALL eject a brass casing from the shooting mate's pistol. It SHALL land and sound by the same rules as Jay's brass: timing, the surface where it lands, grates, water, variation, the voice limit and the 8 m range. Squad and player casings SHALL share the 4-voice limit.

#### Scenario: Squad mate on carpet
- **WHEN** Okafor fires while standing on the office carpet, within 4 m of Jay
- **THEN** his casings make the soft carpet tick

#### Scenario: Both firing on deck plate
- **WHEN** Jay and Giles fire pistols together on metal plate
- **THEN** both sets of casings ring, and no more than 4 casing sounds play at once

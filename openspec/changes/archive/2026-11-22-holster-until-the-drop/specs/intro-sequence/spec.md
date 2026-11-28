## ADDED Requirements

### Requirement: Jay is unarmed until the drop
From a new game until the Lab B drop, Jay's pistol SHALL be out of view entirely, and he cannot fire, reload, aim or switch weapons. The held flashlight is unaffected. The drop SHALL draw the pistol into view on its first duct bang, after the blackout and the creature's disappearance, and not before. Loads and restarts SHALL keep the pistol out of view before the drop and armed from the drop checkpoint onward.

#### Scenario: New game
- **WHEN** the intro ends and Jay takes control in the Commons
- **THEN** no pistol is in view and firing, reloading and aiming do nothing

#### Scenario: Briefing and rounds
- **WHEN** Jay walks the briefing and the rounds
- **THEN** no pistol is in view and no weapon prompt appears

#### Scenario: Blackout reveal
- **WHEN** the lights go out in the Observation Gallery and come back with the creature gone
- **THEN** the pistol is still out of view, and it is drawn into view on the first duct bang, before control returns and before the drop checkpoint is taken

#### Scenario: Control returns armed
- **WHEN** the drop ends and Jay regains control
- **THEN** the pistol is available, and the Fire / Reload prompt, which waits for the first enemy contact, has not yet shown

#### Scenario: Load from before the drop
- **WHEN** the player loads a save or restarts after dying in the Commons, the briefing, the rounds, or the drop itself
- **THEN** no pistol is in view

#### Scenario: Load from the drop or later
- **WHEN** the player loads the drop checkpoint or any later save, including a save made after the drop under the earlier behaviour
- **THEN** Jay comes back armed

#### Scenario: Debug jumps
- **WHEN** a developer jumps into the level with `?jump=drop`
- **THEN** no pistol is in view, and a jump to any later stage starts armed

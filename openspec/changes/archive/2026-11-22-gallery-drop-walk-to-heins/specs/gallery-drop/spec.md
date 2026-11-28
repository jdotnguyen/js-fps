# Spec Delta

## Purpose

Defines how the Observation Gallery drop opens and plays: a short controlled walk into the middle of the gallery, facing a Voss who is already distressed, free movement while she changes, and a brief hold at the ambush.

## ADDED Requirements

### Requirement: The drop opens with a short walk to Heins
When Jay has walked a few steps into the Observation Gallery (the briefing's trigger area) after the rounds are done and before the drop has played, the drop SHALL take control of him with letterbox bars and walk him, facing Voss behind the glass, to the middle of the gallery a few feet from Heins. Standing in or peeking through the doorway SHALL NOT start it.

#### Scenario: Jay walks in from anywhere
- **WHEN** Jay walks a few steps into the gallery on the glass side, the middle or the north walkway after the rounds
- **THEN** black bars appear and he walks to the middle of the gallery with his view on Voss

#### Scenario: Jay stands in the doorway
- **WHEN** Jay stands in or peeks through the doorway after the rounds
- **THEN** nothing starts and he keeps control

#### Scenario: Before the rounds are done
- **WHEN** Jay enters the gallery with the rounds unfinished
- **THEN** the drop does not start

### Requirement: Giles and Okafor are beside Jay when the walk ends
During the walk, a squadmate not already in the gallery SHALL be brought inside out of Jay's sight where possible, and both squadmates SHALL stand beside him by the time the walk ends. The drop SHALL NOT depend on them having walked there unaided.

#### Scenario: Squadmates are far behind
- **WHEN** the drop starts while Giles and Okafor are still in the Commons
- **THEN** both are in the gallery beside Jay when the walk ends, and neither appears in front of him

#### Scenario: Squadmates are already in the gallery
- **WHEN** the drop starts with both already inside
- **THEN** they walk naturally to stand beside Jay and are not moved instantly

### Requirement: The door seals behind the group and the blinds are already up
`D_R02_R03` SHALL seal only once Jay and both squadmates are inside the gallery, at the end of the walk. The Lab B blinds SHALL already be up when Jay arrives, raised unseen when the rounds finish, and Heins SHALL NOT announce them.

#### Scenario: Jay arrives to open blinds
- **WHEN** Jay walks in after the rounds
- **THEN** the Lab B blinds are already up and Voss is visible behind the glass

#### Scenario: The door seals after the walk
- **WHEN** the walk ends
- **THEN** the door seals once all three are inside

### Requirement: Voss is already distressed as the drop starts
As the drop starts, Voss SHALL be scratching at her arm and saying she has something under her skin, then keep up her stressed, laboured breathing and scratching until Okafor's line asking who is in there has ended. She SHALL then run to the glass and the kill SHALL go on from there.

#### Scenario: Jay is slow to arrive
- **WHEN** Jay's walk and the squad's catch-up take several seconds
- **THEN** Voss keeps scratching and breathing hard throughout, and does not reach the glass before Okafor's line has ended

#### Scenario: Okafor's line ends
- **WHEN** Okafor finishes asking who is in there
- **THEN** Voss runs to the glass and Okafor says she is seizing as she runs

### Requirement: Jay is free during the Voss kill
After Okafor's line, bars SHALL go away and Jay SHALL be able to move and look freely while Voss changes behind the glass. The camera SHALL NOT be turned toward Voss by the scene. Weapons and interaction SHALL stay off until the ambush. The kill, alarm, lights and spoken lines SHALL keep their timing.

#### Scenario: Jay looks away
- **WHEN** Voss runs to the glass while Jay faces the north wall
- **THEN** his view is not moved, and her lines and the lights still play

#### Scenario: Jay tries to shoot or interact
- **WHEN** Jay presses fire or interact during the kill
- **THEN** nothing happens

### Requirement: A short hold covers the blackout and ambush
At the lights-out, vent and ambush beat the scene SHALL hold Jay's controls for about 3 seconds without bars, then give him the pistol and return full control as before, with the drop checkpoint taken at the end.

#### Scenario: Jay is looking away when the lights go out
- **WHEN** the lights go off while Jay faces the north wall
- **THEN** controls are held for the beat, the pistol is drawn on the first duct bang, then control returns

### Requirement: Loads and skips reach the same end state
Loading a save from before the drop SHALL replay the whole drop. Loading any save after the rounds are done SHALL have the Lab B blinds up. Loading the drop checkpoint or later SHALL leave Giles and Okafor following Jay and the door and blinds in their post-drop state, as today.

#### Scenario: Dying during the drop
- **WHEN** Jay dies during the drop and reloads
- **THEN** the drop starts again from its walk

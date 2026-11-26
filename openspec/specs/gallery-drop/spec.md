# gallery-drop Specification

## Purpose
Defines how the Observation Gallery drop opens and plays: it starts when Jay walks onto the marked spot in the middle of the gallery, facing a Voss who is already distressed, leaves him free while she changes, and holds him briefly at the ambush.

## Requirements

### Requirement: The drop starts when Jay reaches the marked spot
After the rounds are done and before the drop has played, the return objective SHALL mark a spot in the middle of the gallery a few feet from Heins, and the drop SHALL start only when Jay walks onto that spot himself. Entering the gallery, standing in or peeking through the doorway, or walking along the glass or the north walkway away from the spot SHALL NOT start it. The drop SHALL NOT walk Jay, turn his view or show letterbox bars as it starts.

#### Scenario: Jay walks to the marker
- **WHEN** Jay follows the objective marker after the rounds and steps onto the spot in the middle of the gallery
- **THEN** the drop starts where he stands, with no bars, and his movement and view stay his own

#### Scenario: Jay stays away from the spot
- **WHEN** Jay stands in the doorway, walks a few steps in, or stands by the glass away from the spot after the rounds
- **THEN** nothing starts, the marker stays, and he keeps control

#### Scenario: Before the rounds are done
- **WHEN** Jay stands on the spot with the rounds unfinished
- **THEN** the drop does not start

### Requirement: Giles and Okafor join Jay at the spot
When Jay walks a few steps into the gallery after the rounds, and again when the drop starts, a squadmate not already in the gallery SHALL be brought inside out of Jay's sight where possible. When the drop starts, both squadmates SHALL walk to stand beside the spot. The drop SHALL NOT depend on them having walked there unaided, and SHALL NOT bring them in again once it has started.

#### Scenario: Squadmates are far behind
- **WHEN** Jay walks into the gallery while Giles and Okafor are still in the Commons
- **THEN** both are inside the gallery by the time he reaches the spot, and neither appears in front of him

#### Scenario: Squadmates are already in the gallery
- **WHEN** the drop starts with both already inside
- **THEN** they walk naturally to stand beside Jay and are not moved instantly

### Requirement: The door seals behind the group and the blinds are already up
`D_R02_R03` SHALL seal only once Jay and both squadmates are inside the gallery: after Voss's plea and before Okafor asks who is in there, or, if a squadmate was still coming in, right after Okafor's line. The Lab B blinds SHALL already be up when Jay arrives, raised unseen when the rounds finish, and Heins SHALL NOT announce them.

#### Scenario: Jay arrives to open blinds
- **WHEN** Jay walks in after the rounds
- **THEN** the Lab B blinds are already up and Voss is visible behind the glass

#### Scenario: The door seals once all three are in
- **WHEN** Voss has made her plea and Jay, Giles and Okafor are all inside the gallery
- **THEN** the door seals

### Requirement: Voss is already distressed as the drop starts
As the drop starts, Voss SHALL be scratching at her arm and saying she has something under her skin, then keep up her stressed, laboured breathing and scratching until Okafor's line asking who is in there has ended. Okafor SHALL ask only after her plea has ended. She SHALL then run to the glass and the kill SHALL go on from there.

#### Scenario: Okafor waits for her plea
- **WHEN** the drop starts
- **THEN** Voss says it is under her skin, Okafor asks who is in there after she finishes, and she keeps scratching and breathing hard until his line ends

#### Scenario: Okafor's line ends
- **WHEN** Okafor finishes asking who is in there
- **THEN** Voss runs to the glass and Okafor says she is seizing as she runs

### Requirement: Jay is free during the Voss kill
From the start of the drop until the ambush, Jay SHALL be able to move and look freely while Voss changes behind the glass. The camera SHALL NOT be turned toward Voss by the scene. Weapons and interaction SHALL stay off until the ambush. The kill, alarm, lights and spoken lines SHALL keep their timing.

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
- **THEN** the drop starts again from the beginning when he walks back onto the spot

# gallery-drop Specification

## Purpose
Defines how the Observation Gallery drop opens and plays: Voss's laboured breathing reaches Jay through the Lab B intercom as he comes back from the rounds, the drop starts as he walks into the gallery to a Voss who is already distressed, he stays free while she changes, and a brief hold covers the ambush.

## Requirements

### Requirement: Voss is heard before Jay walks in
From the moment the rounds are done until the drop starts, the Lab B intercom SHALL be live and Voss's laboured breathing SHALL repeat from her in Lab B, so that the intercom carries it into the gallery. It SHALL play below her spoken lines. As the intercom speaker hangs in the gallery, Jay SHALL hear it faint and muffled through the closed gallery door from the Commons, opening up as the door slides open and clear once he walks in. Loading a save from after the rounds and before the drop SHALL start the breathing again. It SHALL stop when the drop starts, and the kill's own breathing SHALL take over.

#### Scenario: Coming back through the Commons
- **WHEN** Jay walks through the Commons toward the gallery after the last round
- **THEN** Voss's hard breathing can be heard faintly from the gallery, a dull crackle of intercom through its closed door that clears as the door opens

#### Scenario: A load before the drop
- **WHEN** Jay loads a save taken after the rounds and before the drop
- **THEN** the intercom is live and Voss's breathing repeats until he walks into the gallery

### Requirement: The drop starts as Jay walks into the gallery
After the rounds are done and before the drop has played, the drop SHALL start the moment Jay walks into the Observation Gallery. Standing in the open doorway SHALL NOT start it. The return objective SHALL lead him to the gallery. The drop SHALL NOT walk Jay, turn his view or show letterbox bars as it starts.

#### Scenario: Jay walks in
- **WHEN** Jay steps from the doorway into the gallery after the rounds
- **THEN** the drop starts at once, with no bars, and his movement and view stay his own

#### Scenario: Jay stands in the doorway
- **WHEN** Jay stands in the open doorway after the rounds
- **THEN** nothing starts and the breathing keeps coming through the intercom

#### Scenario: Before the rounds are done
- **WHEN** Jay walks into the gallery with the rounds unfinished
- **THEN** the drop does not start

### Requirement: Giles and Okafor join Jay in the gallery
When the drop starts, and again once Jay has walked a few steps in, a squadmate not already in the gallery SHALL be brought inside out of Jay's sight where possible, and both squadmates SHALL walk to stand by the middle of the gallery, near Jay. The drop SHALL NOT depend on them having walked there unaided, and SHALL NOT bring them in after those two attempts.

#### Scenario: Squadmates are far behind
- **WHEN** Jay walks into the gallery while Giles and Okafor are still in the Commons
- **THEN** both are brought in or walk in without ever appearing in front of him, and take their places near him

#### Scenario: Squadmates are right behind Jay
- **WHEN** the drop starts with both following close behind
- **THEN** they walk naturally to their places and are not moved instantly

### Requirement: The door seals behind the group and the blinds are already up
`D_R02_R03` SHALL seal only once Jay and both squadmates are inside the gallery: after Voss's plea and before Okafor asks who is in there, or, if anyone was still outside, right after Okafor's line or at the lockdown announcement. The Lab B blinds SHALL already be up when Jay arrives, raised unseen when the rounds finish, and Heins SHALL NOT announce them.

#### Scenario: Jay arrives to open blinds
- **WHEN** Jay walks in after the rounds
- **THEN** the Lab B blinds are already up and Voss is visible behind the glass

#### Scenario: The door seals once all three are in
- **WHEN** Voss has made her plea and Jay, Giles and Okafor are all inside the gallery
- **THEN** the door seals

### Requirement: Voss is already distressed as the drop starts
From the end of the rounds until the drop starts, Voss SHALL have stopped typing and stand hunched, holding her arm, also after a load. As Jay walks in, Voss SHALL be scratching at her arm and saying she has something under her skin, then keep up her stressed, laboured breathing and scratching until Okafor's line asking who is in there has ended. While she waits, her hands SHALL scratch fast but the rest of her SHALL move slowly: laboured breathing, weight shifts, and glances at the people behind the glass. Okafor SHALL ask only after her plea has ended. She SHALL then start her staged run to the glass and the kill SHALL go on from there.

#### Scenario: Hunched before Jay arrives
- **WHEN** Jay walks into the gallery after the rounds, or loads a save taken after the rounds and before the drop
- **THEN** Voss is already standing hunched behind the glass, holding her arm, and not typing

#### Scenario: Okafor waits for her plea
- **WHEN** the drop starts
- **THEN** Voss says it is under her skin, Okafor asks who is in there after she finishes, and she keeps scratching and breathing hard until his line ends

#### Scenario: Only her hands are fast
- **WHEN** Voss scratches while waiting for Okafor's question
- **THEN** her scratching hand moves back and forth at least three times a second, while her head and hips move no faster than 0.3 m/s and do not jitter with the scratching

#### Scenario: She looks at them
- **WHEN** she waits for more than 4 s
- **THEN** she glances at least once at Jay or a squadmate in the gallery

#### Scenario: Okafor's line ends
- **WHEN** Okafor finishes asking who is in there
- **THEN** Voss is thrown forward into the bench beside her and starts her staged run, and Okafor says she is seizing as it starts

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
- **THEN** the drop starts again from the beginning when he next walks into the gallery

### Requirement: The drop's lines and lights follow her clock
The drop's lines, lights and alarm that wait on a kill beat SHALL start when that beat begins. A wait that gives up SHALL
be counted from the end of Okafor's question, not from the start of the drop, so a long wait for the squad never starts
a line, light or alarm before its beat.

#### Scenario: Squad far behind
- **WHEN** Okafor's question ends 12 s after the drop started
- **THEN** "She's seizing", the flicker, the alarm and the lines after the burst each start with their own beat, not earlier

#### Scenario: Same timing every run
- **WHEN** the drop runs twice with different squad arrivals
- **THEN** each of those lines, lights and alarms starts at the same time after Okafor's question ends, to within one frame

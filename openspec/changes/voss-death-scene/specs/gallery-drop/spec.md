# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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

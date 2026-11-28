# Spec Delta

## ADDED Requirements

### Requirement: Kill beats can cue the score
A kill beat SHALL be able to fire a named score stinger at an authored time in the beat, the same way it fires sounds.

#### Scenario: Stabs on the palms
- **WHEN** the glass beat plays and Voss's palms hit the glass four times
- **THEN** a score stinger fires at each hit

### Requirement: Creature blows are reported
Each flurry of blows by a creature behind the glass SHALL raise one game event when it starts, so other systems can react
to it.

#### Scenario: Flurry starts
- **WHEN** the creature behind the Lab B glass starts a new flurry
- **THEN** one pound event fires naming the creature

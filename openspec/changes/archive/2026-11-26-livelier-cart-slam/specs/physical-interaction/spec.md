# Spec Delta

## ADDED Requirements

### Requirement: Scripted impacts throw loose objects
With physical interaction on, a kill's impact SHALL be able to throw the loose objects within a set reach of it,
upward and away from the impact, with an authored strength. Each impact SHALL throw each object at most once. A kill
that is skipped or restored SHALL throw nothing.

#### Scenario: Impact throws what is near
- **WHEN** a kill impact with a 0.6 m reach lands beside three loose objects 0.3 m away and one 1 m away
- **THEN** the three near objects are thrown upward and away from the impact, and the far one does not move

#### Scenario: Stronger impact throws further
- **WHEN** the same object is thrown by an impact of strength 1 and, in another run, of strength 2
- **THEN** it travels further from the impact in the second run

#### Scenario: Skipped kill
- **WHEN** a kill with impacts is skipped
- **THEN** no loose object is thrown by its impacts

### Requirement: A scripted pose can be given to loose objects
A skipped or restored kill SHALL be able to put named loose objects at authored resting poses, so the scene shows its
aftermath. The objects SHALL then rest there without moving, whether or not physics is on, until something knocks
them.

#### Scenario: Skipped scene
- **WHEN** a kill that authors resting poses for its loose objects is skipped with physical interaction on
- **THEN** each named object is at its authored pose and stays still

#### Scenario: Physics off
- **WHEN** the same kill is skipped with every physics feature switched off
- **THEN** each named object is drawn at its authored pose

# content-layout Specification

## Purpose

Defines where authored game content lives and how its parts are combined, so agents working on different rooms,
characters, creatures or sounds edit different files and never keep two sources of truth for the same data.

## Requirements

### Requirement: One file per room
Each room of a level SHALL be authored in a file of its own, holding everything about that room: its layout, props,
lights, atmosphere, water, NPCs, anchors, walks, spawns and triggers. Data that spans rooms (doors, vents) and data
about the whole level (start points, checkpoints, map stations) SHALL live in the level's own files, not in a room file.

#### Scenario: Dressing one room touches one room file
- **WHEN** an agent adds a prop and a light to room R16b
- **THEN** the only level data file changed is R16b's room file

#### Scenario: A door between two rooms
- **WHEN** an agent moves the door between R07 and R08
- **THEN** the change is in the level's doors file, and neither room file changes unless its layout changes too

### Requirement: Split level data loads as before
Loading a level SHALL combine its level, doors and room files into the same level data the single level file gave.
The game, the data validator and the headless test loader SHALL all read a level through that combination, and none of
them SHALL depend on which file a field came from.

#### Scenario: Same level after the split
- **WHEN** slice01 is loaded from its split files right after the migration
- **THEN** the combined data equals the data from the old `slice01.json`, field for field

#### Scenario: Validation names the file
- **WHEN** a room file names an unknown kit piece
- **THEN** the validation error names that room's file and the field's path inside it

### Requirement: Room shells are built from the layout
A room's floors, walls and ceilings SHALL be built from its layout (cells, height, finishes, glass edges and extra
pieces placed by hand) and the level's doors whenever the level loads. Built shell pieces SHALL NOT be stored in the
authored data, and no script SHALL write over authored level files.

#### Scenario: Adding a cell
- **WHEN** an agent adds a cell to a room's layout
- **THEN** the next load shows floor and ceiling in the new cell and moves the outer walls to the new edge, with no
  script to run

#### Scenario: A door removes a wall
- **WHEN** a door is placed on a room edge in the doors file
- **THEN** neither room on that edge gets a wall tile there

#### Scenario: Stairs placed by hand
- **WHEN** a room's layout lists stairs as an extra piece
- **THEN** the stairs appear exactly where the layout places them, alongside the built tiles

### Requirement: One folder per character and creature
Each named character SHALL keep its body model, its own poses, its motion profile and its motion-capture pack in a
folder of its own. Each creature SHALL keep its profile and poses in a folder of its own. Poses used by more than one
character SHALL live in shared pose files grouped by family (sitting, leaning, corpses, kills and so on).

#### Scenario: Rigging one character
- **WHEN** an agent retunes Heins's poses and motion profile
- **THEN** the only data files changed are in Heins's folder

#### Scenario: A pose name is used once
- **WHEN** two pose files define the same pose name
- **THEN** loading fails with an error naming both files

### Requirement: Sounds registered by area
Sound definitions SHALL be authored in one file per area of the game (weapons, UI, creatures, a wing of the station
and so on). One index SHALL list the area files. Sound names SHALL stay checked by the type checker, and a name defined
in two area files SHALL fail the checks.

#### Scenario: Adding a sound to an existing area
- **WHEN** an agent adds a flood sound
- **THEN** only the flood area's sound file changes

#### Scenario: Typo in a sound name
- **WHEN** code asks for a sound name that no area file defines
- **THEN** the type check fails

### Requirement: Scene-specific level behaviour in set pieces
Behaviour that belongs to one scene of a level (such as the Lab B floor breaking), rather than a mechanism any room
can use, SHALL live in a set-piece module of its own, plugged into the level through a shared interface. Adding or
changing a set piece SHALL NOT require editing the level's core code.

#### Scenario: A new set piece
- **WHEN** an agent adds a set piece for a new room
- **THEN** the change adds a set-piece module and its registration, and the level's core module is unchanged

### Requirement: Map of where content lives
The repository's agent guidelines SHALL include a map from each kind of work (a room, a character, a creature, a sound,
a set piece, a scene sequence) to the folder that holds it.

#### Scenario: A new agent dressing a room
- **WHEN** an agent reads the guidelines before dressing R02
- **THEN** the map points it to R02's room file

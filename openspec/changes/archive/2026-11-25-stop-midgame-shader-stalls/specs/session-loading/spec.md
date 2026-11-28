# Spec Delta

## ADDED Requirements

### Requirement: No shader program is first compiled during play
From the moment the loading screen fades out until the session ends, the game SHALL NOT compile a shader program for the first time. This holds at the graphics quality the session loaded with. Changing graphics quality during play and using developer tools are exempt.

#### Scenario: Visiting every room
- **WHEN** a High-quality session on the station level has loaded with an empty shader cache and the view visits every room, facing four directions in each
- **THEN** no shader program is compiled during the visit

#### Scenario: A first fight
- **WHEN** enemies of every body model spawn after loading, wade through water, are shot, lose limbs and die
- **THEN** no shader program is compiled during the fight

#### Scenario: Squad far away
- **WHEN** the squad is more than 45 m from the view and then comes back into it
- **THEN** no shader program is compiled in either direction

### Requirement: Warmed shader programs last the session
A shader program prepared during loading SHALL stay available until the session ends, even when nothing on screen or in the world uses it any more.

#### Scenario: The last enemy of a kind is removed
- **WHEN** every enemy and corpse using one body model has been removed and another one spawns later
- **THEN** it appears without compiling a shader program

#### Scenario: Restart from checkpoint
- **WHEN** the player restarts from a checkpoint after a fight
- **THEN** replaying the fight compiles no shader program

### Requirement: Late-appearing models load with the session
Every model a level shows during play, including one that first appears in a scripted scene, SHALL be loaded, uploaded and prepared before the loading screen fades out. If such a model cannot be loaded, the session SHALL still start, and SHALL log a warning naming it.

#### Scenario: The finale creature
- **WHEN** the finale reveals the creature on CAM 10
- **THEN** it appears on that frame without fetching its model, uploading its textures or compiling a shader program

#### Scenario: A model fails to load
- **WHEN** the finale creature's model cannot be fetched during loading
- **THEN** the session reaches gameplay, a warning names the model, and the finale runs without it

### Requirement: First-use shader compiles are reported
In a developer session, every shader program first compiled during play SHALL be logged once with its name, so a regression shows up in a playtest.

#### Scenario: A new material misses the warm-up
- **WHEN** a developer session draws a material during play whose program was not prepared during loading
- **THEN** the console shows one warning naming the program

#### Scenario: A clean session
- **WHEN** a developer session visits every room and every program was prepared during loading
- **THEN** no such warning is logged

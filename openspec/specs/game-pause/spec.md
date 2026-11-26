# game-pause Specification

## Purpose

Defines what holds still and what is still heard while the game is paused or waiting on a tutorial pop-up, so that picture and sound resume together from the moment they stopped.

## Requirements

### Requirement: A frozen scene holds still
The scene SHALL be frozen while the pause menu, the map, a save station screen or a tutorial pop-up is open. While frozen, nothing in the scene SHALL advance: characters, doors, reloads, the weapon, effects, water, surveillance feeds and anything due after an amount of play time. Menus, HUD highlights and interface messages SHALL keep working.

#### Scenario: Pause during a reload
- **WHEN** the player pauses halfway through a reload, waits 10 s and resumes
- **THEN** no reload motion or sound happens during the wait, and the reload carries on from halfway

#### Scenario: Pause while a door slides
- **WHEN** the player pauses while a door is part way open
- **THEN** the door stays part way open and carries on after resume

#### Scenario: Pause during the death fade
- **WHEN** the player pauses after dying and before the restart
- **THEN** the pause menu stays open, and the restart happens only after the player resumes

#### Scenario: Pause during a title card
- **WHEN** the player pauses while a title card is up
- **THEN** the card is still up on resume and stays for the rest of its time

### Requirement: Scene sound holds and resumes in place
When the scene freezes, all scene sound SHALL stop within about 50 ms without an audible click: voices, effects, ambience, loops, scripted music, score, in-world radio, and any fade or echo in progress. On resume each SHALL continue from where it stopped. Nothing SHALL play late or in a burst because of the freeze.

#### Scenario: Pause in the middle of a line
- **WHEN** the player pauses half way through a spoken line and resumes later
- **THEN** the line carries on from the same point, in step with the speaker's mouth and the subtitle

#### Scenario: Long pause
- **WHEN** the player pauses for 60 s while a score and room loops play, then resumes
- **THEN** each carries on from its own position, and nothing that would have fallen due during the pause plays

#### Scenario: A sound waiting for the beat
- **WHEN** the player pauses while a scene sound is waiting to land on the score's next beat
- **THEN** after resume it still lands on that beat

#### Scenario: Volume changed while paused
- **WHEN** the player lowers voice volume in the pause menu and resumes
- **THEN** the held line carries on at the new level

### Requirement: Only the menu is heard from a pause screen
While the pause menu, the map or a save station screen is open, the menu theme and interface sounds SHALL play and no scene sound SHALL be heard. Clicks and key presses on these screens SHALL NOT release held scene sound.

#### Scenario: Pause during a fight
- **WHEN** the player pauses while gunfire, screams and a voice line are sounding
- **THEN** all of them stop, and the menu theme is heard

#### Scenario: Using the pause menu
- **WHEN** the player moves through the pause menu with the mouse and keys
- **THEN** interface sounds play and the scene stays silent

#### Scenario: Opening the map
- **WHEN** the player opens the map while a line is being spoken
- **THEN** the line is held until the map closes

### Requirement: Tutorial pop-ups are silent
While a tutorial pop-up is open, neither scene sound nor the menu theme SHALL play. Dismissing the pop-up SHALL resume picture and sound together.

#### Scenario: Pop-up at first contact
- **WHEN** the Fire / Reload pop-up opens while an enemy is screaming
- **THEN** the scream stops with the picture, and both carry on when the player presses fire or reload

#### Scenario: Pause menu over a pop-up
- **WHEN** the player opens the pause menu while a pop-up is open and then resumes
- **THEN** the menu theme plays while the menu is open, and the pop-up returns with the scene still silent

### Requirement: Leaving the moment discards held sound
Loading a save, restarting or quitting to title while the scene is frozen SHALL discard the held sound. None of it SHALL be heard afterwards.

#### Scenario: Load from the middle of a line
- **WHEN** the player pauses during a line and loads another save
- **THEN** no part of that line or its echo is heard

#### Scenario: Quit to title during a fight
- **WHEN** the player pauses during a fight and quits to title
- **THEN** no gunfire, scream or voice from the fight is heard on the title screen

### Requirement: Hiding the game pauses it
If the game's tab becomes hidden during play, the game SHALL open the pause menu, whether or not it has captured the mouse.

#### Scenario: Switch tabs before capturing the mouse
- **WHEN** the player switches tabs during the intro without having clicked into the game, then returns
- **THEN** the pause menu is open and the intro resumes from where it was left

# in-world-audio Specification

## Purpose

Defines the sounds that come from the station and the things in it: room ambience, the TAG FM radio, doors, footsteps, infected voices and weapons, plus the sequence steps that let scripted scenes control them.

## Requirements

### Requirement: Room ambience presets
Each room SHALL play the ambience preset named in its level data: `hull_hum`, `commons_murmur`, `lab_hum`, `hull_groan`, `office_hvac`, `med_beeps`, `water_drip`, `pipes_knock`, `hydro_misters`, `dive_drip`, `launch_bay`, or `silent`. A missing or unknown name SHALL use `hull_hum`. Changing presets SHALL crossfade over about 2 s.

#### Scenario: Enter the commons
- **WHEN** the player walks from a `hull_hum` corridor into the commons (`commons_murmur`)
- **THEN** the crew murmur bed fades in and the hull hum fades out over about 2 s

#### Scenario: Enter the launch trunk hall
- **WHEN** the player walks from the wet vestibule (`dive_drip`) into the Moon Pool hall (`launch_bay`)
- **THEN** the hydraulic hum and the water moving in the trunk fade in over about 2 s, with occasional winch clunks and pressure pings

#### Scenario: Unknown preset
- **WHEN** a room names an ambience preset that does not exist
- **THEN** `hull_hum` plays and the game keeps running

### Requirement: Living ambience
Each ambience preset SHALL combine looping beds whose level drifts slowly with one-shot sounds (groans, knocks, creaks, pings, beeps, drips) at random intervals and random positions around, above or far from the player. The same one-shot SHALL NOT fire at fixed intervals.

#### Scenario: Standing still in a corridor
- **WHEN** the player stands in a `hull_hum` corridor for two minutes
- **THEN** distant hull groans and knocks are heard at irregular times from different directions, over a bed that never sounds like a static loop

### Requirement: Light buzz follows the lights
Rooms with lit fixtures SHALL have positional fluorescent buzz at up to four fixtures. Flickering fixtures SHALL buzz louder and can spark (`zap`) in time with the flicker. Lamp lights SHALL NOT buzz or zap and SHALL NOT count toward the four.

#### Scenario: Flickering tube
- **WHEN** a fixture in the current room flickers
- **THEN** its buzz is louder than steady fixtures and comes from the fixture's position

#### Scenario: Lamp in a lit room
- **WHEN** the current room has ceiling lights and a lit lamp
- **THEN** buzz comes only from ceiling fixtures and none from the lamp

### Requirement: Ambience follows the game mode
Ambience SHALL be silent on the title screen, reduced to about 35% while paused, and at full level during play.

#### Scenario: Back to title
- **WHEN** the player returns to the title screen
- **THEN** the room ambience fades out and only the menu music remains

### Requirement: Scripted ambience override
A sequence SHALL be able to override the room ambience with a named preset, including `silent`, and clear the override to return to the room's own preset.

#### Scenario: Deliberate silence
- **WHEN** a sequence sets the ambience to `silent` before a scare
- **THEN** the room ambience fades to nothing until the override is cleared

### Requirement: TAG FM radio
The in-world radio SHALL play a named track from a position in the world with a small, old speaker sound (wow and flutter, hiss and crackle, band-limited speaker tone, soft saturation). At most one radio track SHALL play at a time. Starting a track SHALL replace the current one; an unknown track SHALL log a warning and play nothing.

#### Scenario: Radio in the kitchen
- **WHEN** the intro reaches the kitchen and starts `tag_fm_01` at the radio prop
- **THEN** the tune comes from the radio's position with the old-speaker sound, and gets quieter as the player walks away

#### Scenario: Radio moves rooms
- **WHEN** a sequence starts `tag_fm_01` at a second position while it is already playing
- **THEN** it plays only from the new position

### Requirement: Door sounds
Doors SHALL play open and close sounds matched to their kit (pressure slide, glass slide or bulkhead) from the door's position. A door that reverses mid-travel SHALL crossfade into the opposite sound at the matching point. Denied and unlocked feedback SHALL play from the door, and repeated denied attempts within about 0.35 s SHALL play only once.

#### Scenario: Locked door spam
- **WHEN** the player presses use on a locked door five times in quick succession
- **THEN** the denied sound does not machine-gun; it plays at most once per 0.35 s

#### Scenario: Door reverses
- **WHEN** a closing glass door is reopened halfway
- **THEN** the close sound gives way smoothly to the open sound, starting partway in

### Requirement: Footsteps by surface
Footsteps for the player and every body SHALL use the sound bank for the floor surface: concrete, metal plate, grate or rubber. Steps SHALL scale with gait (pivot, walk, jog, shamble, heavy). Each actor SHALL have a slightly different pitch so boots are distinguishable.

#### Scenario: Corridor to grating
- **WHEN** the player walks off a concrete floor onto a grate
- **THEN** the step sounds change from concrete to grate on the first step on the grate

### Requirement: Footstep range and occlusion
Other actors' footsteps SHALL be audible up to 22 m (30 m for heavy steps), fading out from about 13 m so they never cut off abruptly. A step heard through a wall or closed door SHALL be low-passed and quieter.

#### Scenario: Behind a closed door
- **WHEN** an infected walks on the other side of a closed door
- **THEN** its steps are muffled and quieter, and become clear when the door opens

### Requirement: Infected voices
Infected SHALL groan from where they stand when they notice someone, and one infected near the player (within about 24 m) SHALL groan on its own every few seconds. Consecutive groans SHALL NOT repeat the same clip. Infected that are dead, playing dead or getting up SHALL stay silent.

#### Scenario: Ambush stays quiet
- **WHEN** an infected is playing dead near the player
- **THEN** it makes no groan until it wakes

### Requirement: Weapon sounds follow the animation
Weapon handling sounds (magazine out and in, slide, pump) SHALL be triggered by cue points in the weapon animation, not by timers, so sound and motion stay in sync at any frame rate.

#### Scenario: Shotgun pump
- **WHEN** the shotgun fires and its pump animation plays
- **THEN** the rack and slam sounds land on the pump motion

### Requirement: Sequence sound steps
Sequences SHALL be able to play a named sound (optionally at a world position), set the ambience, and start or stop the radio. A `music` step SHALL either control the music or be rejected when content is validated; it SHALL NOT be skipped silently at runtime.

#### Scenario: Positional sequence sfx
- **WHEN** a sequence runs `{ "do": "sfx", "id": "klaxon", "at": "R03" }`
- **THEN** the klaxon plays from R03

#### Scenario: Music step
- **WHEN** a sequence contains a `music` step
- **THEN** it either changes the music or the content check fails, naming the step

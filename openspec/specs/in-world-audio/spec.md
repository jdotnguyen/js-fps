# in-world-audio Specification

## Purpose

Defines the sounds that come from the station and the things in it: room ambience, the TAG FM radio, doors, footsteps, infected voices and weapons, plus the sequence steps that let scripted scenes control them.

## Requirements

### Requirement: Room ambience presets
Each room SHALL play the ambience preset named in its level data: `hull_hum`, `commons_murmur`, `lab_hum`, `hull_groan`, `office_hvac`, `med_beeps`, `water_drip`, `pipes_knock`, `hydro_misters`, `hydro_vestibule`, `hydro_seed_lab`, `hydro_plant_room`, `hydro_storeroom`, `dive_drip`, `launch_bay`, or `silent`. A missing or unknown name SHALL use `hull_hum`. Changing presets SHALL crossfade over about 2 s.

#### Scenario: Enter the commons
- **WHEN** the player walks from a `hull_hum` corridor into the commons (`commons_murmur`)
- **THEN** the crew murmur bed fades in and the hull hum fades out over about 2 s

#### Scenario: Enter the launch trunk hall
- **WHEN** the player walks from the wet vestibule (`dive_drip`) into the Launch Hall (`launch_bay`)
- **THEN** the hydraulic hum and the water moving in the trunk fade in over about 2 s, with occasional winch clunks and pressure pings

#### Scenario: Enter the hydroponics rooms
- **WHEN** the player walks from `R12a` (`hydro_vestibule`) into `R12b` (`hydro_misters`), then into `R12c` (`hydro_seed_lab`) or `R12d` (`hydro_plant_room`)
- **THEN** each room's ambience bed crossfades over about 2 s to match that space

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
The in-world radio SHALL play a named track from a position in the world with a small, old speaker sound (wow and flutter, hiss and crackle, band-limited speaker tone, soft saturation). At most one radio track SHALL play at a time. Starting a track SHALL replace the current one; an unknown track SHALL log a warning and play nothing. The only radio on the station SHALL be the one in the Commons kitchen; no sequence SHALL start a radio track anywhere else.

#### Scenario: Radio in the kitchen
- **WHEN** the intro reaches the kitchen and starts `tag_fm_01` at the radio prop
- **THEN** the tune comes from the radio's position with the old-speaker sound, and gets quieter as the player walks away

#### Scenario: Radio moves rooms
- **WHEN** a sequence starts `tag_fm_01` at a second position while it is already playing
- **THEN** it plays only from the new position

#### Scenario: No radio outside the kitchen
- **WHEN** the content is validated
- **THEN** every radio step that starts a track plays it at the Commons kitchen radio, and the Lab Junction, Hydroponics Storeroom and Sample Store have no radio

#### Scenario: Quiet half after the lab
- **WHEN** the player clears the contact fight and later enters Hydroponics or the dive bay
- **THEN** no radio music plays there

### Requirement: Door sounds
Doors SHALL play open and close sounds matched to their kit (pressure slide, glass slide or bulkhead) from the door's position. A door that reverses mid-travel SHALL crossfade into the opposite sound at the matching point. Denied and unlocked feedback SHALL play from the door, and repeated denied attempts within about 0.35 s SHALL play only once.

#### Scenario: Locked door spam
- **WHEN** the player presses use on a locked door five times in quick succession
- **THEN** the denied sound does not machine-gun; it plays at most once per 0.35 s

#### Scenario: Door reverses
- **WHEN** a closing glass door is reopened halfway
- **THEN** the close sound gives way smoothly to the open sound, starting partway in

### Requirement: Footsteps by surface
Footsteps for the player and every body SHALL use the sound bank for the floor surface: concrete, metal plate, grate,
rubber or water. Steps SHALL scale with gait (pivot, walk, jog, shamble, heavy). Each actor SHALL have a slightly
different pitch so boots are distinguishable. Steps in water SHALL be wading sounds that get heavier with depth.

#### Scenario: Corridor to grating
- **WHEN** the player walks off a concrete floor onto a grate
- **THEN** the step sounds change from concrete to grate on the first step on the grate

#### Scenario: Into the water
- **WHEN** the player walks down the stairs into standing water
- **THEN** the first submerged step plays a splash, and later steps are wading sounds, heavier on each deeper step

### Requirement: Footstep range and occlusion
Other actors' footsteps SHALL be audible up to 22 m (30 m for heavy steps), fading out from about 13 m so they never cut off abruptly. A step heard through a wall or closed door SHALL be low-passed and quieter.

#### Scenario: Behind a closed door
- **WHEN** an infected walks on the other side of a closed door
- **THEN** its steps are muffled and quieter, and become clear when the door opens

### Requirement: World sound occlusion
A one-shot sound effect that comes from a position in the world SHALL be low-passed, quieter and slightly more reverberant when a wall or closed door stands between it and the player, as footsteps are. Low obstacles such as counters and crates SHALL NOT muffle it. Whether it is muffled SHALL be decided when it starts. Looping sounds, ambience, the radio, music, the player's own sounds and sounds from scripted sequences and kills SHALL NOT be muffled this way. Local dialogue SHALL NOT use this rule either: it is muffled continuously by the voice propagation in voice-playback.

#### Scenario: Groan behind a closed door
- **WHEN** an infected groans on the other side of a closed door
- **THEN** the groan is muffled and quieter than the same groan with nothing in between

#### Scenario: Door opened between groans
- **WHEN** the door between the player and a groaning infected opens, and the infected groans again
- **THEN** the new groan is clear

#### Scenario: Low obstacle
- **WHEN** an infected groans behind a waist-high counter in the same room as the player
- **THEN** the groan is not muffled

#### Scenario: A door's own sound
- **WHEN** a door opens or closes, and nothing but that door is between it and the player
- **THEN** its sound is clear from either side of the door

#### Scenario: A door beyond a wall
- **WHEN** a door in another room opens, with a wall between it and the player
- **THEN** its sound is muffled and quieter

#### Scenario: Scripted kill seen through glass
- **WHEN** a scripted kill plays its sounds in a room the player watches through glass
- **THEN** those sounds play as authored, not muffled

#### Scenario: Close source
- **WHEN** a sound plays within 0.6 m of the player
- **THEN** it is never muffled

#### Scenario: Dialogue behind a wall
- **WHEN** a squadmate speaks on the other side of a closed door
- **THEN** the line is muffled by voice propagation, and opening the door mid-line clears it during the line

### Requirement: Glass muffles lightly
A sound heard through a glass partition, with no wall or closed door also in the way, SHALL be only slightly quieter and duller: clearly audible, and much louder and brighter than the same sound behind a wall. This SHALL apply to footsteps and to the world sounds above. A wall or closed door anywhere between the sound and the player SHALL still muffle it fully.

#### Scenario: Monster at the window
- **WHEN** an infected groans or slams 1 m behind a glass partition the player stands 1.5 m in front of
- **THEN** the sound is slightly quieter and duller than with nothing in between, and clearly louder and brighter than through a wall

#### Scenario: Glass with a wall beyond it
- **WHEN** an infected groans in a room beyond a glass partition and a wall
- **THEN** the groan is fully muffled, as through a wall

#### Scenario: Steps behind the glass
- **WHEN** someone walks on the other side of a glass partition
- **THEN** their steps are only slightly quieter and duller

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
Sequences SHALL be able to play a named sound (optionally at a world position), set the ambience, and start or stop the radio. A `music` step SHALL either control the music or be rejected when content is validated; it SHALL NOT be skipped silently at runtime. A sound step MAY ask to land on the score's next beat; it SHALL then play on that beat, or at once when no score is playing.

#### Scenario: Positional sequence sfx
- **WHEN** a sequence runs `{ "do": "sfx", "id": "klaxon", "at": "R03" }`
- **THEN** the klaxon plays from R03

#### Scenario: Music step
- **WHEN** a sequence contains a `music` step
- **THEN** it either changes the music or the content check fails, naming the step

#### Scenario: Klaxon on the beat
- **WHEN** the Lab B score plays and a sequence runs a klaxon step that asks for the beat
- **THEN** the klaxon starts on the score's next beat, no more than one beat later

### Requirement: Positional prop loops and synchronized burst sounds
Level props SHALL be able to declare positional looping emitters and fire synchronized positional one-shots. Positional prop loops SHALL follow the game mode (silent on title, ducked while paused, full during play), hot-swap to decoded ElevenLabs recordings, and reset cleanly on level reset or dispose. Prop one-shots SHALL respect distance culling and world sound occlusion through walls, closed doors, and glass partitions.

#### Scenario: Equipment loop respects pause and title
- **WHEN** a room prop runs a positional loop (such as a dehumidifier or kettle simmer) and the player pauses or returns to the title screen
- **THEN** the loop ducks to pause level while paused and fades to silence on the title screen

#### Scenario: Prop burst occluded by wall or glass
- **WHEN** a prop fires a synchronized positional one-shot in `R12b` while the player is behind a glass partition in `R12c` or behind a solid wall in `R12e`
- **THEN** the one-shot is lightly muffled through glass and fully muffled through a solid wall or closed door

### Requirement: The lockdown alarm is a real station alarm
The drop's alarm SHALL be its own recorded ElevenLabs sound, `lockdownAlarm`: a heavy, industrial, two-tone alarm with a hard attack and a metallic tail that reads as a real emergency, not a synth tone. It is separate from the pump room's looping `klaxon`.

#### Scenario: The drop's alarm
- **WHEN** the drop sequence plays its alarm steps at the gallery glass
- **THEN** the recorded alarm plays from there, on the score's beat as before

### Requirement: Power sounds
A recorded power-down sound SHALL play when the station goes to backup power, and each lit backup lamp SHALL play a low electrical hum from its position while the station is under backup power. Both SHALL be recorded files with no procedural fallback.

#### Scenario: Power fails
- **WHEN** the station switches to backup power
- **THEN** a power-down sound (relays dropping, generators winding down) plays at the player, and the room's light buzz stops

#### Scenario: Walking past a lamp
- **WHEN** the player walks past a lit backup lamp under backup power
- **THEN** its hum gets louder as they approach and fades as they leave

### Requirement: Wading slosh
While a body moves through standing water, it SHALL play a positional slosh loop that follows its speed and depth and
fades out when it stops. Other bodies' slosh SHALL follow the same range and occlusion rules as their footsteps.

#### Scenario: Stopping in the water
- **WHEN** Jay stops moving in the water
- **THEN** his slosh fades out within about half a second, leaving only the water settling

### Requirement: Jumping and landing in water
A jump that starts in water SHALL play a takeoff splash. Landing in water SHALL play a splash scaled to the fall height
in place of the landing footstep. Landing on a dry top after a jump from the water SHALL play that top's landing
footstep followed by water dripping off Jay.

#### Scenario: Jump onto a case
- **WHEN** Jay jumps from the water onto a steel case
- **THEN** a takeoff splash plays, then a metal landing step and dripping

#### Scenario: Landing back in the water
- **WHEN** Jay drops from the case back into the water
- **THEN** a landing splash plays, and no dry landing footstep plays

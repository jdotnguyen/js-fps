# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Positional prop loops and synchronized burst sounds
Level props SHALL be able to declare positional looping emitters and fire synchronized positional one-shots. Positional prop loops SHALL follow the game mode (silent on title, ducked while paused, full during play), hot-swap to decoded ElevenLabs recordings, and reset cleanly on level reset or dispose. Prop one-shots SHALL respect distance culling and world sound occlusion through walls, closed doors, and glass partitions.

#### Scenario: Equipment loop respects pause and title
- **WHEN** a room prop runs a positional loop (such as a dehumidifier or kettle simmer) and the player pauses or returns to the title screen
- **THEN** the loop ducks to pause level while paused and fades to silence on the title screen

#### Scenario: Prop burst occluded by wall or glass
- **WHEN** a prop fires a synchronized positional one-shot in `R12b` while the player is behind a glass partition in `R12c` or behind a solid wall in `R12e`
- **THEN** the one-shot is lightly muffled through glass and fully muffled through a solid wall or closed door

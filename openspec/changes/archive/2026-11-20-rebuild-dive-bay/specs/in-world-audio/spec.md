# Spec Delta

## MODIFIED Requirements

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

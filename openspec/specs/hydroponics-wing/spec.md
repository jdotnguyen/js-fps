# hydroponics-wing Specification

## Purpose
Defines the Hydroponics wing's (`R12a`–`R12e`) living environment and crew behavior: overhead Grow Hall misters and their synchronized spray audio, room-specific mechanical and reactive equipment sounds across the wing, and ambient botanist movement and speech acting.

## Requirements

### Requirement: Staggered Grow Hall mister cycles
The four overhead mister rails in `R12b` (Grow Hall) SHALL run on staggered periods and phase offsets so they do not fire in lockstep. At least one rail SHALL occasionally produce a brief double-puff sputter, matching Wen's remark that the misters have opinions.

#### Scenario: Entering the Grow Hall
- **WHEN** the player stands in `R12b` and watches the four overhead mister rails over 20 s
- **THEN** the rails fire at staggered times rather than all turning on or off on the same frame
- **AND** no two adjacent rails run on identical phase and period

#### Scenario: Active indicator follows the burst
- **WHEN** a mister rail opens its valve to spray
- **THEN** its solenoid status light switches to its active spraying state, and returns to idle once the burst finishes

### Requirement: Soft two-layer mister plumes with gradual dissipation
Each mister rail SHALL render soft, non-square mist plumes directly below its nozzle heads without per-frame CPU vertex buffer uploads. Spray bursts SHALL ramp in smoothly on valve open and SHALL drift and fade out gradually after the valve shuts rather than vanishing on a single frame.

#### Scenario: Valve shutoff dissipation
- **WHEN** a mister rail finishes its spray phase
- **THEN** the emitted vapor lingers and fades out smoothly over at least 1 s instead of disappearing instantaneously

### Requirement: Mister bursts play synchronized positional ElevenLabs audio
When a mister rail starts a burst, it SHALL trigger recorded ElevenLabs valve and spray sounds from that rail's position in `R12b` in sync with the visual spray (and a sputter take when a rail sputters). The burst audio SHALL obey world sound occlusion through walls and glass partitions, and SHALL NOT fire when the player is far outside audible range or the game is not playing.

#### Scenario: Hearing a burst in the Grow Hall
- **WHEN** a mister rail opens while the player is in `R12b`
- **THEN** the solenoid click and pressurized mist spray play from that rail's world position as the plume appears

#### Scenario: Watching through the Seed Lab glass
- **WHEN** a mister rail fires in `R12b` while the player stands in `R12c` looking through the glass partition
- **THEN** the mister burst is heard lightly muffled through the glass, quieter and softer than inside `R12b`

### Requirement: Distinct room and equipment sounds across Hydroponics
Each Hydroponics room SHALL play its own ElevenLabs ambience preset (`R12a`: `hydro_vestibule`, `R12b`: `hydro_misters` without constant baked-in sprayer hiss, `R12c`: `hydro_seed_lab`, `R12d`: `hydro_plant_room`, `R12e`: `hydro_storeroom`) alongside positional equipment loops for trough water trickle, the dehumidifier, fertigation pumps, and the `R12e` kettle. The Storeroom SHALL have no radio and no `hydro_radio` anchor.

#### Scenario: Walking from the Grow Hall into the Storeroom
- **WHEN** the player unlocks `hydro_store` and enters `R12e`
- **THEN** the ambience crossfades from `hydro_misters` to `hydro_storeroom`
- **AND** a soft kettle simmer is audible near the desk, with no radio playing

#### Scenario: Nutrient Room mechanical soundscape
- **WHEN** the player enters `R12d`
- **THEN** the ambience crossfades to `hydro_plant_room`
- **AND** positional dehumidifier and fertigation pump loops play from their equipment

### Requirement: Hydroponics terminal interactions use recorded ElevenLabs audio
Signing the Grow Hall irrigation log (`round:hydro_log`) and resetting the Nutrient Room humidity alarm (`round:hydro_alarm`) SHALL play dedicated ElevenLabs confirmation sounds from the terminal's world position rather than the generic procedural console beep.

#### Scenario: Hydroponics interactions use recorded feedback
- **WHEN** the player signs the irrigation log (`round:hydro_log`) or resets the humidity alarm (`round:hydro_alarm`)
- **THEN** each interaction plays its dedicated ElevenLabs confirmation sound at the terminal position rather than the generic procedural console beep

### Requirement: Reactive humidity fault alarm in the Nutrient Room
The dehumidifier in `R12d` SHALL emit a periodic positional ElevenLabs humidity-fault warning chirp while the humidity fault is active, matching its blinking amber beacon. Resetting the alarm (`round:hydro_alarm`) SHALL silence the chirp immediately, and resetting the level (`level:reset`) SHALL restore the active fault chirp.

#### Scenario: Alarm audible before reset and silent after
- **GIVEN** the player has not yet reset the humidity alarm
- **WHEN** the player enters `R12d`
- **THEN** a periodic warning chirp plays from the dehumidifier while its beacon blinks amber
- **WHEN** the player uses the console to trigger `round:hydro_alarm`
- **THEN** the alarm reset sound plays and the dehumidifier stops chirping

### Requirement: Botanists work and move around Hydroponics
Hydroponics botanists SHALL periodically walk on the navmesh between free work spots emitted by hydroponics props and adopt each spot's work pose on arrival: `botanist_2` (Wen) inside `R12b`, `botanist_1` across `R12b` and `R12d` (opening `D_R12b_R12d` automatically), and `botanist_3` inside `R12c`. No two botanists SHALL double-book a spot, and seated office desk typists (`sit_typing`) elsewhere in the station SHALL remain stationary.

#### Scenario: Watching the Grow Hall and Seed Lab during rounds
- **WHEN** the player spends 45 s in `R12b`
- **THEN** `botanist_1`, `botanist_2`, and `botanist_3` each leave their initial spot at least once, walk along the navmesh to a different free work spot in their allowed room(s), and settle into that spot's pose

#### Scenario: Nutrient Room check
- **WHEN** `botanist_1` picks a free work spot in `R12d`
- **THEN** `botanist_1` walks through `D_R12b_R12d` into `R12d`, settles at the tank or dehumidifier spot, and later returns to a free spot in `R12b`

#### Scenario: Office desk typists stay put
- **WHEN** ambient life runs across the station
- **THEN** seated `sit_typing` office workers in Admin do not leave their desks

### Requirement: Wen's dialogue drives botanist_2's acting and gaze
The dialogue speaker `crew_botanist` SHALL map to `botanist_2`, so Wen's voice lines animate `botanist_2`'s mouth and speech gestures and trigger conversation gaze toward and from `botanist_2`.

#### Scenario: Wen greets Jay on entering Hydroponics
- **WHEN** `hydro_botanist_01` plays on entering Hydroponics
- **THEN** `botanist_2` speaks the line with jaw animation and speech gestures and looks toward Jay when within conversation range

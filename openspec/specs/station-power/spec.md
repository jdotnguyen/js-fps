# station-power Specification

## Purpose

Defines the station-wide power state and the blackout beat that changes it: when main power fails, what the player hears and sees as it goes, how dark the station becomes, and how the state survives checkpoints.

## Requirements

### Requirement: The blackout follows the contact fight
The blackout beat SHALL start once every enemy of `r05_contact` (the Voss creature) and of `r05_trickle` has been resolved, and before door `D_R05_R06` closes and the `cp_contact_clear` checkpoint saves. It SHALL run once per playthrough. Jay keeps full control during it.

#### Scenario: Last trickle monster dies
- **WHEN** the player kills the last `r05_trickle` enemy
- **THEN** the radio chatter starts within 2 s and the player can still move, look and use weapons

#### Scenario: Not twice
- **WHEN** the player reloads `cp_contact_clear` after the blackout
- **THEN** the chatter, PA notice and power-down do not play again

### Requirement: Panicked radio chatter
The beat SHALL open with radio lines from four new speakers calling in incidents in other parts of the station. The calls SHALL come one after another, each starting about 1 s before the previous call ends, at least two SHALL end cut off mid-sentence, and the lines SHALL play on the radio channel with subtitles.

#### Scenario: Chatter over the radio
- **WHEN** the chatter plays
- **THEN** the player hears `radio_ops`, `radio_dock`, `radio_hydro` and `radio_launch` on the radio channel in turn, each call starting 0.5-1.5 s before the one before it ends, never more than two at once
- **AND** each subtitle names the speaker by its station post: "Station Ops", "Docking Ring", "Hydroponics" or "Launch Hall"

#### Scenario: Place names in the calls
- **WHEN** a call names part of the station
- **THEN** it uses a name the station uses, such as "Docking Ring", "Launch Hall" or "launch trunk", and never "moon pool"

### Requirement: Radio speakers and voices
The four radio speakers SHALL be new speakers, each with one locked Gemini TTS voice and one pinned model, recorded in the voice cast like every other speaker.

#### Scenario: Speaker IDs and voices
- **WHEN** the voice cast is read
- **THEN** it lists, all on `gemini-3.8-flash-tts`:
  - `radio_ops`, subtitle "Station Ops", voice `Zephyr`: comms operator trying to keep order
  - `radio_dock`, subtitle "Docking Ring", voice `Algieba`: dock guard, out of breath
  - `radio_hydro`, subtitle "Hydroponics", voice `Erinome`: hydroponics tech, crying, whispering
  - `radio_launch`, subtitle "Launch Hall", voice `Sadaltager`: diver shouting over water

#### Scenario: Voices are new
- **WHEN** the voice cast is checked
- **THEN** none of the four voices is used by any other speaker, and every line from these speakers was generated with its pinned voice and model

### Requirement: A squad reaction and the PA notice
After the chatter, one squad member SHALL react in a single local line. The Station PA SHALL then announce, in its usual calm voice, that main power has failed and that the station is switching to emergency lighting. The notice SHALL be station-wide: it SHALL play from the PA speaker nearest the player, wherever the player is. The Lab Junction SHALL have a PA speaker that also covers Lab B, so the notice is heard wherever the blackout finds the player.

#### Scenario: Notice heard where the player stands
- **WHEN** the PA notice plays while the player is in the Lab Junction
- **THEN** it comes from the PA speaker nearest the player, in the Station PA voice, with the room's reverb

### Requirement: Backup power
When the PA notice ends, the station SHALL switch to backup power with a power-down sound. In backup power every room's main lights SHALL be out and only its backup lights SHALL glow, dimmer than its main lights were. Rooms SHALL be visibly darker than under the drop's red emergency lighting.

#### Scenario: Station goes dark
- **WHEN** the switch to backup power happens
- **THEN** the power-down sound plays and, within 3 s, every room on the station has its main lights off and only its backup lights on

#### Scenario: Darker than the drop
- **WHEN** the Observation Gallery is seen under backup power
- **THEN** its average scene brightness is lower than under the drop's steady emergency tint

#### Scenario: Backup lamps hum
- **WHEN** the player stands near a lit backup lamp under backup power
- **THEN** a low electrical hum comes from it

### Requirement: Every room keeps some light
Under backup power every room SHALL have at least one backup light, so that no room on the critical path is fully black without the flashlight.

#### Scenario: Room with no authored backup light
- **WHEN** a room has no light marked as backup and no emergency beacon
- **THEN** one of its claimed lights acts as its backup light under backup power

### Requirement: The blackout teaches the flashlight
When the station switches to backup power, the flashlight prompt SHALL appear unless the flashlight is already on. It SHALL appear at most once per profile, as before. The blackout SHALL be the only place that raises it; the dive bay's dark corridor, which the player reaches earlier, SHALL NOT.

#### Scenario: Flashlight off
- **WHEN** the station switches to backup power and the flashlight is off on a profile that has not seen the flashlight prompt
- **THEN** the "Flashlight" prompt shows with the player's bound key (F by default)

#### Scenario: Dark corridor before the drop
- **WHEN** the player walks through the dive bay's dark corridor (R13d) during the morning rounds
- **THEN** no flashlight prompt shows

#### Scenario: Flashlight already on
- **WHEN** the station switches to backup power and the flashlight is on
- **THEN** no flashlight prompt shows

### Requirement: Power state survives checkpoints
The power state SHALL be saved with every checkpoint and restored on load. Debug-started sequences that begin after the blackout SHALL start under backup power.

#### Scenario: Reload after the blackout
- **WHEN** the player loads `cp_contact_clear` or any later checkpoint
- **THEN** the station is under backup power from the first frame

#### Scenario: Reload before the blackout
- **WHEN** the player loads `cp_drop`
- **THEN** the station is on main power, with the drop's emergency tint in the gallery and Lab B

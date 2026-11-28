# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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

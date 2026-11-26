# audio-mix Specification

## Purpose

Defines how every sound in the game is mixed: the buses it plays on, the shared master chain, room reverb, 3D positioning, ducking and the volume settings players control.

## Requirements

### Requirement: Mix buses
Every sound SHALL play on exactly one of five buses: `sfx`, `voice`, `music`, `ambience` or `ui`. All buses SHALL feed a master stage that follows the master volume setting; scene sound and menu sound MAY have separate master stages so that one can be held while the other plays. No sound SHALL reach the output while bypassing a master stage.

#### Scenario: Dialogue on the voice bus
- **WHEN** a dialogue line plays, on either the local or the radio channel
- **THEN** it is heard through the `voice` bus, and changing the voice volume changes its level

#### Scenario: Diegetic music is ambience
- **WHEN** the in-world TAG FM radio plays
- **THEN** it is on the `ambience` bus, not the `music` bus

#### Scenario: Master volume reaches menu sound
- **WHEN** the player sets master volume to 0% in the pause menu
- **THEN** the menu theme and interface sounds are silent, and scene sound is silent after resume

### Requirement: Master limiter
Every master stage SHALL end in a limiter so that the mix never clips at the output, however many sounds play at once.

#### Scenario: Gunfight peak
- **WHEN** a shotgun blast, several zombie groans and a story line play at the same moment
- **THEN** the output does not clip

### Requirement: Damage muffle
Taking damage SHALL briefly dull the whole mix with a low-pass filter, then open back up. A new hit while muffled SHALL restart the muffle, not stack it.

#### Scenario: Player is hit
- **WHEN** the player takes a hit
- **THEN** the whole mix is low-passed (around 650 Hz) for about 0.4 s and recovers to full brightness over about 0.25 s

### Requirement: Pause ducking
While the pause menu, the map or a save station screen is open, the menu theme and interface sounds SHALL play at about 45% of the master setting. Scene sound is held rather than reduced (see `game-pause`) and SHALL return at full level on resume.

#### Scenario: Open the pause menu
- **WHEN** the player pauses during play
- **THEN** the scene falls silent and the menu sounds play at about 45% of the master setting

#### Scenario: Resume
- **WHEN** the player resumes
- **THEN** scene sound is back at 100% of the master setting at once, without fading up from a quieter pause level

### Requirement: Story ducking
While a story line plays, the `music` and `ambience` buses SHALL be lowered by about 4 dB and restored smoothly after the line ends. Barks and hint lines SHALL NOT trigger ducking.

#### Scenario: Story line over ambience
- **WHEN** a story line starts while the room ambience plays
- **THEN** the ambience drops by about 4 dB within a fraction of a second and comes back after the line finishes

#### Scenario: Combat bark
- **WHEN** a combat bark plays
- **THEN** music and ambience levels do not change

### Requirement: Room reverb
Each room SHALL apply the reverb preset named in its level data (`metal_corridor`, `metal_hall`, `small_office` or `flooded`). An unknown or missing name SHALL fall back to `metal_corridor`. Changing rooms SHALL crossfade the reverb over about 0.5 s with no click.

#### Scenario: Corridor into hall
- **WHEN** the player walks from a `metal_corridor` room into a `metal_hall` room
- **THEN** the reverb tail audibly lengthens, crossfading over about 0.5 s

#### Scenario: Unknown preset
- **WHEN** a room names a reverb preset that does not exist
- **THEN** the corridor preset is used and the game keeps running

### Requirement: Local sounds sit in the room

Positional sound effects, local dialogue and Station PA announcements SHALL send part of their signal to the current room reverb. Radio dialogue and UI sounds SHALL stay dry. The voice volume setting SHALL control both the direct and reverberant sound of a PA announcement.

#### Scenario: Squadmate speaks in a hall

- **WHEN** a squadmate speaks on the local channel inside a `metal_hall` room
- **THEN** their voice carries that room's reverb

#### Scenario: Announcement in the Docking Ring

- **WHEN** the wall speaker announces Halcyon at the post
- **THEN** a short audible reflection places the voice in the hall while the grille remains easy to locate by ear

#### Scenario: Player mutes voices

- **WHEN** voice volume is set to zero before a PA announcement
- **THEN** the announcement and its room reflections are silent

### Requirement: Positional playback
Sounds with a world position SHALL be spatialised with HRTF panning and distance attenuation, relative to a listener that follows the camera every frame. Sounds without a position SHALL play centred, as if inside the player's head.

#### Scenario: Locate an enemy by ear
- **WHEN** an infected groans behind and to the left of the player
- **THEN** the groan is heard from behind-left and gets quieter as the player moves away

### Requirement: Audio unlock
Audio SHALL start the first time the player clicks, taps or presses a key, as browsers require. Nothing SHALL be lost if sounds are requested before then.

#### Scenario: First input
- **WHEN** the page loads and the player has not interacted yet
- **THEN** no audio plays until the first pointer or key press, after which the game's sound starts

### Requirement: Volume settings
Settings SHALL offer master, music, SFX and voice volume sliders from 0 to 100%. Master SHALL default to 80%. SFX SHALL control the `sfx`, `ambience` and `ui` buses. Changes SHALL apply immediately and persist between sessions.

#### Scenario: Turn voices down
- **WHEN** the player sets voice volume to 0%
- **THEN** dialogue is silent while gunfire, ambience and music are unchanged

#### Scenario: Setting persists
- **WHEN** the player sets music to 20% and reloads the page
- **THEN** music is still at 20%

### Requirement: Fixed mix sample rate
The audio engine SHALL run at 48 kHz whatever the output device's rate, so decoded and generated audio takes the same memory on every machine. If the browser refuses that rate, the engine SHALL fall back to the device rate, log one warning and keep playing.

#### Scenario: 192 kHz headset
- **WHEN** the game starts on Windows with a 192 kHz USB headset as the default output
- **THEN** the audio context runs at 48 kHz and decoded audio takes the same memory as on a 48 kHz device
- **AND** sound plays normally through the headset

#### Scenario: Rate refused
- **WHEN** the browser rejects a 48 kHz context
- **THEN** a single `[audio]` warning is logged and audio runs at the device rate

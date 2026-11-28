## ADDED Requirements

### Requirement: Fixed mix sample rate
The audio engine SHALL run at 48 kHz whatever the output device's rate, so decoded and generated audio takes the same memory on every machine. If the browser refuses that rate, the engine SHALL fall back to the device rate, log one warning and keep playing.

#### Scenario: 192 kHz headset
- **WHEN** the game starts on Windows with a 192 kHz USB headset as the default output
- **THEN** the audio context runs at 48 kHz and decoded audio takes the same memory as on a 48 kHz device
- **AND** sound plays normally through the headset

#### Scenario: Rate refused
- **WHEN** the browser rejects a 48 kHz context
- **THEN** a single `[audio]` warning is logged and audio runs at the device rate

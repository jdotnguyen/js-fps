## MODIFIED Requirements

### Requirement: Damage muffle
Taking damage SHALL briefly dull the mix with a low-pass filter, then open back up. Speech on the `voice` bus SHALL stay unfiltered, so Jay's reaction and any line being spoken are heard clearly through a hit; the room reverb, speech's share of it included, SHALL be filtered. A new hit while muffled SHALL restart the muffle, not stack it.

#### Scenario: Player is hit
- **WHEN** the player takes a hit
- **THEN** every bus but `voice` is low-passed (around 650 Hz) for about 0.4 s and recovers to full brightness over about 0.25 s

#### Scenario: Speech through a hit
- **WHEN** Jay's pain reaction or another line plays while the muffle is on
- **THEN** it is heard at full brightness

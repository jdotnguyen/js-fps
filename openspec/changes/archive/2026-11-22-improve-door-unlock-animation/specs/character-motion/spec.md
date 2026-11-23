# Spec Delta

## ADDED Requirements

### Requirement: Door-unlock tasks use standing wall-device choreography
Giles SHALL perform door bypass jobs (`bypass`, `bypass_short`, `bypass_long`, `unlock_locker`) in a standing wall-panel pose (`panel_work`) layered with his `giles_panel` hold while preserving left-forearm injury guarding. Okafor SHALL perform biometric door unlocks (`biometric`) in a standing biometric-scan pose (`biometric_scan`) layered with his `okafor_console` hold, pressing his right palm flat against the vertical wall scanner with his left arm at rest.

#### Scenario: Giles works a wall panel while injured
- **WHEN** Giles performs `panel_work` during a door bypass at infection stage 2 or higher
- **THEN** he remains standing at wall-device height with his `giles_panel` hold active
- **AND** his left hand moves less and more slowly than his right hand while staying on the panel

#### Scenario: Okafor scans a vertical biometric reader
- **WHEN** Okafor performs `biometric_scan` with a vertical wall surface normal supplied to hand IK
- **THEN** his right palm orients flush against the vertical wall surface rather than tilting downward as onto a horizontal desk
- **AND** his left arm stays relaxed at his side

#### Scenario: Ambient crouched work stays intact
- **WHEN** a level placement or sequence explicitly asks for `crouchWork`
- **THEN** the `crouchWork` pose remains available and unchanged

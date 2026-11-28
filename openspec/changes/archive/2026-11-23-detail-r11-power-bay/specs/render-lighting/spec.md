# Spec Delta

## MODIFIED Requirements

### Requirement: A single scripted light
A sequence step SHALL be able to switch one named light on or off, with a pattern, tint, and optional auxiliary circuit `power` scale in `[0, 1]`, without changing any other light in its room. When `power` is omitted under station `backup` power, the light SHALL keep its backup-power circuit scale; when `power` is provided, the named light SHALL use that auxiliary power scale even while the rest of the station remains on `backup` power, and a subsequent switch to `mains` or level reset SHALL clear the override.

#### Scenario: The red beacon
- **WHEN** a sequence switches on the R10 beacon with the `alarm` pattern and emergency tint
- **THEN** the beacon sweeps red while the room's ceiling lights keep their own pattern and colour

#### Scenario: Energizing a single bay light under backup power
- **WHEN** the station is under `backup` power and a sequence step sets a named non-backup light in `R11` to `steady` with `power: 1`
- **THEN** that named light glows and casts real light at full strength while other un-energized lights in `R11` and other rooms remain under `backup` power

#### Scenario: Restoring station mains clears per-light power overrides
- **WHEN** a named light was energized with an explicit `power` override under `backup` power and station power later returns to `mains` or the level resets
- **THEN** the override is cleared and the light returns to normal station-power control

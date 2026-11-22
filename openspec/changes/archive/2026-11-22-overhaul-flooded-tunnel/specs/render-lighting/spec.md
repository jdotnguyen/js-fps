# Spec Delta

## ADDED Requirements

### Requirement: Failing-tube light pattern
Room lights SHALL offer a `failing` pattern: a tube that holds on for several seconds, stutters with a few blinks, and
sometimes goes dark for one to four seconds before stuttering back on. Its brightness SHALL never change more than
three times a second, so it stays the same with reduced flashing on.

#### Scenario: A failing tube over time
- **WHEN** a light with the `failing` pattern is watched for 30 s
- **THEN** it spends most of the time lit, stutters a few times, and goes fully dark at least once before coming back

#### Scenario: Reduced flashing
- **WHEN** reduced flashing is on and a `failing` light stutters
- **THEN** it changes no more than three times in any second, the same as with reduced flashing off

### Requirement: A single scripted light
A sequence step SHALL be able to switch one named light on or off, with a pattern and tint, without changing any other
light in its room.

#### Scenario: The red beacon
- **WHEN** a sequence switches on the R10 beacon with the `alarm` pattern and emergency tint
- **THEN** the beacon sweeps red while the room's ceiling lights keep their own pattern and colour

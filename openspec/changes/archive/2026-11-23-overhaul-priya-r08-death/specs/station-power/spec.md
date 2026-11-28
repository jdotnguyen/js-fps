# Spec Delta

## MODIFIED Requirements

### Requirement: Backup power
When the PA notice ends, the station SHALL switch to backup power with a power-down sound. In backup power every room's main lights SHALL be out and only its backup lights SHALL glow, dimmer than its main lights were. Rooms SHALL be visibly darker than under the drop's red emergency lighting. A room whose level data puts lights on their own circuit, such as the medical bay or the pump room, SHALL keep those lights at their authored strength and colour.

#### Scenario: Station goes dark
- **WHEN** the switch to backup power happens
- **THEN** the power-down sound plays and, within 3 s, every room on the station has its main lights off and only its backup lights on, apart from lights on their own circuit

#### Scenario: Darker than the drop
- **WHEN** the Observation Gallery is seen under backup power
- **THEN** its average scene brightness is lower than under the drop's steady emergency tint

#### Scenario: Backup lamps hum
- **WHEN** the player stands near a lit backup lamp under backup power
- **THEN** a low electrical hum comes from it

#### Scenario: Medical bay on its own circuit
- **WHEN** the station is under backup power
- **THEN** the medical bay's front-row lights glow and light the room at their main-power strength and colour, while the security office and the surgery are on backup lighting

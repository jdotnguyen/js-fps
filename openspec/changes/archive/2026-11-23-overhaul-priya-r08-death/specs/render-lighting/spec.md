# Spec Delta

## MODIFIED Requirements

### Requirement: Backup lights
A claimed light SHALL be a backup light when its level data marks it as backup or when it is an `emergency` slot, such as an `emergency_beacon`'s. A room with no backup light SHALL treat its first claimed light as one. Under backup power only backup lights SHALL glow or cast light. Each glows a dim warm white at no more than 30% of its main-power intensity, except a light whose level data puts it on its own circuit: it SHALL keep its authored backup strength, up to its full main-power intensity, and its own colour.

#### Scenario: Room with a beacon
- **WHEN** a room claims four ceiling lights and an `emergency_beacon` slot, and the station goes to backup power
- **THEN** the four ceiling fixtures show dark diffusers and cast no light, and only the beacon glows

#### Scenario: Room without a backup light
- **WHEN** a room claims slots 0, 2 and 4 with none marked backup, and the station goes to backup power
- **THEN** slot 0 glows dimly and slots 2 and 4 are dark

#### Scenario: Back on main power
- **WHEN** the station returns to main power
- **THEN** every claimed light returns to its own pattern, tint and intensity

#### Scenario: A light on its own circuit
- **WHEN** a room claims a ceiling light that its level data puts on its own circuit at full strength with its own colour, such as the medical bay's key light or the pump room's lights, and the station goes to backup power
- **THEN** that light keeps glowing and casting light at its main-power intensity and colour, while the room's other non-backup lights go dark

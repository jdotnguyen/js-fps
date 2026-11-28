# Spec Delta

## ADDED Requirements

### Requirement: Backup lights
A claimed light SHALL be a backup light when its level data marks it as backup or when it is an `emergency` slot, such as an `emergency_beacon`'s. A room with no backup light SHALL treat its first claimed light as one. Under backup power only backup lights SHALL glow or cast light. Each glows a dim warm white at no more than 30% of its main-power intensity.

#### Scenario: Room with a beacon
- **WHEN** a room claims four ceiling lights and an `emergency_beacon` slot, and the station goes to backup power
- **THEN** the four ceiling fixtures show dark diffusers and cast no light, and only the beacon glows

#### Scenario: Room without a backup light
- **WHEN** a room claims slots 0, 2 and 4 with none marked backup, and the station goes to backup power
- **THEN** slot 0 glows dimly and slots 2 and 4 are dark

#### Scenario: Back on main power
- **WHEN** the station returns to main power
- **THEN** every claimed light returns to its own pattern, tint and intensity

### Requirement: Station power reaches every room
A change of station power SHALL apply to every room, including rooms not currently visible and rooms built after the change. Dark fixtures SHALL free their pooled lights for other lights.

#### Scenario: Room behind a closed door
- **WHEN** the station goes to backup power while the player is in R05, and the player later walks into the Commons
- **THEN** the Commons is already under backup lighting when its door opens

#### Scenario: Pool goes to backup lights
- **WHEN** the station is under backup power
- **THEN** no pooled light is assigned to a light that is out

### Requirement: Scripted light changes under backup power
Under backup power, a scripted light pattern or tint for a room SHALL apply to that room's backup lights only. Its main lights SHALL stay out.

#### Scenario: Flicker during the blackout
- **WHEN** a sequence sets a room to `flicker` under backup power
- **THEN** that room's backup lights flicker and its main lights stay dark

# Spec Delta

## MODIFIED Requirements

### Requirement: Light buzz follows the lights
Rooms with lit fixtures SHALL have positional fluorescent buzz at up to four fixtures. Flickering fixtures SHALL buzz louder and can spark (`zap`) in time with the flicker. Lamp lights SHALL NOT buzz or zap and SHALL NOT count toward the four.

#### Scenario: Flickering tube
- **WHEN** a fixture in the current room flickers
- **THEN** its buzz is louder than steady fixtures and comes from the fixture's position

#### Scenario: Lamp in a lit room
- **WHEN** the current room has ceiling lights and a lit lamp
- **THEN** buzz comes only from ceiling fixtures and none from the lamp

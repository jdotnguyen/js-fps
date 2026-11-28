## MODIFIED Requirements

### Requirement: The blackout follows the contact fight
The blackout beat SHALL start once the creature's passage above R05 has been heard moving off toward R06, and before
door `D_R05_R06` closes and the `cp_contact_clear` checkpoint saves. It SHALL run once per playthrough. Jay keeps full
control during it.

#### Scenario: Last trickle monster dies
- **WHEN** the last bang above R05 has played, on the R06 side of the room
- **THEN** the radio chatter starts within 2 s and the player can still move, look and use weapons

#### Scenario: Not twice
- **WHEN** the player reloads `cp_contact_clear` after the blackout
- **THEN** the chatter, PA notice and power-down do not play again

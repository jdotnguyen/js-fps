# Spec Delta

## ADDED Requirements

### Requirement: Corpses move when touched
With death ragdolls and physical interaction both on, the player's movement and a stomp SHALL push a ragdolled corpse physically, without slowing, blocking or lifting the player.

#### Scenario: Stomp on a corpse
- **WHEN** the player stomps a ragdolled corpse
- **THEN** the corpse is moved by the blow and the player's movement is unchanged

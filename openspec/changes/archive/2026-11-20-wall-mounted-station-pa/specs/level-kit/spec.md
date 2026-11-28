# Spec Delta

## ADDED Requirements

### Requirement: Wall-mounted PA speaker

The level kit SHALL provide a reusable 3D loudspeaker with a shallow metal box, recessed front grille and wall bracket. A placed speaker SHALL expose its grille position as the announcement origin. It SHALL sit high on a wall, face into the occupied space and clear wall structure.

#### Scenario: Look toward the docking announcement

- **WHEN** the player looks toward the Halcyon announcement from the security post
- **THEN** the speaker is identifiable by its box and grille on solid wall beside the dock window

#### Scenario: Move a speaker to another wall

- **WHEN** a level author moves and rotates a speaker to face into a corridor
- **THEN** the sound origin follows the front grille to its new world position using that placement alone

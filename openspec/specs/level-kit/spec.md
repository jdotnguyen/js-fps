# level-kit Specification

## Purpose

Defines behaviour of the modular level-kit pieces that authored rooms depend on: how wall-mounted props sit against wall structure and how floor pieces can combine surfaces.

## Requirements

### Requirement: Wall-mounted props stay clear of wall structure
A wall-mounted prop (screens, posters, notice boards, clocks, monitors) SHALL NOT overlap protruding wall structure such as pilasters, ribs or trim rails. The level tests SHALL check every wall-mounted prop in every level and fail on an overlap, naming the room, prop and wall piece.

#### Scenario: Screen on a panelled wall
- **WHEN** a briefing screen is centred on a panelled wall tile whose mid-bay rib crosses the screen
- **THEN** the level tests fail and name the room, the screen's id and the wall tile

#### Scenario: Screen on a plain wall
- **WHEN** the same screen is centred on a plain wall tile, clear of the tile-end pilasters
- **THEN** the clearance check passes

### Requirement: Carpet floor with a bare metal edge
`floor_carpet` SHALL accept an optional bare edge: a named cell edge and a width. Within that band the floor SHALL show the area palette's floor-trim metal instead of carpet, with the carpet border trim along the seam. Walking on the band SHALL sound like metal.

#### Scenario: Strip along the glass
- **WHEN** a carpet cell sets a 1 m bare edge on the side facing a glass partition
- **THEN** the 1 m nearest the glass is bare metal with a carpet border at the seam, and footsteps change from soft to hard when the player steps onto it

#### Scenario: No bare edge
- **WHEN** a carpet cell sets no bare edge
- **THEN** it looks and sounds exactly as before

### Requirement: Wall-mounted PA speaker

The level kit SHALL provide a reusable 3D loudspeaker with a shallow metal box, recessed front grille and wall bracket. A placed speaker SHALL expose its grille position as the announcement origin. It SHALL sit high on a wall, face into the occupied space and clear wall structure.

#### Scenario: Look toward the docking announcement

- **WHEN** the player looks toward the Halcyon announcement from the security post
- **THEN** the speaker is identifiable by its box and grille on solid wall beside the dock window

#### Scenario: Move a speaker to another wall

- **WHEN** a level author moves and rotates a speaker to face into a corridor
- **THEN** the sound origin follows the front grille to its new world position using that placement alone

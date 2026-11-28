# Spec Delta

## MODIFIED Requirements

### Requirement: Glass partitions show only the room behind them
Seeing through a glass partition SHALL draw the room directly behind it, and SHALL NOT pull in rooms separated from that room by a closed opaque door or by portals outside the narrowed camera view. Sightlines through the glass SHALL continue past that room only through further open or see-through portals that lie within the narrowed camera frustum (or, when no camera frustum is supplied, through further open or see-through portals).

#### Scenario: Gallery seen from Lab B does not pull in the commons
- **WHEN** the player stands in Lab B, the Observation Gallery is drawn through the glass, and the opaque door between the Observation Gallery and the Commons is closed
- **THEN** the Commons is not drawn because of the glass

#### Scenario: Commons looking through open gallery door into Lab B
- **WHEN** the player stands in the Commons facing the open door into the Observation Gallery with Lab B's glass partition visible through the doorway
- **THEN** both the Observation Gallery and Lab B are drawn before the player steps into the Observation Gallery

## ADDED Requirements

### Requirement: Multi-hop sightlines draw through open and see-through portals
When the camera has a line of sight through two or more chained passable portals (open doors, `glass_slide` doors, porthole doors, glass partitions, or open `visibleFrom` boundaries), the level SHALL draw every room along that visible chain without waiting for the camera to enter an intermediate room.

#### Scenario: Looking through chained glass doors in TAG Offices
- **WHEN** the player stands in the Commons facing the TAG Reception glass door (`R02 -> R14a -> R14b -> R14c/R14d`)
- **THEN** TAG Reception, Open Office, and any further glass-connected office visible through the narrowed doorway window are drawn with their walls, props, and lights

#### Scenario: Looking across a vestibule through glass into Grow Hall
- **WHEN** the player stands in the Commons facing the open door into Hydroponics Vestibule (`R12a`)
- **THEN** Hydroponics Vestibule and Grow Hall (`R12b`, behind its glass door) are both drawn before the player crosses into the vestibule

#### Scenario: Closed opaque door stops traversal
- **WHEN** an intermediate room is drawn, and another room connects to it only through a closed opaque door
- **THEN** the room behind the closed opaque door is not drawn

### Requirement: Out-of-frustum portals do not draw unseen rooms
When a camera frustum is supplied (the player camera or a security camera feed), portal traversal SHALL clip each portal quad against the camera frustum and the parent portal's screen-space bounds, and SHALL NOT recurse into rooms reachable only through portals behind the camera or around opaque corners outside the narrowed bounds.

#### Scenario: Room behind the player through an open or glass door
- **WHEN** the player stands in a room facing away from a distant glass door or multi-hop open chain
- **THEN** rooms only reachable through portals outside the camera frustum (and outside the 1-hop light-bleed guard) are not drawn

#### Scenario: Room around an opaque corner through an open doorway
- **WHEN** Room A opens into Room B, Room B has an open or glass portal to Room C around a corner whose projected portal does not overlap the doorway's screen-space bounds from the camera
- **THEN** Room B is drawn and Room C is not drawn

#### Scenario: Security camera feed uses its own frustum
- **WHEN** a security camera feed renders from its room with its camera frustum
- **THEN** rooms visible through chained open or see-through portals inside the feed's frustum are drawn and rooms outside it are culled

### Requirement: Threshold crossing and adjacent light spill stay seamless
Crossing a doorway or panning near an open or see-through portal SHALL NOT cause the room ahead to blink out or nearby spilled light to snap off.

#### Scenario: Straddling a portal near plane
- **WHEN** the camera crosses through an open doorway or approaches within near-plane distance of a glass partition
- **THEN** the portal polygon is clipped against the camera near plane (or treated as full-window when straddling the threshold) so the adjoining room never disappears for a frame

#### Scenario: Panning away from a nearby 1-hop open or glass portal
- **WHEN** the camera stands inside the 1-hop light-bleed margin of an open door or glass partition and pans so the portal exits the screen edge
- **THEN** the directly adjacent room remains active so its spilled light and shadows across the threshold do not snap off

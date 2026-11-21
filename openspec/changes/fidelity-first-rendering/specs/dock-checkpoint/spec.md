# Spec Delta

## MODIFIED Requirements

### Requirement: Security desk and CCTV wall
The booth SHALL contain a desk with keyboards and a wall-mounted bank of six camera feeds behind it on the south wall. One of the six feeds SHALL be the dock airlock camera that the existing `camera:feed` events drive.

#### Scenario: Airlock feed follows camera events
- **WHEN** a `camera:feed` event names the dock post feed with a new state
- **THEN** that screen in the bank switches to the new state

#### Scenario: Room stays inside its draw-call budget
- **WHEN** R01 is built
- **THEN** the six-screen bank costs at most two screen draw calls, and the level tests report R01's draw-call count

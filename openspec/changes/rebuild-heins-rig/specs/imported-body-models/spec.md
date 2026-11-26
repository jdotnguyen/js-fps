# Spec Delta

## ADDED Requirements

### Requirement: Rigid mechanical parts keep their shape
A rigid mechanical part of a named character's body, such as a plate or finger segment of a cybernetic arm, SHALL move with a single joint or finger bone and keep its shape in every pose. A part that runs across a joint, such as a cable, SHALL be able to bend, only near that joint.

#### Scenario: Heins bends her cyber arm
- **WHEN** Heins bends her cybernetic elbow 90 degrees
- **THEN** no rigid part of the forearm or upper arm changes any edge length by more than 2%
- **AND** only parts that run across the elbow bend, near the elbow

#### Scenario: Cyber fingers curl
- **WHEN** Heins closes her cybernetic hand into a grip
- **THEN** each finger segment turns at its joint without stretching

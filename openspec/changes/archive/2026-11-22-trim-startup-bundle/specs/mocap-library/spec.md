# Spec Delta

## MODIFIED Requirements

### Requirement: The library stays within its size limit
The shared clip data loaded when a play session starts SHALL be no larger than 2 MB uncompressed, and SHALL be fetched as its own chunk (startup-bundle: Shared clip data is its own chunk). A character's own clips SHALL be loaded with that character's body when they are not needed at start, and released with it.

#### Scenario: Size check
- **WHEN** the library is built
- **THEN** the shared clip data loaded at session start is 2 MB or less
- **AND** the size of each character's clip set is recorded

#### Scenario: Leaving a level
- **WHEN** every body that uses a character's clips has been removed
- **THEN** that character's clip data is released (runtime-memory: no growth over a session)

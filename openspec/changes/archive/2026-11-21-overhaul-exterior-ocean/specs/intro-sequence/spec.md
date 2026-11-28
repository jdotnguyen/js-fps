# Spec Delta

## MODIFIED Requirements

### Requirement: Opening on the dock
The intro SHALL fade in from black on the Docking Ring with the main theme playing and a caption naming the station, "Docking Ring" and the 06:40 shift change. The view SHALL be framed on the dock window while the supply sub Halcyon docks and clamps on. While it docks, the sub's headlamps and the dock floodlights SHALL light the seabed below it, the player's first look at the ocean. A PA chime and line SHALL announce the docking before the airlock opens. The main theme SHALL stop before the first arrival speaks.

#### Scenario: Sub docks
- **WHEN** the intro starts
- **THEN** the view is framed on `dock_window` while the sub docks, then the PA announces the Halcyon and the airlock opens

#### Scenario: Headlamps light the seabed
- **WHEN** the sub slides in to dock
- **THEN** its two headlamp beams light moving pools on the seabed below it, alongside the dock floodlights' fixed pools

#### Scenario: Theme gives way
- **WHEN** the PA announcement plays
- **THEN** the main theme stops, and no score plays for the rest of the intro

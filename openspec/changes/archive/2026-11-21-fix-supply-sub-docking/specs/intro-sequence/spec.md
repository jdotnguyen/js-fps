# Spec Delta

## MODIFIED Requirements

### Requirement: Opening on the dock
The intro SHALL fade in from black on the Docking Ring with the main theme playing and a caption naming the station, "Docking Ring" and the 06:40 shift change. The view SHALL be framed on the dock window while the supply sub Halcyon docks and clamps on at dock-fit proportions visible inside the window frame. While it docks, the dark ocean SHALL stay near-black, the hull SHALL catch a subtle hint of light from the dock floodlights alongside its running lights, and the sub's two bow spotlights SHALL project visible beams through the water that light moving pools on the seabed below it, the player's first look at the ocean. The sub's approach and docking clamp sounds SHALL play as muffled underwater recordings heard through the station hull. A PA chime and line SHALL announce the docking before the airlock opens. The main theme SHALL stop before the first arrival speaks.

#### Scenario: Sub docks
- **WHEN** the intro starts
- **THEN** the view is framed on `dock_window` while the sub docks and its clamps close within the window's view, then the PA announces the Halcyon and the airlock opens

#### Scenario: Submarine reads subtly in the dark ocean
- **WHEN** the player watches the Halcyon glide into its berth outside the Docking Ring window
- **THEN** the ocean and unlit seabed remain near-black, while a subtle hint of the hull's silhouette and sheen plus its sail running lights read through the glass

#### Scenario: Headlamps light the seabed
- **WHEN** the sub slides in to dock
- **THEN** both bow spotlights sit in view through the dock window, project visible beams through the dark water, and light two moving pools on the seabed below it alongside the dock floodlights' fixed pools

#### Scenario: Docking audio sounds underwater and muffled
- **WHEN** the sub approaches and clamps onto the dock
- **THEN** `subPass` and `subClamp` play as recorded underwater-muffled clips rather than local procedural synths

#### Scenario: Theme gives way
- **WHEN** the PA announcement plays
- **THEN** the main theme stops, and no score plays for the rest of the intro

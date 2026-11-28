# Spec Delta

## Purpose

Defines what the player sees outside the station: one continuous dark ocean with a seabed, lit only by the station and its vessels, real windows where the view matters and sanity screens where the crew lives and works.

## ADDED Requirements

### Requirement: One ocean for the whole station
Everything outside the station SHALL belong to one shared exterior built once per level, not per window. Neighbouring panes SHALL show one continuous scene: the same seabed, rocks, water and lights, seen from each pane's own position.

#### Scenario: Long run of glass
- **WHEN** the player looks along the three-cell dock window in R01
- **THEN** the seabed and rocks continue unbroken across the mullions, with no seams, height steps or repeated rock clusters at pane boundaries

#### Scenario: Nothing duplicated across panes
- **WHEN** any moving thing outside (fish, light, the sub) is visible through two panes at once
- **THEN** it appears once, at one place in the world, not once per pane

### Requirement: No per-window structure outside the glass
Window tiles SHALL NOT place columns, beams or backdrop planes outside the glass. Structure seen outside SHALL be part of the station (its hull, legs or floodlights) or of a vessel.

#### Scenario: No vertical bars
- **WHEN** the player looks straight out of any real window at eye height
- **THEN** no vertical column or bar stands between the glass and the water, and no vertical light streaks show in the water

### Requirement: Dark water with its own fog
The water SHALL be near-black blue. Every exterior surface SHALL fade into the same water colour with distance, whatever room the player is in. The water SHALL show no sunlight cues: no light rays from above and no caustics.

#### Scenario: Same water from every room
- **WHEN** the player looks out of the Docking Ring window, then the Grow Hall window
- **THEN** the water and the distance fade have the same colour and density in both, even though the rooms' own fog differs

#### Scenario: No sunlight
- **WHEN** the player looks up through any window
- **THEN** there are no god-rays, caustic patterns or bright surface glow

### Requirement: Seabed fades instead of ending
The seabed SHALL extend under and around the station beyond the visible distance, and SHALL fade into the water with distance. No edge, cliff or backdrop line SHALL be visible from any window.

#### Scenario: Looking far out
- **WHEN** the player looks out and down from any real window
- **THEN** the seabed grows darker with distance until it is the water colour, with no visible end

#### Scenario: Seabed is not self-lit
- **WHEN** the player looks at seabed outside every lamp's pool
- **THEN** it is near-black, visible only as a faint shape

### Requirement: Floodlights at real windows
Every run of real windows SHALL have at least one hull-mounted floodlight, about one per 7 m of glass. Each SHALL light a soft-edged pool on the seabed, show a faint beam in the water with specks drifting in it, and cast no shadows.

#### Scenario: Lit pool
- **WHEN** the player looks out of the Grow Hall window
- **THEN** one lamp lights a pool of seabed about 10–12 m across in front of the window, fading to black at its edges

#### Scenario: Docking Ring lamp flickers
- **WHEN** the player watches the Docking Ring floodlights for 30 s with reduced flashing off
- **THEN** one lamp dims and recovers briefly at least once, and the others stay steady

#### Scenario: Reduced flashing
- **WHEN** reduced flashing is on
- **THEN** no floodlight flickers

### Requirement: Real windows and sanity screens
R01 (Docking Ring), R01w (Docking Ring Walk) and R12b (Grow Hall) SHALL have real windows onto the ocean. R02 (Commons), R12c (Seed Lab), R14c (Director's Office) and R14d (Boardroom) SHALL have sanity screens over their glass instead: a bright daytime downtown view behind half-open blinds.

#### Scenario: Screen in the Commons
- **WHEN** the player walks into the Commons
- **THEN** the window wall shows a sunny city behind blinds, the view shifts slightly with head movement, and up close it reads as a screen (a faint pixel grid), not as glass

#### Scenario: Screens light the room softly
- **WHEN** the player stands in a screened room
- **THEN** the screens glow without blowing out, and the blinds throw light stripes on the floor in front of them

#### Scenario: No ocean through a screen
- **WHEN** the player looks at a sanity screen from any angle inside the room
- **THEN** no water, seabed, fish or floodlight is visible through or around it

### Requirement: Ocean life at real windows only
Fish and drifting particles SHALL appear only outside real windows, and SHALL fade with the same water fog as the rest of the exterior.

#### Scenario: Fish fade with the water
- **WHEN** a fish swims away from a real window
- **THEN** it fades into the water colour at the same rate as the seabed behind it

### Requirement: Exterior costs stay flat
The exterior SHALL add a fixed number of draw calls, whatever the number of windows, and SHALL not draw while no visible room has a real window.

#### Scenario: Interior rooms
- **WHEN** the player is in a room that has no real window and sees none through its doors
- **THEN** no exterior geometry is drawn

# camera-feeds Specification

## Purpose

Security camera feeds show the world from a fixed point through a CCTV look, on in-world monitors or over the whole view, at a frame rate and sharpness each feed sets, without paying for feeds nobody can see.

## Requirements

### Requirement: Feed states
A feed SHALL be `live` (the world seen from its camera), `static` (noise and tears) or `off` (dark glass). A sequence step SHALL set a feed's state, camera position, aim, field of view and label, and whether it covers the whole view.

#### Scenario: A live feed goes to static
- **WHEN** a sequence sets a live feed to `static`
- **THEN** its screens show noise from the next feed frame and no longer show the world

#### Scenario: A feed turned off
- **WHEN** a sequence sets a feed to `off`
- **THEN** its screens show dark glass and it no longer renders the world

### Requirement: Each feed sets its own frame rate and size
A sequence step SHALL be able to set a feed's frame rate and render size. A feed that sets neither SHALL render at 10 fps at 320x180.

#### Scenario: The ending stinger is sharp and smooth
- **WHEN** the slice's ending stinger shows Priya on CAM 04
- **THEN** the feed renders at 30 fps or more at a size of at least 960x540

#### Scenario: Dock monitors keep their cost
- **WHEN** the dock CCTV wall's six monitors are live
- **THEN** each renders at 10 fps at 320x180

### Requirement: A feed holds its frame rate
A live feed SHALL render at its set frame rate on average, with gaps between frames that differ by at most one display frame. After a stall it SHALL resume at its rate without a burst of catch-up renders.

#### Scenario: 30 fps on a 60 Hz display
- **WHEN** a 30 fps feed is live on a steady 60 Hz display for 2 s
- **THEN** it renders 60 frames, one every second display frame

#### Scenario: Recovering from a hitch
- **WHEN** a frame takes 0.5 s while a 30 fps feed is live
- **THEN** the feed renders at most once on the next frame

### Requirement: A fullscreen feed looks clear
A feed over the whole view SHALL keep the CCTV look (tint, scanlines, vignette, label, REC dot) at a strength suited to its size on screen: scanlines and grain no coarser than a few screen pixels, faces and hands readable in the shot, and colour still visible. Monitor feeds SHALL keep today's look.

#### Scenario: Scanlines at fullscreen
- **WHEN** a feed covers a 1920x1080 view
- **THEN** its scanlines are spaced no more than 4 screen pixels apart

#### Scenario: Monitors unchanged
- **WHEN** a dock monitor feed is live
- **THEN** it looks the same as before this change

### Requirement: Feeds cost nothing while unseen
A feed SHALL render the world only while one of its screens is visible or it covers the whole view. While a feed covers the whole view, the player's own view SHALL NOT be rendered underneath it.

#### Scenario: Monitors out of sight
- **WHEN** no screen of a live feed is visible and it is not fullscreen
- **THEN** it renders no frames

#### Scenario: The stinger replaces the player's view
- **WHEN** a live feed covers the whole view
- **THEN** each display frame renders the world at most once, from the feed's camera

### Requirement: Remote feeds keep viewed NPCs visible and awake
An NPC within `hideDistance` or `sleepDistance` of any live, currently seen security camera feed (or currently in a scripted kill) SHALL remain visible and animated even when the player camera is further away.

#### Scenario: Priya on CAM 04 while Jay is in R16a
- **WHEN** `stinger_priya` shows `CAM 04 MEDBAY` while the player camera is in `R16a` (~88 m from `priya_rest`)
- **THEN** Priya's body stays visible and animates normally on the feed instead of being hidden by `hideDistance`

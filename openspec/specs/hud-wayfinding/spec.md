# hud-wayfinding Specification

## Purpose

Defines the always-available player wayfinding HUD and its post-intro onboarding: a persistent right-side objective list, an uncluttered cardinal compass with objective markers and distance, room-adjacency-gated in-world markers, and a non-fullscreen spotlight callout after the intro.

## Requirements

### Requirement: Persistent right-side objective list
Active objectives SHALL be listed persistently on the right side of the HUD while playing, tucked cleanly clear of top-right toasts, bottom-right ammo, and subtitles. The list SHALL hide on the title screen, when the map overlay is open, and while cutscene letterbox bars are active. Newly added objectives SHALL visually highlight briefly, completed objectives SHALL show a brief checkmark state before clearing, and pressing the objective key (`Tab`) SHALL pulse or emphasize the list.

#### Scenario: Post-intro objective appears immediately
- **WHEN** `intro_shift_change` ends and control returns in the Commons
- **THEN** the right-side objective list displays `obj_briefing` continuously without vanishing after 5 seconds

#### Scenario: Objective completes
- **WHEN** an active objective finishes
- **THEN** it shows a completed checkmark briefly on the right-side list and then clears while remaining active objectives stay visible

#### Scenario: Cutscene bars or map open
- **WHEN** letterbox bars are active or the map screen is open
- **THEN** the right-side objective list is hidden and returns when gameplay resumes

### Requirement: Minimal cardinal compass with objective markers and distance
The HUD SHALL display a top-center compass strip while playing (hidden on title, map, and cutscene bars). The compass SHALL show only the four cardinal directions (`N`, `E`, `S`, `W`) to stay uncluttered, plus a marker with distance in metres for each active objective bearing, clamped to the strip edges when behind the player.

#### Scenario: Cardinal labels stay uncluttered
- **WHEN** the player turns 360 degrees during gameplay
- **THEN** the compass scrolls smoothly with only `N`, `E`, `S`, and `W` cardinal labels and no intercardinal (`NE`/`NW`/`SE`/`SW`) labels

#### Scenario: Objective bearing and distance
- **WHEN** one or more objectives are active
- **THEN** the compass shows each active objective's directional pip and live distance in metres, clamping to the left or right edge when the target is behind Jay

### Requirement: Room-adjacency-gated in-world objective markers
A screen-projected in-world objective marker (icon and distance) SHALL appear **only** when Jay is in the objective's room or in a room directly adjacent to it (1 door hop in the level's room-door graph). When Jay is 2 or more rooms away, no in-world marker SHALL be shown for that objective. When Jay is in an adjacent room, the marker SHALL point at the connecting door; once Jay enters the objective's room, the marker SHALL point at the objective's target position.

#### Scenario: Objective is two or more rooms away
- **GIVEN** Jay is in R03 and `round_hydro` targets Hydroponics (2+ rooms away)
- **WHEN** the HUD renders
- **THEN** the compass shows the bearing and distance, and no in-world marker is drawn on screen for `round_hydro`

#### Scenario: Objective is in an adjacent room
- **GIVEN** Jay is in the Commons (R02) and `obj_briefing` targets the Observation Gallery (R03), connected by `D_R02_R03`
- **WHEN** the HUD renders
- **THEN** an in-world marker with distance appears on the connecting door `D_R02_R03`

#### Scenario: Objective is in the player's current room
- **GIVEN** Jay is in Hydroponics (R14) and `round_hydro` targets `anchor:hydro_log`
- **WHEN** the HUD renders
- **THEN** the in-world marker points directly at `anchor:hydro_log` with live distance

### Requirement: Quiet-half objectives resolve to concrete targets
`obj_briefing`, the three morning round objectives (`round_hydro`, `round_dive`, `round_admin`) and the return to the gallery (`round_return`) SHALL resolve to concrete target positions so compass distances and adjacent-room markers stay accurate throughout the quiet half. For `round_dive`, the target SHALL reflect the current sub-step (the sample case pickup before it is held, then the airlock locker once held). `round_return` SHALL point into the middle of the Observation Gallery, which Jay walks into to start the drop (see `gallery-drop`).

#### Scenario: Dive bay objective target updates after taking the case
- **GIVEN** `round_dive` is active
- **WHEN** Jay has not yet picked up `sample_case`
- **THEN** the target resolves to the sample case pickup in the dive bay; once Jay takes `sample_case`, the target updates to `anchor:dive_case_locker`

#### Scenario: The return marker leads to the drop
- **GIVEN** the rounds are done and `round_return` is active
- **WHEN** Jay walks through the Commons toward the Observation Gallery
- **THEN** the in-world marker shows in the middle of the gallery, and it disappears as he walks in and the drop begins

### Requirement: Post-intro wayfinding spotlight callout
When the intro finishes (played or skipped) and tutorials are enabled for a player who has not seen it, a non-fullscreen spotlight callout SHALL pause the simulation, dim the world behind the live top compass and right-side objective list so both HUD elements remain visibly highlighted, and display a brief callout explaining the compass, objective list, and nearby room markers. Pressing the dismiss input SHALL resume play and mark the callout as seen in the player profile.

#### Scenario: First playthrough after the intro
- **WHEN** `intro_shift_change` ends on a fresh profile with tutorials enabled
- **THEN** the spotlight callout dims the background behind the highlighted compass and right-side objective list while paused, explains how they work, and resumes gameplay cleanly on dismissal

#### Scenario: Subsequent run or tutorials off
- **WHEN** the player has already seen the wayfinding spotlight or has tutorial prompts turned off
- **THEN** the spotlight callout does not appear

### Requirement: An in-world marker disappears with its reason to be shown
An in-world objective marker SHALL be visible only while it is in the current frame's marker list and its target is in front of the camera and inside the screen. When an objective completes, a marker for it SHALL disappear in that same frame, and every other marker SHALL stay. When a target moves behind the camera or off the screen edge, its marker SHALL disappear until it is back in view. A marker that returns SHALL show its current position and distance, never the last ones it showed.

#### Scenario: Taking the Level 2 card
- **GIVEN** Jay is in the Director's office and an in-world marker reads "2m" for the card objective
- **WHEN** he picks up the card and the objective completes
- **THEN** that marker is gone from the screen at once, and it does not come back as Jay walks away

#### Scenario: Another objective stays
- **GIVEN** two objectives each show an in-world marker
- **WHEN** one completes
- **THEN** only its marker disappears and the other keeps updating its distance

#### Scenario: Turning away and back
- **GIVEN** a marker reads "8m" and Jay turns until its target is behind him
- **WHEN** he walks 4 m while looking away and then turns back
- **THEN** no marker was shown while the target was behind him, and the marker that returns reads "4m"

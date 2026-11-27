# post-processing Specification

## Purpose

Defines what the post-processing chain does to each rendered frame: where ambient occlusion applies, how bright surfaces bloom, the final colour grade and its player controls, and how these follow the quality tier.

## Requirements

### Requirement: Ambient occlusion skips see-through and effect surfaces
On High, ambient occlusion SHALL darken creases, corners and contact areas of solid geometry. It SHALL NOT darken anything because of a transparent surface, a surface that does not write depth, or a surface flagged to skip ambient occlusion (glass, light shafts, decals, the exterior water and seabed effects).

#### Scenario: Light shaft over the floor
- **WHEN** quality is High and a ceiling light's volumetric shaft reaches the floor
- **THEN** the floor under the shaft shows no dark ambient-occlusion shape of the shaft

#### Scenario: Looking through the Lab B glass
- **WHEN** quality is High and the player looks from the Observation Gallery through the Lab B glass
- **THEN** Lab B shows no dark ambient-occlusion shapes cast by the glass panes

#### Scenario: Sofa on the floor
- **WHEN** quality is High and a sofa stands on the floor
- **THEN** the floor darkens softly where it meets the sofa

### Requirement: Bright surfaces bloom on Medium and High
On Medium and High, emissive fixtures, screens and other surfaces brighter than the bloom threshold SHALL glow softly beyond their edges. Low SHALL render without bloom.

#### Scenario: Ceiling fixture on Medium
- **WHEN** quality is Medium and the player looks at a lit ceiling fixture
- **THEN** a soft glow extends past the fixture's edges

#### Scenario: Same fixture on Low
- **WHEN** quality is Low and the player looks at the same fixture
- **THEN** the fixture has no glow beyond its edges

### Requirement: The final grade
Every frame SHALL be graded with a slight chromatic aberration towards the screen edges, a cool lift and gain, a vignette and film grain. Low health SHALL desaturate the frame and push red into its edges, as a steady state that scales with how hurt the player is. Each hit SHALL add a short red flash, weighted towards the side it came from, on top of that state, and the grade SHALL draw the player's claw marks (see `damage-feedback`) so they take the frame's exposure, grain and vignette. The Film grain setting SHALL turn grain off without affecting the rest of the grade.

#### Scenario: Taking damage
- **WHEN** the player is badly hurt
- **THEN** the frame loses colour and its edges turn red, and both fade as the player recovers

#### Scenario: A hit flashes apart from low health
- **WHEN** the player at full health takes a swipe from the left
- **THEN** a red flash weighted to the left fades within about 0.4 s, and the frame does not stay desaturated

#### Scenario: Claw marks are part of the grade
- **WHEN** claw marks are showing and the player walks into a dark room
- **THEN** the marks darken with the frame's exposure and carry the film grain

#### Scenario: Film grain off
- **WHEN** the player turns Film grain off in Settings
- **THEN** the image shows no grain, and vignette, aberration, the damage tint and the claw marks still apply

### Requirement: Post effects follow a tier switch without a reload
Switching quality SHALL turn ambient occlusion, bloom and anti-aliasing on or off to match the new tier, during play and without reloading the level.

#### Scenario: High to Low during play
- **WHEN** the player changes quality from High to Low in the pause menu
- **THEN** ambient occlusion, bloom and anti-aliasing are all off when play resumes, and the level was not reloaded

### Requirement: Eye adaptation
On every tier, exposure SHALL adapt to the brightness of the view. It brightens over 2 to 4 s after the view goes dark and darkens over 0.5 to 1.5 s after it goes bright. Adaptation SHALL stay within a capped range, so a dark room still looks dark once adapted.

#### Scenario: Into a dark room
- **WHEN** the player walks from the lit Commons into a room under backup power
- **THEN** the view is darkest on entry and brightens over the next few seconds, and once adapted the room is still dark enough that the flashlight helps

#### Scenario: Out into the light
- **WHEN** the player walks from a dark room into the lit Commons
- **THEN** the Commons looks too bright for a moment and settles within 1.5 s

### Requirement: Brief flashes do not pump the exposure
Flashes shorter than about 0.25 s (muzzle flashes, sparks, a flickering light's peaks) SHALL NOT visibly change the exposure.

#### Scenario: Firing in a dark room
- **WHEN** the player fires the pistol repeatedly in a room under backup power
- **THEN** the room's exposure does not dip with each shot

### Requirement: Eye adaptation can be turned off
A Settings toggle "Eye adaptation", on by default, SHALL turn adaptation off. Exposure then stays fixed at its neutral value, and the rest of the grade still applies.

#### Scenario: Adaptation off
- **WHEN** the player turns Eye adaptation off and walks from the Commons into a dark room
- **THEN** the dark room's exposure does not change while they stand in it, and grain, vignette and the damage tint still apply

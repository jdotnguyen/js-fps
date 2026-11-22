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
Every frame SHALL be graded with a slight chromatic aberration towards the screen edges, a cool lift and gain, a vignette and film grain. The player's damage SHALL desaturate the frame and push red into its edges, scaling with the damage. The Film grain setting SHALL turn grain off without affecting the rest of the grade.

#### Scenario: Taking damage
- **WHEN** the player is badly hurt
- **THEN** the frame loses colour and its edges turn red, and both fade as the player recovers

#### Scenario: Film grain off
- **WHEN** the player turns Film grain off in Settings
- **THEN** the image shows no grain, and vignette, aberration and the damage tint still apply

### Requirement: Post effects follow a tier switch without a reload
Switching quality SHALL turn ambient occlusion, bloom and anti-aliasing on or off to match the new tier, during play and without reloading the level.

#### Scenario: High to Low during play
- **WHEN** the player changes quality from High to Low in the pause menu
- **THEN** ambient occlusion, bloom and anti-aliasing are all off when play resumes, and the level was not reloaded

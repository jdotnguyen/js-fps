# Spec Delta

## MODIFIED Requirements

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

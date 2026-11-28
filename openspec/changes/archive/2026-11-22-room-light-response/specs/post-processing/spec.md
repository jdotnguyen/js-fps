# Spec Delta

## ADDED Requirements

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

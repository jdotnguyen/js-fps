## ADDED Requirements

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

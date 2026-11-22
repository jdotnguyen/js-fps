# Spec Delta

## MODIFIED Requirements

### Requirement: Sample errand route
The sample case SHALL be picked up in R13b at `dive_case_pickup` and stowed in R13e at a chain-of-custody cold store at `dive_case_locker`, with the existing "Stow sample case" prompt and the existing lines. The store SHALL be marked for Lab B and SHALL include a pressure sample cabinet labelled "HOLD AT 302 BAR". Stowing SHALL take effect on use: the round completes at once, whatever dialogue is playing, and Sung's acknowledgement follows without holding the round back.

#### Scenario: Stowing the case
- **WHEN** Jay uses the stow point in R13e while carrying the sample case
- **THEN** the round completes, and the stow point is a cold-store unit marked for Lab B

#### Scenario: Stowing during Sung's conversation
- **WHEN** Jay uses the stow point while Sung's dive-bay lines are still playing
- **THEN** the click plays and the objective completes at once, and "Locker's signed" plays once Sung finishes his current line

### Requirement: Trunk secure event
The trunk SHALL start the quiet half with its inner hatch open. After Sung's dive-bay lines first finish, the trunk SHALL be secured: an amber beacon turns, a two-tone chirp and a vent hiss play from the trunk, the inner hatch closes, and the status screen reads "TRUNK SECURED". The event SHALL NOT overlap a dialogue line spoken in the dive bay. Lines elsewhere on the station SHALL NOT delay it. The closed hatch SHALL keep a viewport showing the blue glow below.

#### Scenario: First visit
- **WHEN** Jay enters the dive bay after the briefing and Sung's lines play
- **THEN** the secure event starts only after the last of those lines ends, and the hatch is closed and the screen reads "TRUNK SECURED" when it finishes

#### Scenario: Before the briefing
- **WHEN** Jay enters the dive bay before the briefing has been seen
- **THEN** the trunk stays open and the secure event does not run

#### Scenario: A scene still playing elsewhere
- **WHEN** Hale's office scene is still playing while Sung's dive-bay lines finish
- **THEN** the secure event starts right after Sung's lines, without waiting for Hale's

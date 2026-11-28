# Spec Delta

## Purpose

Defines the scene after the slice's title card: a fullscreen medical bay security feed showing that the bloom has turned
Priya's body, which ends the slice on a second shock.

## ADDED Requirements

### Requirement: The feed shows her corpse
After the title card, a fullscreen security feed labelled for the medical bay (CAM 04) SHALL show Priya's body lying where
the R08 throw left it, at the base of the centre pane, still. No other figure SHALL be in the room.

#### Scenario: Opening frame
- **WHEN** the feed fades in
- **THEN** Priya's body lies at her resting spot by the centre pane in frame, with no creature and no other NPC in the medical bay

### Requirement: The bloom turns her on camera
After a held stillness of at least 3 s, Priya's body SHALL twitch, convulse and rise to standing the wrong way, then turn
her head towards the camera. The feed SHALL cut to static within 2 s of her facing it.

#### Scenario: She gets up
- **WHEN** the stinger plays without a skip
- **THEN** her body moves from lying to standing on camera
- **AND** the last frame before the static has her face towards the camera

### Requirement: She does not speak
Priya SHALL say no words in the stinger. Her body SHALL make no more than one breath or rattle sound. The begging lines from the
earlier stinger SHALL NOT play.

#### Scenario: Silent turn
- **WHEN** the stinger plays from fade-in to static
- **THEN** no dialogue line with words plays for the nurse speaker

### Requirement: The stinger ends the slice
When the feed cuts to static, the slice SHALL end the way it does now: the feed closes, the end-of-slice notice shows, and the
game returns to the title.

#### Scenario: Back to the title
- **WHEN** the static ends
- **THEN** the feed closes and the game reaches the title screen

#### Scenario: Skipped
- **WHEN** the player skips the stinger at any point
- **THEN** the feed closes and the slice ends as if the stinger had finished

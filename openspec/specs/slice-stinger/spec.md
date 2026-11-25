# slice-stinger Specification

## Purpose
Defines the scene after the slice's title card: a fullscreen medical bay security feed showing that the bloom has turned
Priya's body, which ends the slice on a second shock.

## Requirements

### Requirement: The feed shows her corpse
After the title card, a fullscreen security feed labelled for the medical bay (CAM 04) SHALL show Priya's body slumped (`corpseSlumped`) at the base of the centre pane (`priya_rest`, `yaw: 180`, back against the glass and legs extending into R08), still, surrounded by her R08 blood pools and cracked/bloodied glass. No other figure SHALL be in the room.

#### Scenario: Opening frame
- **WHEN** the feed fades in (whether reached through play or restored via save/debug jump)
- **THEN** Priya's body sits slumped against the centre pane at `priya_rest` facing into R08 with her R08 blood pools and glass marks present, and no creature or other NPC in the medical bay

### Requirement: The bloom turns her on camera
After a held stillness of at least 3 s, Priya's body SHALL twitch, convulse and rise from her slumped seated posture to standing using a custom twitchy, janky procedural motion (`slumpedWrithe` -> `slumpedRise_0` -> `slumpedRise_1` -> `slumpedStand` with convulsion and joint kicks, not the prone `priya_rise` mocap clip) so her limbs stay clear of the glass without clipping, then turn her head towards the camera. The feed SHALL cut to static within 2 s of her facing it.

#### Scenario: She gets up
- **WHEN** the stinger plays without a skip
- **THEN** her body moves from slumped seated to a twitchy, crooked standing posture on camera without clipping into the window
- **AND** the last frame before the static has her face towards the camera

### Requirement: The stinger plays its theme into the credits
When `stinger_priya` starts, it SHALL explicitly cue the `labB` score's `kill:still` cue (`drone` + `hold`) so the eerie surveillance theme plays over CAM 04 and carries into the credits even when an earlier climax sequence released the score.

#### Scenario: Theme plays after R16 blackout
- **WHEN** `stinger_priya` begins after `r16_arrival_finale`'s `r16Cut` or via `?debug&jump=stinger_priya`
- **THEN** `labB`'s `kill:still` cue plays under the surveillance footage and continues into the credits

### Requirement: Debug jump for the stinger
The debug launcher SHALL support `?debug&jump=stinger_priya` to restore R08 (Priya's slumped corpse, blood pools, and glass marks) and launch `stinger_priya` directly on `CAM 04 MEDBAY` from `R16a` for fast iteration.

#### Scenario: Launching the stinger directly
- **WHEN** the game launches with `?debug&jump=stinger_priya`
- **THEN** R08 is restored with Priya slumped at `priya_rest` and `stinger_priya` starts immediately on fullscreen `CAM 04 MEDBAY`

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

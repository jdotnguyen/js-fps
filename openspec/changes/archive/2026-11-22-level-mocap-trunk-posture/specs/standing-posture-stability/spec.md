# Spec Delta

## ADDED Requirements

### Requirement: Standing idle and talk mocap keeps an upright trunk
Every standing idle and talk mocap clip a living humanoid plays SHALL keep the pelvis, averaged over the clip, within 10° of upright forward or back. Its upper back SHALL bend no more than 12° backwards relative to its lower back, so no clip stands in a swayback (pelvis tipped forward, chest pushed out). Only the average posture is limited; the motion around it is not.

#### Scenario: Cast-wide check over every pack
- **WHEN** the posture check samples every standing idle and talk clip in the core library and every character pack
- **THEN** each clip's average pelvis tilt is within 10° of upright and its upper back bends at most 12° backwards relative to its lower back, and a clip that fails is reported by id with its measured angles

#### Scenario: Bram stands upright in the intro kitchen
- **WHEN** Bram stands at the coffee machine and at `cook_stand` in `intro_shift_change`, idling or delivering his lines
- **THEN** his hips sit under his chest with no butt-out, chest-forward curve, and his talk keeps his head level rather than tipped back by the clip's trunk

#### Scenario: Upper-body actions inherit the upright trunk
- **WHEN** a character whose idle was levelled plays `offer_mug`, `typing` or an additive work layer over that idle
- **THEN** the trunk under the action is the levelled idle's, the mug stays in hand and upright, and the offering hand lands where the hand-off expects it

#### Scenario: Levelling keeps the motion
- **WHEN** a clip is levelled
- **THEN** its weight shifts, breathing and gestures keep their timing and size, its feet stay planted where the source planted them, and its head keeps its angle to the chest

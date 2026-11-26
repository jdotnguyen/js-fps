# standing-posture-stability Specification

## Purpose

Defines posture stability for standing living humanoids so transitioning between mocap idle/walk and standing fidgets or upper-body actions (such as offering a mug) never causes involuntary torso leaning or twisting.

## Requirements

### Requirement: Standing upper-body poses preserve the mocap base trunk
When a standing living humanoid driven by mocap plays a standing upper-body action or ambient fidget pose, the animator SHALL keep the mocap locomotion/idle base active on the pelvis, trunk, and legs rather than dropping mocap weight to zero. Only the pose's relevant upper-body, arm, or head joints SHALL layer over the mocap base.

#### Scenario: Bram offers coffee after walking to Giles
- **WHEN** a standing mocap NPC finishes walking and transitions into `offer_mug` (or a character variant of `offer_mug`) and back to `idle`
- **THEN** mocap base weight stays active on the trunk and legs and the chest pitch and pelvis yaw do not swing sharply between mocap tilt and an upright zero pose

#### Scenario: Ambient fidgets do not cause periodic slow leans
- **WHEN** an idle standing NPC or squadmate triggers an ambient fidget (`idle_weight`, `idle_shift`, `head_tilt`, `look_down`, `look_up`, `glance`, `idle_crossed`)
- **THEN** the character's trunk remains anchored on its mocap idle posture without leaning backward or twisting sideways as the fidget blends in and out

#### Scenario: Character-specific glances remain distinguishable
- **WHEN** Okafor plays `glance` (resolved to `okafor_glance`) compared with a generic crew member playing `glance`
- **THEN** Okafor still turns his chest less than the shared glance while keeping his mocap base stable

### Requirement: Slow indoor stops avoid exaggerated inertial tilt
On slow upright indoor walks (below jogging speed), braking deceleration and tight corner turns SHALL scale down inertial forward pitch and lateral banking so NPCs arriving at a close serving or conversation anchor settle upright without tipping forward or sideways. Kinematics acceleration SHALL be computed from single-frame velocity deltas before smoothing (never amplifying high-FPS frames into outward leans), and lateral collision/separation nudges SHALL remain responsive.

#### Scenario: Stopping at a counter anchor
- **WHEN** a walking NPC decelerates to a stop out of a curved indoor path at walking speed (~1.3–1.6 m/s) at 60 or 120 fps
- **THEN** peak torso braking pitch and cornering roll remain subtle and no outward lateral lean develops

#### Scenario: Lateral bump recoil still responds
- **WHEN** a standing NPC receives a lateral separation nudge impulse
- **THEN** the spine still exhibits a brief reactive recoil and settles back cleanly

### Requirement: Foot-locking IK prevents whole-body leaning over glued feet
Foot-locking IK SHALL clamp pinned-foot drift tightly (~0.14 m) and smoothly relax excess drift beyond a small idle deadzone (~0.045 m) back under the hips, while locomotion contacts SHALL release swing feet promptly at low walking speeds (~0.28 m/s) and turn-in-place speeds (<0.25 m/s). Placed leaning or seated poses (`lean_*`, `sit_*`) requested at walk arrival SHALL wait until the NPC finishes turning toward the anchor facing before leaning.

#### Scenario: Slow walk and stop does not leave feet glued behind the body
- **WHEN** an NPC walks slowly (0.35 m/s) and decelerates to a stop at a counter or serving anchor
- **THEN** pinned foot drift stays under 0.16 m during motion and settles back under the hips after stopping, while standing idle feet remain firmly planted

#### Scenario: Counter lean waits for turn alignment
- **WHEN** an NPC arrives at a counter anchor facing away from the final anchor yaw and is commanded to `lean_back`
- **THEN** the NPC turns to align with the counter facing before blending into `lean_back` instead of leaning backward in mid-air while spinning

### Requirement: Standing idle and talk mocap keeps an upright trunk
Every standing idle and talk mocap clip a living humanoid plays SHALL keep the pelvis, averaged over the clip, within 10° of upright forward or back. Its upper back SHALL bend no more than 12° backwards relative to its lower back, so no clip stands in a swayback (pelvis tipped forward, chest pushed out). The magnitude of the average sideways tilt of the chest and head SHALL be at most 10° each, measured in the horizontal facing frame of the pelvis. These cast-wide limits apply to the average pose over the clip.

#### Scenario: Cast-wide check over every pack
- **WHEN** the posture check samples every standing idle and talk clip in the core library and every character pack
- **THEN** each clip's average pelvis tilt is within 10° of upright and its upper back bends at most 12° backwards relative to its lower back, and average chest and head side tilt each stay within 10°. A failing clip is reported by id with its measured angles

#### Scenario: Bram stands upright in the intro kitchen
- **WHEN** Bram stands at the coffee machine and at `cook_stand` in `intro_shift_change`, idling or delivering his lines
- **THEN** his hips sit under his chest with no butt-out, chest-forward curve, and his talk keeps his head level rather than tipped back by the clip's trunk

#### Scenario: Upper-body actions inherit the upright trunk
- **WHEN** a character whose idle was levelled plays `offer_mug`, `typing` or an additive work layer over that idle
- **THEN** the trunk under the action is the levelled idle's, the mug stays in hand and upright, and the offering hand lands where the hand-off expects it

#### Scenario: Levelling keeps the motion
- **WHEN** a clip uses forward/back trunk levelling
- **THEN** its weight shifts, breathing and gestures keep their timing and size, its feet stay planted where the source planted them, and its head keeps its angle to the chest

#### Scenario: Okafor waits for Jay
- **WHEN** Okafor stands idle or holds a seated, kneeling or leaning pose
- **THEN** his eight-second standing capture provides quiet movement, and his head settles into the pose without a recurring conversational nod
- **AND** his standing talk keeps its trunk gestures with his average chest and head centred
- **AND** standing idle, his arms hang at his sides with his palms toward his thighs (within 20° on average), not held in front of him with the palms turned out

### Requirement: Standing idle arms hang at the sides
A standing idle mocap clip whose performer carried the arms forward SHALL be baked with each upper arm's average swing hanging straight down from the shoulder (`hangArms`). Only that average SHALL change: the swing around it, the elbow bend, the wrist and the rest of the take SHALL be kept.

#### Scenario: Hanging a take's arms
- **WHEN** a standing idle is baked with `hangArms`
- **THEN** each upper arm's average forward swing over the clip is straight down, every frame keeps its swing around that average, and the elbows, wrists, shoulders, trunk and legs are unchanged

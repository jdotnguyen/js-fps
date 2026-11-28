# Spec Delta

## MODIFIED Requirements

### Requirement: Standing upper-body poses preserve the mocap base trunk
When a standing living humanoid driven by mocap plays a standing upper-body action or ambient fidget pose, the animator SHALL keep the mocap locomotion/idle base active on the pelvis, trunk, and legs rather than dropping mocap weight to zero. Only the pose's relevant upper-body, arm, or head joints SHALL layer over the mocap base.

#### Scenario: Bram offers coffee after walking to Giles
- **WHEN** a standing mocap NPC finishes walking and transitions into `offer_mug` (or a character variant of `offer_mug`) and back to `idle`
- **THEN** mocap base weight stays active on the trunk and legs and the chest pitch and pelvis yaw do not swing sharply between mocap tilt and an upright zero pose

#### Scenario: Ambient fidgets do not cause periodic slow leans
- **WHEN** an idle standing NPC or squadmate triggers an ambient fidget (`idle_weight`, `idle_shift`, `head_tilt`, `look_down`, `look_up`, `glance`)
- **THEN** the character's trunk remains anchored on its mocap idle posture without leaning backward or twisting sideways as the fidget blends in and out

#### Scenario: Placed arms over the mocap base
- **WHEN** a standing mocap character rests with its arms crossed or its hands on its hips and plays that pose's head gestures
- **THEN** its trunk and legs stay on its mocap idle posture, and only its arms, neck and head follow the poses

#### Scenario: Character-specific glances remain distinguishable
- **WHEN** Okafor plays `glance` (resolved to `okafor_glance`) compared with a generic crew member playing `glance`
- **THEN** Okafor still turns his chest less than the shared glance while keeping his mocap base stable

# creature-rig Specification

## Purpose
Gives non-human creatures a rig of their own, apart from the shared humanoid skeleton. A creature can be posed, aimed and planted on the ground by the game's code and data, and judged by eye in a sandbox. The Juggernaut is the first creature.

## Requirements

### Requirement: Creatures are posed through their own rig
A creature SHALL be posed only through its own creature rig. It SHALL NOT be listed among the humanoid body models, mapped onto the shared 21-joint skeleton, or driven by humanoid motion capture.

#### Scenario: The Juggernaut is not a humanoid body
- **WHEN** the body model library and the motion capture library load
- **THEN** neither lists the Juggernaut, and the Juggernaut's bones are posed only by its creature rig

### Requirement: Every part of a creature model is on its body
Every mesh of a creature model SHALL render on the body part its bones belong to. On the Juggernaut, the eyes, teeth and tongue SHALL sit inside the head and mouth and SHALL follow the head, jaw and tongue bones.

#### Scenario: Face parts in the neutral pose
- **WHEN** the Juggernaut is shown in its neutral pose
- **THEN** its eyes, teeth and tongue are visible, and each lies within the head's skinned bounds

#### Scenario: Face parts follow the head
- **WHEN** the Juggernaut's head turns 30° and its jaw opens fully
- **THEN** each eye keeps its place relative to the head within 1 cm, and the lower teeth move with the lower mouth

### Requirement: Hands and feet ride their limbs
Each of a creature's hands SHALL ride its forearm, and each foot SHALL ride the last segment of its leg. Moving an upper limb segment SHALL carry everything below it.

#### Scenario: Swinging an arm carries the hand
- **WHEN** the Juggernaut's upper arm rotates 45° in any direction
- **THEN** the distance from the forearm's end to the hand's root is unchanged within 1 mm, and the fingers move with the hand

#### Scenario: Bending a leg carries the foot
- **WHEN** the Juggernaut's thigh rotates 30°
- **THEN** the foot moves with the leg's last segment, and the distance between them is unchanged within 1 mm

### Requirement: A creature's neutral pose is the pose it was modelled in
A creature rig's neutral pose SHALL be the pose its mesh was bound in. In the neutral pose, every vertex SHALL sit where it was modelled, and mirrored left and right joints SHALL mirror each other across the body's midline.

#### Scenario: Neutral Juggernaut
- **WHEN** the Juggernaut rig is set to neutral
- **THEN** every skinned vertex is within 1 mm of its modelled position, and every left joint mirrors its right joint within 1 cm

### Requirement: Named poses are data
A creature's named poses SHALL be stored as data: per-joint rotations relative to the neutral pose, with an optional per-joint offset and scale. The rig SHALL apply a named pose, blend between two poses over a given time, and reject pose data that names a joint the rig does not have, naming that joint.

#### Scenario: Blending into a pose
- **WHEN** a named pose is requested with a 0.5 s blend
- **THEN** after 0.25 s every joint is part-way between its start and the pose, and at 0.5 s every joint matches the pose

#### Scenario: Pose data names an unknown joint
- **WHEN** pose data names a joint the rig does not have
- **THEN** loading the pose fails with a message naming the pose and the joint

#### Scenario: The imported resting pose is kept
- **WHEN** the Juggernaut rig loads
- **THEN** the posed frame its model file was exported in (head turned, jaw open) is available as a named pose

### Requirement: Joints stay inside their limits
Each joint of a creature rig SHALL have rotation limits. No named pose, blend, IK solve or look-at SHALL leave a joint outside its limits. A request beyond a limit SHALL stop at the limit.

#### Scenario: A knee asked to bend backwards
- **WHEN** a leg IK target would need a knee to bend against its hinge
- **THEN** the knee stays at its limit and the foot gets as close to the target as the limits allow

### Requirement: Arms reach targets
Each arm of a creature rig SHALL place its hand on a target given in world metres, with the elbow bending toward a given pole. A target out of reach SHALL straighten the arm toward it. No bone SHALL change length.

#### Scenario: Reachable hand target
- **WHEN** a Juggernaut hand target is within the arm's reach and limits
- **THEN** the hand reaches it within 1 cm, the elbow lies on the pole's side, and every arm bone keeps its length within 1 mm

#### Scenario: Hand target out of reach
- **WHEN** a Juggernaut hand target is beyond the arm's reach
- **THEN** the arm points straight at it and no bone stretches

### Requirement: Three-segment legs plant their feet
Each three-segment leg SHALL place its foot on a target in world metres, sharing the bend between its segments in a fixed proportion so the ankle stays behind the knee. It SHALL lay the sole along a given ground normal. No bone SHALL change length.

#### Scenario: Planting a foot on level ground
- **WHEN** a Juggernaut foot target is within reach on level ground
- **THEN** the foot reaches it within 1 cm, its sole lies within 5° of the ground, the ankle lies behind the knee, and every leg bone keeps its length within 1 mm

#### Scenario: Planting a foot on a slope
- **WHEN** the ground normal tilts 15°
- **THEN** the sole follows the tilt within 5°, within the ankle's limits

### Requirement: Head and eyes look at targets
A creature rig SHALL turn its neck and head toward a world target, splitting the turn between them, and SHALL aim each eye at it. Past the neck and head limits the head SHALL stop at its limit while the eyes keep turning up to theirs.

#### Scenario: Target in front
- **WHEN** a look target is 20° to the Juggernaut's side
- **THEN** the head faces it within 2°, both neck and head share the turn, and both eyes aim at it within 2°

#### Scenario: Target behind its shoulder
- **WHEN** a look target lies beyond the head's limit
- **THEN** the head stops at its limit and the eyes turn further, stopping at their own limits

### Requirement: Jaw and tongue are posable
A creature rig SHALL open its jaw by an amount from 0 to 1. On the Juggernaut, that SHALL open the lower mouth and both side-jaw chains together, with the teeth following. The tongue chain SHALL extend and curl.

#### Scenario: Jaw fully open
- **WHEN** the Juggernaut's jaw is set to 1
- **THEN** the lower mouth and both side jaws reach their open limits symmetrically, and no tooth passes through the upper teeth

#### Scenario: Tongue extended
- **WHEN** the tongue is fully extended with the jaw open
- **THEN** the tongue reaches past the front teeth, and each tongue joint stays within its limits

### Requirement: The aim point follows the head
A creature's aim point, which the squad's weapons and flashlights track, SHALL ride its head and move with every head turn and nod.

#### Scenario: Head turns
- **WHEN** the Juggernaut's head turns 30°
- **THEN** its aim point moves with the head, keeping its offset from the head within 1 cm

### Requirement: Repaired creature models stay ready for clips
A repaired creature model SHALL keep every original joint name, the order of its joints and its skin weights, so that clips keyed on those names can play on it later.

#### Scenario: Joint names after repair
- **WHEN** the repaired Juggernaut model is compared with the original
- **THEN** both list the same joints in the same order, with the same weights on every body vertex

### Requirement: A sandbox shows each creature rig
A sandbox page SHALL show a creature in its neutral pose. It SHALL let the viewer:
- rotate each chain;
- drag the hand, foot, head and eye targets;
- choose and blend the named poses;
- show the joint limits;
- toggle each mesh part;
- pause, step a frame, and play at 0.25x to 1x speed.

#### Scenario: Judging an IK solve
- **WHEN** the viewer drags a Juggernaut foot target across the floor
- **THEN** the leg follows within its limits, and the page shows the remaining distance to the target and any joint resting at a limit

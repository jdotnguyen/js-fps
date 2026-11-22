# imported-body-models Specification

## Purpose

Turns imported character models (rigged models and unrigged scans) into skinned game bodies whose limbs, neck, head and jaw move cleanly under the game's animation, posing and look-at.

## Requirements

### Requirement: Scan bodies move their arms without dragging the torso
A body built from an unrigged scan SHALL skin each arm (upper arm, forearm, hand) separately from the torso below the shoulder. No triangle SHALL join an arm-weighted vertex to a torso-weighted vertex, and arm and torso weights SHALL NOT blend below the armpit.

#### Scenario: Arms raised out to the side
- **WHEN** a scan body's upper arms are rotated 30° away from the body
- **THEN** every torso vertex below the armpit (horizontally closer to the spine than to the arm's bones) stays where it was in the rest pose
- **AND** no edge of 3 mm or longer stretches to more than 2.5 times its rest-pose length (the shoulder blend stretches a little; a fused seam stretched 5-10 times)

#### Scenario: Mixed weights confined to the shoulder
- **WHEN** the prepared body's triangles are checked for vertices with an arm weight between 0.15 and 0.85
- **THEN** every such vertex lies above the armpit (the shoulder blend)
- **AND** triangles touching such vertices make up no more than 3% of the body's triangles

#### Scenario: Intro poses
- **WHEN** a scan body (Ruiz) holds the `lean_back`, `lean_back_mug`, `idle_hips` or `talk_gesture` pose, or walks
- **THEN** neither arm pulls a sheet of coat, coveralls or tool belt away from the torso

### Requirement: Separated arm and torso surfaces are closed
Where a scan body's arm was fused to its torso, the body SHALL close the openings left on the arm's inner side and on the torso's side, using the colour of the cloth or skin around each opening, so that moving an arm never reveals a hole or the inside of the mesh.

#### Scenario: Opening under a raised arm
- **WHEN** a scan body raises an arm and the camera looks at the torso's side under it
- **THEN** the side shows the body's own cloth colour, with no hole and no see-through gap
- **AND** with the arms raised 30°, no open edge round the arms is wider than a scan crack (5 mm)

#### Scenario: Inner side of the arm
- **WHEN** the camera looks at the inner side of a raised arm
- **THEN** the sleeve or skin is closed and shows the sleeve's or skin's colour

### Requirement: The neck joint owns the neck
A scan body SHALL weight the skin between the collar and the underside of the jaw to the neck joint (blending into the head toward the jaw). The chest and spine joints SHALL carry no weight above the collar.

#### Scenario: Chest weight stops at the collar
- **WHEN** the prepared body's vertices above the collar line are checked
- **THEN** none carries chest or spine weight

#### Scenario: Neck has its own skin
- **WHEN** the vertices of the neck between the collar and the jaw are checked
- **THEN** each is weighted mostly to the neck joint, or to the neck and head together

### Requirement: The lower face moves with the head
A scan body SHALL weight the mouth, lips, chin and jaw line only to the head and jaw joints, so turning or nodding the head carries the whole face rigidly while the jaw still opens for speech.

#### Scenario: Look-at turn
- **WHEN** a scan body looks 40° to either side (the head turning 22° and the neck 8°, as the look-at does)
- **THEN** the mouth and chin turn with the rest of the face, and the lips keep their rest-pose shape

#### Scenario: Speaking
- **WHEN** the jaw opens for a spoken line
- **THEN** the lower lip and chin follow the jaw and the upper lip stays with the head

### Requirement: Every named character's body has finger and twist bones
The body of every named character SHALL carry weighted finger bones (three per finger, two for the thumb, or one bone per finger where the scan's fingers are fused) and a twist bone in each forearm. Scan bodies prepared on the 24-bone rig SHALL gain these bones when they are prepared. Unnamed crew bodies MAY keep the thinner rig, and so MAY a named character whose scan fuses each hand into a fist or a glove that finger bones would tear (Ruiz, Sung).

#### Scenario: Rig check
- **WHEN** the prepared body of each named character with a hand rig is checked
- **THEN** each hand has finger bones carrying skin weight and each forearm has a twist bone carrying skin weight

#### Scenario: Fused scan fingers
- **WHEN** a scan body's fingers are fused into one surface
- **THEN** each finger's strip of the surface is weighted to its own finger bone, and curling a finger does not tear the surface (no edge of 3 mm or longer stretches to more than 2.5 times its rest length)

### Requirement: Fingers follow the character's hands
Finger bones SHALL follow the clip's finger track when the clip has one. Otherwise they SHALL take a grip from the hand's state: relaxed when empty, wrapped around a held prop (mug, pistol, clipboard, penlight), flat when the hand rests on a surface. Grip changes SHALL ease over at least 0.1 s.

#### Scenario: Holding a mug
- **WHEN** a character holds a mug in `lean_back_mug`
- **THEN** the fingers wrap the mug and none passes through it

#### Scenario: Empty hand at rest
- **WHEN** a character stands with empty hands
- **THEN** the fingers rest in a loose natural curl, not straight out

### Requirement: Every named character's hands move in their own way
Each named character SHALL have its own hand personality (tension, stiffness, finger fidget, resting curl) in its motion profile, and no two named characters SHALL share one. Giles's finger twitch SHALL rise with his infection stage. Generic crew SHALL get a seeded personality.

#### Scenario: Two characters at rest side by side
- **WHEN** Okafor and Hale stand idle with empty hands
- **THEN** Hale's fingers fidget more and rest tighter than Okafor's

#### Scenario: Giles's hands over the slice
- **WHEN** Giles's infection stage rises from 0 to 3
- **THEN** his fingers twitch more often and more sharply at each stage

### Requirement: Twist and spine segments share the motion
Twist bones SHALL take a share of their limb's roll (forearm twist about half of the hand's roll about the forearm), so the wrist does not pinch. Where a rig has more spine or neck segments than the shared skeleton, the bend SHALL be spread across them so the back and neck curve instead of kinking at one joint.

#### Scenario: Turning the hand over
- **WHEN** a hand rolls 90° about its forearm
- **THEN** the wrist keeps at least 70% of its rest-pose width (no candy-wrapper pinch)

#### Scenario: Leaning back on a multi-segment spine
- **WHEN** a body whose rig has three or more spine segments holds `lean_back`
- **THEN** each segment bends, and no single segment carries more than half of the total bend

### Requirement: Detail bones stay off the gameplay skeleton
Finger, twist and extra spine and neck bones SHALL only change how the body is skinned. Gore cuts, kills, hand and foot IK, look-at, collision and ragdolls SHALL keep using the shared 21-joint skeleton, and a severed limb SHALL take its detail bones with it.

#### Scenario: Severed forearm
- **WHEN** a named character's forearm is cut off
- **THEN** the severed piece carries its hand and fingers in their last pose, and the stump shows no stretched finger geometry

### Requirement: Secondary limbs never drive a primary limb joint
On an imported body, a limb that does not hang below one of the main arm or leg chains SHALL NOT move with that chain's joints, even if its bones carry names such as "hand", "wrist" or "finger". It SHALL ride, rigidly, the joint of the body part it grows from. A primary joint's pivot SHALL come from a bone in that joint's own chain.

#### Scenario: Belly arms stay put while the blades lift
- **WHEN** the four-armed creature raises its blade arms (attack, slam, kill grip)
- **THEN** its small belly arms stay where they are on the torso, and the skin around their roots shows no stretched geometry

#### Scenario: Blade hand pivots at the wrist
- **WHEN** the four-armed creature's body is prepared
- **THEN** each blade arm's hand joint sits at the end of that blade's forearm, not at belly height, and no belly-arm geometry belongs to a hand piece

#### Scenario: Ordinary rigs are unaffected
- **WHEN** any body whose hand and finger bones all hang below a forearm is prepared
- **THEN** its bones map to the same joints, with the same pivots, as before this rule

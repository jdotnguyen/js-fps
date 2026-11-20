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

# Spec Delta

## ADDED Requirements

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

# Spec Delta

## ADDED Requirements

### Requirement: The set of real lights stays constant during play
The number of real lights of each kind that the scene counts, with how many cast shadows and how many project a pattern, SHALL NOT change during play. Hiding, removing or moving away from whatever carries a light SHALL darken that light without removing it from the count. Only a graphics quality change MAY alter the set. Developer tools are exempt.

#### Scenario: Squad out of range
- **WHEN** one or both squad members are far enough from the view to be hidden
- **THEN** the scene counts the same lights as when both stand beside the player

#### Scenario: Weapon light on a visible squad member
- **WHEN** a sequence switches on a squad member's weapon light while that member is visible
- **THEN** the light shines from their muzzle along their aim and follows them as they move, including on the moving train

#### Scenario: Weapon light on a hidden squad member
- **WHEN** a squad member whose weapon light is on is hidden
- **THEN** that light adds no light to the scene until the member is shown again

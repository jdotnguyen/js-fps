# Spec Delta

## MODIFIED Requirements

### Requirement: Budgets and clearance
The slice01 level tests SHALL report the draw calls of each room in R13a–e and of the heaviest visible view, following the render-quality spec's reported-counts rule; a count SHALL NOT fail the tests. A clear path of at least 1.2 m SHALL run between every pair of doors in R13b and around the stow point, the case pickup and the map station.

#### Scenario: Draw calls after dressing
- **WHEN** the slice01 budget test runs
- **THEN** it logs each R13 room's draw-call count and passes whatever the counts are

#### Scenario: Squad-width paths
- **WHEN** two 0.35 m capsules walk side by side from the R13a door to the R13e door
- **THEN** they pass the trunk rail, the bench and the console without stalling

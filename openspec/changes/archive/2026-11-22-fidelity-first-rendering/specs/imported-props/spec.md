# Spec Delta

## MODIFIED Requirements

### Requirement: Imported props count against room budgets
Each imported prop SHALL have a recorded cost: triangles, materials, transparent materials and texture pixels. The per-room draw-call and triangle counts that the level tests report SHALL include the recorded cost of every imported prop a room places, whether or not models are loaded. Each prop type SHALL add its material count to a room once, and its triangles once per placed copy.

#### Scenario: Headless budget check
- **WHEN** a room places three copies of a prop recorded at 2 materials and 1,500 triangles, and the level tests build it without models
- **THEN** that room's counted draw calls rise by 2 and its counted triangles by 4,500

#### Scenario: Stale record
- **WHEN** a prop's model file has been re-imported but its cost record was not updated
- **THEN** the tests fail and name the prop id

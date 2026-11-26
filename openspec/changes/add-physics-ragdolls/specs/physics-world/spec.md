# Spec Delta

## ADDED Requirements

### Requirement: Ragdoll features have their own switches
Death ragdolls and powered ragdolls SHALL each be switchable on and off independently, by a URL flag and by a stored setting, and switching one off SHALL NOT affect severed debris or physical interaction beyond the fallbacks they define.

#### Scenario: Ragdolls off, debris on
- **WHEN** death ragdolls are switched off and severed debris is on
- **THEN** severed limbs collide physically and killed bodies use authored corpse poses

### Requirement: Over budget, the oldest bodies settle first
When the physics step would exceed its time budget, the oldest active ragdoll SHALL be settled first, then the oldest active debris, so slower machines stay within the same budget by settling bodies sooner.

#### Scenario: Over budget
- **WHEN** the measured step time exceeds the budget while several ragdolls are active
- **THEN** the oldest active ragdoll is frozen before any newer one
